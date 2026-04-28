import {
  CHECKPOINT_FILE,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  sqlArray,
  sqlLiteral,
  stableNormalizeText
} from "./_utils.mjs";

const ROLE_VALUES = [
  "sells_physical_products",
  "sells_services",
  "repair_service",
  "food_prepared",
  "food_grocery",
  "health_care",
  "beauty_personal_care",
  "specialist_retail",
  "unclear"
];

const DISTRICT_SCOPE_MAP = {
  mitte: ["Mitte", "Moabit", "Wedding", "Gesundbrunnen", "Tiergarten", "Hansaviertel"]
};

const GROCERY_CATEGORIES = new Set(["grocery", "convenience", "fresh-food", "produce", "bio", "drinks", "bakery", "butcher"]);
const SERVICE_CATEGORIES = new Set(["beauty", "personal-care", "medical-supplies"]);
const HEALTH_CATEGORIES = new Set(["pharmacy", "medical-supplies"]);
const REPAIR_OSM = new Set(["locksmith", "repair", "bicycle", "car_repair", "motorcycle_repair", "computer"]);

const REPAIR_HINTS = [
  "repair",
  "reparatur",
  "service",
  "schluessel",
  "locksmith",
  "tailor",
  "schneid",
  "shoemaker",
  "schuh",
  "bike",
  "fahrrad",
  "handy"
];

const BEAUTY_HINTS = ["beauty", "nail", "pedicure", "manicure", "hair", "barber", "kosmetik", "friseur"];
const HEALTH_HINTS = ["apothe", "pharma", "medical", "ortho", "sanitat", "sanitaet"];
const PREPARED_FOOD_HINTS = ["restaurant", "cafe", "bistro", "pizza", "kebab", "imbiss", "bar"];

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

function choosePrimaryRole(roles) {
  const order = [
    "repair_service",
    "health_care",
    "beauty_personal_care",
    "food_grocery",
    "food_prepared",
    "specialist_retail",
    "sells_physical_products",
    "sells_services",
    "unclear"
  ];
  for (const role of order) {
    if (roles.includes(role)) return role;
  }
  return "unclear";
}

