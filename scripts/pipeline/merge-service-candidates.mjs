import {
  CHECKPOINT_FILE,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  sqlLiteral
} from "./_utils.mjs";

const DISTRICT_SCOPE_MAP = {
  mitte: ["Mitte", "Moabit", "Wedding", "Gesundbrunnen", "Tiergarten", "Hansaviertel"]
};

const SOURCE_PRIORITY = {
  validated: 100,
  user_validated: 95,
  merchant_added: 90,
  website_extracted: 80,
  ai_generated: 70,
  ai_inferred: 68,
  rules_generated: 60,
  imported: 40
};

function resolveDistrictScopeNames(rawScope) {
  const scope = String(rawScope ?? "").trim().toLowerCase();
  if (!scope) return [];
  if (DISTRICT_SCOPE_MAP[scope]) return DISTRICT_SCOPE_MAP[scope];
  return scope
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePostalCodeScope(rawScope) {
  return String(rawScope ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/[^\d]/g, ""))
    .filter((item) => item.length >= 4 && item.length <= 6);
}

async function fetchEstablishmentBatch(lastId, batchSize, districtNames, postalCodes) {
  const districtFilter =
    districtNames.length > 0
      ? `\n  and lower(e.district) = any(array[${districtNames.map((name) => sqlLiteral(name.toLowerCase())).join(", ")}]::text[])\n`
      : "";

  const postalFilter =
    postalCodes.length > 0
      ? `\n  and coalesce(e.address, '') ilike any(array[${postalCodes.map((code) => sqlLiteral(`%${code}%`)).join(", ")}]::text[])\n`
      : "";

  const sql = `
select distinct c.establishment_id
from public.establishment_service_candidates c
join public.establishments e on e.id = c.establishment_id
where c.establishment_id > ${Number(lastId)}
  and c.validation_status <> 'rejected'
  ${districtFilter}
  ${postalFilter}
order by c.establishment_id asc
limit ${Number(batchSize)};
`;
  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => Number(row.establishment_id)).filter(Number.isFinite);
}

function buildMergeSql(establishmentIds) {
  if (!establishmentIds.length) return "select 0::int as affected_rows;";

  const priorityCase = Object.entries(SOURCE_PRIORITY)
    .map(([source, priority]) => `when source_type = ${sqlLiteral(source)}::public.source_type_enum then ${priority}`)
    .join("\n        ");

  const idsSql = establishmentIds.join(", ");

  return `
with target_establishments as (
  select unnest(array[${idsSql}]::bigint[]) as establishment_id
), ranked as (
  select
    c.id,
    c.establishment_id,
    c.canonical_service_id,
    c.source_type,
    c.confidence,
    c.validation_status,
    c.availability_status,
    c.why_this_service_matches,
    c.source_url,
    row_number() over (
      partition by c.establishment_id, c.canonical_service_id
      order by
        case
        ${priorityCase}
          else 0
        end desc,
        c.confidence desc,
        c.updated_at desc,
        c.id desc
    ) as rn
  from public.establishment_service_candidates c
  join target_establishments t on t.establishment_id = c.establishment_id
  where c.validation_status <> 'rejected'
), grouped as (
  select
    establishment_id,
    canonical_service_id,
    array_agg(distinct source_type) as merged_sources,
    array_agg(id) as merged_candidate_ids
  from ranked
  group by establishment_id, canonical_service_id
), selected as (
  select
    r.establishment_id,
    r.canonical_service_id,
    r.source_type as primary_source_type,
    g.merged_sources,
    g.merged_candidate_ids,
    r.confidence,
    r.validation_status,
    r.availability_status,
    r.why_this_service_matches,
    r.source_url
  from ranked r
  join grouped g
    on g.establishment_id = r.establishment_id
   and g.canonical_service_id = r.canonical_service_id
  where r.rn = 1
), deleted as (
  delete from public.establishment_service_merged m
  using target_establishments t
  where m.establishment_id = t.establishment_id
    and not exists (
      select 1
      from selected s
      where s.establishment_id = m.establishment_id
        and s.canonical_service_id = m.canonical_service_id
    )
  returning m.id
), upserted as (
  insert into public.establishment_service_merged (
    establishment_id,
    canonical_service_id,
    primary_source_type,
    merged_sources,
    merged_candidate_ids,
    confidence,
    validation_status,
    availability_status,
    why_this_service_matches,
    source_url,
    updated_at
  )
  select
    establishment_id,
    canonical_service_id,
    primary_source_type,
    merged_sources,
    merged_candidate_ids,
    confidence,
    validation_status,
    availability_status,
    why_this_service_matches,
    source_url,
    now()
  from selected
  on conflict (establishment_id, canonical_service_id)
  do update set
    primary_source_type = excluded.primary_source_type,
    merged_sources = excluded.merged_sources,
    merged_candidate_ids = excluded.merged_candidate_ids,
    confidence = excluded.confidence,
    validation_status = case
      when public.establishment_service_merged.validation_status in ('validated', 'rejected')
      then public.establishment_service_merged.validation_status
      else excluded.validation_status
    end,
    availability_status = excluded.availability_status,
    why_this_service_matches = excluded.why_this_service_matches,
    source_url = excluded.source_url,
    updated_at = now()
  returning id
)
select (select count(*)::int from upserted) + (select count(*)::int from deleted) as affected_rows;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 500);
  const resume = Boolean(args.resume);
  const districtScope = String(args["district-scope"] ?? "").trim();
  const districtNames = resolveDistrictScopeNames(districtScope);
  const postalCodeScope = String(args["postal-code-scope"] ?? "").trim();
  const postalCodes = resolvePostalCodeScope(postalCodeScope);

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.mergeServiceCandidates ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;

  let totalEstablishments = 0;
  let totalAffectedRows = 0;

  logInfo("Service merge started", {
    batchSize,
    districtScope: districtScope || null,
    postalCodeScope: postalCodeScope || null,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const establishmentIds = await fetchEstablishmentBatch(cursor, batchSize, districtNames, postalCodes);
    if (!establishmentIds.length) break;

    const sql = buildMergeSql(establishmentIds);
    const res = await runSupabaseQuery({ sql, output: "json" });
    const affectedRows = Number(res.parsed.rows?.[0]?.affected_rows ?? 0);

    totalEstablishments += establishmentIds.length;
    totalAffectedRows += affectedRows;
    cursor = establishmentIds[establishmentIds.length - 1];

    checkpoint.mergeServiceCandidates = {
      lastId: cursor,
      totalEstablishments,
      totalAffectedRows,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Service merge batch completed", {
      establishments: establishmentIds.length,
      affectedRows,
      cursor,
      totalEstablishments,
      totalAffectedRows
    });
  }

  checkpoint.mergeServiceCandidates = {
    lastId: cursor,
    totalEstablishments,
    totalAffectedRows,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Service merge completed", {
    totalEstablishments,
    totalAffectedRows
  });
}

main().catch((error) => {
  logWarn("Service merge failed", String(error));
  process.exit(1);
});
