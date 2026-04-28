import {
  CHECKPOINT_FILE,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  sqlLiteral,
  stableNormalizeText
} from "./_utils.mjs";

const DISTRICT_SCOPE_MAP = {
  mitte: ["Mitte", "Moabit", "Wedding", "Gesundbrunnen", "Tiergarten", "Hansaviertel"]
};

const ROLE_SERVICE_MAP = {
  repair_service: ["phone-repair", "computer-repair", "bike-repair", "shoe-repair", "key-cutting", "watch-battery-replacement"],
  beauty_personal_care: ["pedicure", "manicure"],
  health_care: ["watch-battery-replacement"],
  sells_services: ["copy-print", "dry-cleaning"],
  specialist_retail: ["copy-print"]
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

async function fetchCanonicalServices() {
  const sql = `
select id, slug, group_key
from public.canonical_services
where is_active = true
order by priority desc, id asc;
`;
  const res = await runSupabaseQuery({ sql, output: "json" });
  const map = new Map();
  for (const row of res.parsed.rows ?? []) {
    map.set(String(row.slug), {
      id: Number(row.id),
      slug: String(row.slug),
      group_key: String(row.group_key ?? "services")
    });
  }
  return map;
}

async function fetchBatch(lastId, batchSize, districtNames, postalCodes) {
  const districtFilter =
    districtNames.length > 0
      ? `\n  and lower(e.district) = any(array[${districtNames.map((name) => sqlLiteral(name.toLowerCase())).join(", ")}]::text[])\n`
      : "";

  const postalFilter =
    postalCodes.length > 0
      ? `\n  and coalesce(e.address, '') ilike any(array[${postalCodes.map((code) => sqlLiteral(`%${code}%`)).join(", ")}]::text[])\n`
      : "";

  const sql = `
select e.id, e.name, e.district, e.store_roles, e.store_role_primary, e.app_categories, e.osm_category, e.website
from public.establishments e
where e.id > ${Number(lastId)}
  and e.active_status in ('active', 'temporarily_closed')
  and coalesce(e.is_relevant_for_kiezkauf, true) = true
  ${districtFilter}
  ${postalFilter}
order by e.id asc
limit ${Number(batchSize)};
`;

  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    district: String(row.district ?? ""),
    store_roles: Array.isArray(row.store_roles) ? row.store_roles.map((value) => String(value)) : [],
    store_role_primary: String(row.store_role_primary ?? "unclear"),
    app_categories: Array.isArray(row.app_categories) ? row.app_categories.map((value) => String(value)) : [],
    osm_category: String(row.osm_category ?? ""),
    website: row.website ? String(row.website) : null
  }));
}

function inferServiceSlugs(establishment, availableServiceSlugs, maxServicesPerStore) {
  const slugs = new Set();
  const name = stableNormalizeText(establishment.name);
  const appCategories = establishment.app_categories.map((value) => stableNormalizeText(value));

  const roles = new Set([establishment.store_role_primary, ...establishment.store_roles]);
  for (const role of roles) {
    for (const slug of ROLE_SERVICE_MAP[role] ?? []) {
      if (availableServiceSlugs.has(slug)) {
        slugs.add(slug);
      }
    }
  }

  if (name.includes("schluessel") || name.includes("locksmith") || name.includes("key")) {
    if (availableServiceSlugs.has("key-cutting")) slugs.add("key-cutting");
  }
  if (name.includes("fahrrad") || name.includes("bike")) {
    if (availableServiceSlugs.has("bike-repair")) slugs.add("bike-repair");
  }
  if (name.includes("copy") || name.includes("print")) {
    if (availableServiceSlugs.has("copy-print")) slugs.add("copy-print");
  }
  if (name.includes("nail") || name.includes("pedicure") || name.includes("manicure") || name.includes("kosmetik")) {
    if (availableServiceSlugs.has("pedicure")) slugs.add("pedicure");
    if (availableServiceSlugs.has("manicure")) slugs.add("manicure");
  }

  if (appCategories.includes("pharmacy") || appCategories.includes("medical-supplies")) {
    if (availableServiceSlugs.has("watch-battery-replacement")) slugs.add("watch-battery-replacement");
  }

  return [...slugs].slice(0, maxServicesPerStore);
}

function confidenceForSlug(establishment, slug) {
  const roles = new Set([establishment.store_role_primary, ...establishment.store_roles]);
  if (roles.has("repair_service") && ["phone-repair", "computer-repair", "bike-repair", "shoe-repair", "key-cutting"].includes(slug)) {
    return 0.84;
  }
  if (roles.has("beauty_personal_care") && ["pedicure", "manicure"].includes(slug)) {
    return 0.82;
  }
  if (roles.has("sells_services")) {
    return 0.66;
  }
  return 0.62;
}

function reasonForSlug(slug) {
  const reasons = {
    "phone-repair": "Store role and naming indicate phone/device repair services.",
    "computer-repair": "Store role suggests technical repair capability.",
    "bike-repair": "Store role/name suggest bicycle-related service.",
    "shoe-repair": "Store role/name suggest shoe repair capability.",
    "key-cutting": "Store role/name indicate key duplication or locksmith services.",
    "watch-battery-replacement": "Typical quick service in repair/health retail contexts.",
    "dry-cleaning": "Store role indicates utility services likely offered.",
    "copy-print": "Store profile suggests print/copy utility service.",
    "pedicure": "Beauty/personal care role indicates likely pedicure service.",
    "manicure": "Beauty/personal care role indicates likely manicure service.",
    tailoring: "Specialist retail/service role suggests tailoring or alterations."
  };
  return reasons[slug] ?? "Likely service inferred from store role and category mapping.";
}

