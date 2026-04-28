import { logInfo, logWarn, parseArgs, runSupabaseQuery, sqlLiteral } from "./_utils.mjs";

const DISTRICT_SCOPE_MAP = {
  mitte: ["Mitte", "Moabit", "Wedding", "Gesundbrunnen", "Tiergarten", "Hansaviertel"]
};

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

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

function buildSql(districtNames, postalCodes, dryRun) {
  const districtFilter =
    districtNames.length > 0
      ? `
  and lower(e.district) = any(array[${districtNames.map((name) => sqlLiteral(name.toLowerCase())).join(", ")}]::text[])
`
      : "";
  const postalFilter =
    postalCodes.length > 0
      ? `
  and coalesce(e.address, '') ilike any(array[${postalCodes.map((code) => sqlLiteral(`%${code}%`)).join(", ")}]::text[])
`
      : "";

  const baseCte = `
with missing as (
  select
    m.establishment_id,
    m.canonical_product_id,
    m.primary_source_type as source_type,
    coalesce(
      m.merged_generation_methods[1],
      case m.primary_source_type
        when 'rules_generated' then 'rule_engine_mapping_v2'
        when 'website_extracted' then 'website_signal_extractor_v1'
        when 'ai_generated' then 'openai_llm_candidate_refiner_v3'
        when 'merchant_added' then 'merchant_manual_entry_v1'
        when 'user_validated' then 'user_manual_validation_v1'
        when 'validated' then 'manual_validated_backfill_v1'
        else 'merged_backfill_v1'
      end
    ) as generation_method,
    m.confidence,
    m.validation_status,
    m.why_this_product_matches,
    m.category_path,
    m.inferred_from,
    m.source_url,
    m.extraction_method,
    m.last_checked_at,
    m.freshness_score
  from establishment_product_merged m
  join establishments e on e.id = m.establishment_id
  where 1 = 1
  ${districtFilter}
  ${postalFilter}
    and not exists (
      select 1
      from establishment_product_candidates c
      where c.establishment_id = m.establishment_id
        and c.canonical_product_id = m.canonical_product_id
        and c.source_type = m.primary_source_type
    )
)
`;

  if (dryRun) {
    return `
${baseCte}
select count(*)::int as missing_rows from missing;
`;
  }

  return `
${baseCte}
, inserted as (
  insert into establishment_product_candidates (
    establishment_id,
    canonical_product_id,
    source_type,
    generation_method,
    confidence,
    validation_status,
    validation_notes,
    why_this_product_matches,
    category_path,
    inferred_from,
    source_url,
    extraction_method,
    last_checked_at,
    freshness_score
  )
  select
    establishment_id,
    canonical_product_id,
    source_type,
    generation_method,
    confidence,
    validation_status,
    case
      when validation_status in ('validated', 'rejected')
        then 'Backfilled from merged (manual status preserved).'
      else 'Backfilled from merged to restore candidates->merged coherence.'
    end,
    why_this_product_matches,
    category_path,
    coalesce(inferred_from, '{}'::jsonb) || jsonb_build_object(
      'coherence_repair', true,
      'coherence_repaired_at', now()
    ),
    source_url,
    extraction_method,
    last_checked_at,
    freshness_score
  from missing
  on conflict (establishment_id, canonical_product_id, source_type, generation_method)
  do nothing
  returning id
)
select count(*)::int as inserted_rows from inserted;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = parseBoolean(args["dry-run"], false);
  const districtScope = String(args["district-scope"] ?? "").trim();
  const districtNames = resolveDistrictScopeNames(districtScope);
  const postalCodeScope = String(args["postal-code-scope"] ?? "").trim();
  const postalCodes = resolvePostalCodeScope(postalCodeScope);

  if (!dryRun) {
    await runSupabaseQuery({
      sql: `
select setval(
  pg_get_serial_sequence('public.establishment_product_candidates', 'id'),
  coalesce((select max(id) from public.establishment_product_candidates), 1),
  true
);
`,
      output: "json"
    });
  }

  const sql = buildSql(districtNames, postalCodes, dryRun);
  const result = await runSupabaseQuery({ sql, output: "json" });
  const metric = Number(result.parsed.rows?.[0]?.missing_rows ?? result.parsed.rows?.[0]?.inserted_rows ?? 0);

  logInfo("Merged->candidate coherence repair completed", {
    dryRun,
    districtScope: districtScope || null,
    districtNames,
    postalCodeScope: postalCodeScope || null,
    postalCodes,
    rows: metric
  });
}

main().catch((error) => {
  logWarn("Merged->candidate coherence repair failed", String(error));
  process.exit(1);
});