function classifyRole(row) {
  const roles = new Set();
  const appCategories = Array.isArray(row.app_categories)
    ? row.app_categories.map((item) => stableNormalizeText(item))
    : [];
  const osmCategory = stableNormalizeText(row.osm_category ?? "");
  const normalizedName = stableNormalizeText(row.name ?? "");

  if (appCategories.some((category) => GROCERY_CATEGORIES.has(category))) {
    roles.add("food_grocery");
    roles.add("sells_physical_products");
  }

  if (appCategories.some((category) => HEALTH_CATEGORIES.has(category)) || HEALTH_HINTS.some((hint) => normalizedName.includes(hint))) {
    roles.add("health_care");
    roles.add("sells_physical_products");
  }

  if (appCategories.some((category) => SERVICE_CATEGORIES.has(category)) || BEAUTY_HINTS.some((hint) => normalizedName.includes(hint))) {
    roles.add("beauty_personal_care");
    roles.add("sells_services");
  }

  if (PREPARED_FOOD_HINTS.some((hint) => normalizedName.includes(hint))) {
    roles.add("food_prepared");
    roles.add("sells_services");
  }

  if (REPAIR_OSM.has(osmCategory) || REPAIR_HINTS.some((hint) => normalizedName.includes(hint))) {
    roles.add("repair_service");
    roles.add("sells_services");
  }

  if (appCategories.includes("hardware") || appCategories.includes("household") || appCategories.includes("art") || appCategories.includes("antiques")) {
    roles.add("specialist_retail");
    roles.add("sells_physical_products");
  }

  if (roles.size === 0) {
    roles.add("unclear");
  }

  const roleList = [...roles].filter((role) => ROLE_VALUES.includes(role)).sort((a, b) => a.localeCompare(b));
  const primaryRole = choosePrimaryRole(roleList);

  let confidence = 0.58;
  if (roleList.includes("repair_service") || roleList.includes("health_care")) confidence = 0.84;
  else if (roleList.includes("food_grocery") || roleList.includes("beauty_personal_care")) confidence = 0.78;
  else if (roleList.includes("specialist_retail")) confidence = 0.68;

  const isRelevant = !roleList.includes("unclear");

  return {
    store_roles: roleList,
    store_role_primary: primaryRole,
    role_confidence: Number(confidence.toFixed(4)),
    is_relevant_for_kiezkauf: isRelevant
  };
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
select id, name, address, district, osm_category, app_categories
from public.establishments e
where e.id > ${Number(lastId)}
  and e.active_status in ('active', 'temporarily_closed', 'unknown')
  ${districtFilter}
  ${postalFilter}
order by e.id asc
limit ${Number(batchSize)};
`;

  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    address: String(row.address ?? ""),
    district: String(row.district ?? ""),
    osm_category: row.osm_category ? String(row.osm_category) : "",
    app_categories: Array.isArray(row.app_categories) ? row.app_categories.map((value) => String(value)) : []
  }));
}

function buildUpsertSql(rows) {
  if (!rows.length) {
    return "select 0::int as updated_rows;";
  }

  const values = rows
    .map((row) =>
      `(${[
        sqlLiteral(row.id),
        sqlArray(row.store_roles),
        sqlLiteral(row.store_role_primary),
        sqlLiteral(row.role_confidence),
        sqlLiteral("rule_store_role_v1"),
        sqlLiteral(row.is_relevant_for_kiezkauf)
      ].join(", ")})`
    )
    .join(",\n");

  return `
with incoming(establishment_id, store_roles, store_role_primary, role_confidence, role_classification_method, is_relevant_for_kiezkauf) as (
  values
  ${values}
), updated as (
  update public.establishments e
  set
    store_roles = i.store_roles,
    store_role_primary = i.store_role_primary,
    role_confidence = i.role_confidence,
    role_classification_method = i.role_classification_method,
    role_classified_at = now(),
    is_relevant_for_kiezkauf = i.is_relevant_for_kiezkauf,
    updated_at = now()
  from incoming i
  where e.id = i.establishment_id
  returning e.id
)
select count(*)::int as updated_rows from updated;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 400);
  const resume = Boolean(args.resume);
  const maxEstablishments = args["max-establishments"] ? Number(args["max-establishments"]) : null;
  const districtScope = String(args["district-scope"] ?? "").trim();
  const districtNames = resolveDistrictScopeNames(districtScope);
  const postalCodeScope = String(args["postal-code-scope"] ?? "").trim();
  const postalCodes = resolvePostalCodeScope(postalCodeScope);

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.classifyStoreRoles ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;

  let totalScanned = 0;
  let totalUpdated = 0;

  logInfo("Store role classification started", {
    batchSize,
    maxEstablishments,
    districtScope: districtScope || null,
    postalCodeScope: postalCodeScope || null,
    districtNames,
    postalCodes,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await fetchBatch(cursor, batchSize, districtNames, postalCodes);
    if (!rows.length) break;

    const classified = rows.map((row) => ({ id: row.id, ...classifyRole(row) }));
    const sql = buildUpsertSql(classified);
    const result = await runSupabaseQuery({ sql, output: "json" });
    const updatedRows = Number(result.parsed.rows?.[0]?.updated_rows ?? 0);

    totalScanned += rows.length;
    totalUpdated += updatedRows;
    cursor = rows[rows.length - 1].id;

    checkpoint.classifyStoreRoles = {
      lastId: cursor,
      totalScanned,
      totalUpdated,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Store role batch completed", {
      scanned: rows.length,
      updatedRows,
      cursor,
      totalScanned,
      totalUpdated
    });

    if (maxEstablishments && totalScanned >= maxEstablishments) {
      logInfo("Stopping store role classification due to max-establishments cap", {
        maxEstablishments,
        totalScanned
      });
      break;
    }
  }

  checkpoint.classifyStoreRoles = {
    lastId: cursor,
    totalScanned,
    totalUpdated,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Store role classification completed", {
    totalScanned,
    totalUpdated
  });
}

main().catch((error) => {
  logWarn("Store role classification failed", String(error));
  process.exit(1);
});