function buildUpsertSql(rows) {
  if (!rows.length) {
    return "select 0::int as affected_rows;";
  }

  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(row.establishment_id),
        sqlLiteral(row.canonical_service_id),
        `${sqlLiteral("rules_generated")}::public.source_type_enum`,
        sqlLiteral("service_role_rules_v1"),
        sqlLiteral(row.confidence),
        `${sqlLiteral("likely")}::public.validation_status_enum`,
        sqlLiteral("likely"),
        sqlLiteral(row.why_this_service_matches),
        sqlLiteral(row.inferred_from)
      ].join(", ")})`;
    })
    .join(",\n");

  return `
with incoming(
  establishment_id,
  canonical_service_id,
  source_type,
  generation_method,
  confidence,
  validation_status,
  availability_status,
  why_this_service_matches,
  inferred_from
) as (
  values
  ${values}
), upserted as (
  insert into public.establishment_service_candidates (
    establishment_id,
    canonical_service_id,
    source_type,
    generation_method,
    confidence,
    validation_status,
    availability_status,
    why_this_service_matches,
    inferred_from
  )
  select * from incoming
  on conflict (establishment_id, canonical_service_id, source_type, generation_method)
  do update set
    confidence = excluded.confidence,
    validation_status = case
      when public.establishment_service_candidates.validation_status in ('validated', 'rejected')
      then public.establishment_service_candidates.validation_status
      else excluded.validation_status
    end,
    availability_status = excluded.availability_status,
    why_this_service_matches = excluded.why_this_service_matches,
    inferred_from = excluded.inferred_from,
    updated_at = now()
  returning id
)
select count(*)::int as affected_rows from upserted;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 300);
  const maxServicesPerStore = Number(args["max-services-per-store"] ?? 6);
  const resume = Boolean(args.resume);
  const maxEstablishments = args["max-establishments"] ? Number(args["max-establishments"]) : null;
  const districtScope = String(args["district-scope"] ?? "").trim();
  const districtNames = resolveDistrictScopeNames(districtScope);
  const postalCodeScope = String(args["postal-code-scope"] ?? "").trim();
  const postalCodes = resolvePostalCodeScope(postalCodeScope);

  const serviceMap = await fetchCanonicalServices();
  const availableServiceSlugs = new Set(serviceMap.keys());

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.generateRuleServiceCandidates ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;

  let totalScanned = 0;
  let totalCandidates = 0;
  let totalAffectedRows = 0;

  logInfo("Rule service candidate generation started", {
    batchSize,
    maxServicesPerStore,
    maxEstablishments,
    districtScope: districtScope || null,
    postalCodeScope: postalCodeScope || null,
    districtNames,
    postalCodes,
    canonicalServices: serviceMap.size,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const establishments = await fetchBatch(cursor, batchSize, districtNames, postalCodes);
    if (!establishments.length) break;

    const candidateRows = [];
    for (const establishment of establishments) {
      const slugs = inferServiceSlugs(establishment, availableServiceSlugs, maxServicesPerStore);
      for (const slug of slugs) {
        const service = serviceMap.get(slug);
        if (!service) continue;

        candidateRows.push({
          establishment_id: establishment.id,
          canonical_service_id: service.id,
          confidence: Number(confidenceForSlug(establishment, slug).toFixed(4)),
          why_this_service_matches: reasonForSlug(slug),
          inferred_from: {
            role_primary: establishment.store_role_primary,
            roles: establishment.store_roles,
            app_categories: establishment.app_categories,
            osm_category: establishment.osm_category,
            method: "service_role_rules_v1"
          }
        });
      }
    }

    const sql = buildUpsertSql(candidateRows);
    const result = await runSupabaseQuery({ sql, output: "json" });
    const affectedRows = Number(result.parsed.rows?.[0]?.affected_rows ?? 0);

    totalScanned += establishments.length;
    totalCandidates += candidateRows.length;
    totalAffectedRows += affectedRows;
    cursor = establishments[establishments.length - 1].id;

    checkpoint.generateRuleServiceCandidates = {
      lastId: cursor,
      totalScanned,
      totalCandidates,
      totalAffectedRows,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Rule service batch completed", {
      establishments: establishments.length,
      candidatesPrepared: candidateRows.length,
      affectedRows,
      cursor,
      totalScanned,
      totalCandidates,
      totalAffectedRows
    });

    if (maxEstablishments && totalScanned >= maxEstablishments) {
      logInfo("Stopping rule service generation due to max-establishments cap", {
        maxEstablishments,
        totalScanned
      });
      break;
    }
  }

  checkpoint.generateRuleServiceCandidates = {
    lastId: cursor,
    totalScanned,
    totalCandidates,
    totalAffectedRows,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Rule service candidate generation completed", {
    totalScanned,
    totalCandidates,
    totalAffectedRows
  });
}

main().catch((error) => {
  logWarn("Rule service candidate generation failed", String(error));
  process.exit(1);
});
