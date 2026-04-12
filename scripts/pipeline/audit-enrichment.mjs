import path from "node:path";
import {
  DATA_DIR,
  logInfo,
  logWarn,
  parseArgs,
  readJsonFile,
  runSupabaseQuery,
  stableNormalizeText,
  writeJsonFile
} from "./_utils.mjs";

const DEFAULT_SAMPLE_SIZE = 25;
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const DEFAULT_BASELINE_FILE = path.join(REPORTS_DIR, "gpt-enrichment-before.json");
const DEFAULT_AFTER_FILE = path.join(REPORTS_DIR, "gpt-enrichment-after.json");
const DEFAULT_COMPARE_FILE = path.join(REPORTS_DIR, "gpt-enrichment-compare.json");

const CATEGORY_GROUP_HINTS = {
  grocery: new Set(["groceries", "beverages", "fresh_produce", "household", "snacks"]),
  convenience: new Set(["beverages", "snacks", "groceries", "household"]),
  "fresh-food": new Set(["fresh_produce", "groceries", "bakery"]),
  bakery: new Set(["bakery", "beverages", "snacks"]),
  butcher: new Set(["meat", "groceries"]),
  produce: new Set(["fresh_produce", "groceries"]),
  drinks: new Set(["beverages", "snacks"]),
  pharmacy: new Set(["pharmacy", "personal_care"]),
  "personal-care": new Set(["personal_care", "pharmacy"]),
  household: new Set(["household", "groceries"]),
  bio: new Set(["groceries", "fresh_produce", "beverages"])
};

function parseProducts(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function productLooksPlausible(product, appCategories) {
  const confidence = Number(product.confidence ?? 0);
  const validation = String(product.validation_status ?? "unvalidated");
  const sourceType = String(product.source_type ?? "");
  const group = String(product.product_group ?? "");

  if (validation === "validated" && confidence >= 0.6) return true;
  if (validation === "likely" && confidence >= 0.62) return true;
  if (sourceType === "website_extracted" && confidence >= 0.6) return true;

  for (const category of appCategories) {
    if (CATEGORY_GROUP_HINTS[category]?.has(group) && confidence >= 0.58) {
      return true;
    }
  }

  return false;
}

function productLooksDoubtful(product, appCategories) {
  const confidence = Number(product.confidence ?? 0);
  const group = String(product.product_group ?? "");
  const sourceType = String(product.source_type ?? "");

  if (confidence < 0.5) return true;
  if (sourceType === "rules_generated" && confidence < 0.58) return true;

  let hasCategorySupport = false;
  for (const category of appCategories) {
    if (CATEGORY_GROUP_HINTS[category]?.has(group)) {
      hasCategorySupport = true;
      break;
    }
  }

  return !hasCategorySupport && confidence < 0.65;
}

function evaluateSampleRows(rows) {
  let totalProducts = 0;
  let plausibleProducts = 0;
  let doubtfulProducts = 0;

  const perStore = rows.map((row) => {
    const appCategories = Array.isArray(row.app_categories) ? row.app_categories.map(String) : [];
    const products = parseProducts(row.products).map((item) => ({
      canonical_product_id: Number(item.canonical_product_id),
      product_normalized_name: String(item.product_normalized_name ?? ""),
      product_group: String(item.product_group ?? ""),
      source_type: String(item.source_type ?? ""),
      confidence: Number(item.confidence ?? 0),
      validation_status: String(item.validation_status ?? "unvalidated"),
      why_this_product_matches: item.why_this_product_matches ? String(item.why_this_product_matches) : null
    }));

    let plausible = 0;
    let doubtful = 0;
    for (const product of products) {
      totalProducts += 1;
      if (productLooksPlausible(product, appCategories)) {
        plausible += 1;
        plausibleProducts += 1;
      } else if (productLooksDoubtful(product, appCategories)) {
        doubtful += 1;
        doubtfulProducts += 1;
      }
    }

    return {
      establishment_id: Number(row.establishment_id),
      establishment_name: String(row.establishment_name),
      district: String(row.district ?? "Berlin"),
      app_categories: appCategories,
      website: row.website ? String(row.website) : null,
      freshness_score: row.freshness_score == null ? null : Number(row.freshness_score),
      products,
      product_count: products.length,
      plausible_count: plausible,
      doubtful_count: doubtful
    };
  });

  const plausibleRatio = totalProducts ? Number((plausibleProducts / totalProducts).toFixed(4)) : 0;
  const doubtfulRatio = totalProducts ? Number((doubtfulProducts / totalProducts).toFixed(4)) : 0;

  return {
    generated_at: new Date().toISOString(),
    stores_count: perStore.length,
    total_products: totalProducts,
    plausible_products: plausibleProducts,
    doubtful_products: doubtfulProducts,
    plausible_ratio: plausibleRatio,
    doubtful_ratio: doubtfulRatio,
    stores: perStore
  };
}

function buildSampleSql(sampleSize) {
  return `
with sample as (
  select
    e.id as establishment_id,
    e.name as establishment_name,
    e.district,
    e.app_categories,
    e.website,
    e.freshness_score
  from establishments e
  where e.external_source = 'osm-overpass'
    and e.active_status in ('active', 'temporarily_closed')
    and e.possible_duplicate_of is null
  order by random()
  limit ${Number(sampleSize)}
)
select
  s.establishment_id,
  s.establishment_name,
  s.district,
  s.app_categories,
  s.website,
  s.freshness_score,
  coalesce(
    json_agg(
      json_build_object(
        'canonical_product_id', d.canonical_product_id,
        'product_normalized_name', d.product_normalized_name,
        'product_group', d.product_group,
        'source_type', d.source_type,
        'confidence', d.confidence,
        'validation_status', d.validation_status,
        'why_this_product_matches', d.why_this_product_matches
      )
      order by d.confidence desc, d.product_normalized_name asc
    ) filter (where d.canonical_product_id is not null),
    '[]'::json
  ) as products
from sample s
left join search_product_establishment_dataset d on d.establishment_id = s.establishment_id
group by
  s.establishment_id,
  s.establishment_name,
  s.district,
  s.app_categories,
  s.website,
  s.freshness_score
order by s.establishment_id asc;
`;
}

function buildRowsByIdsSql(ids) {
  const idList = ids.map((id) => Number(id)).filter((value) => Number.isFinite(value));
  if (!idList.length) {
    return "select null where false;";
  }

  return `
with sample as (
  select
    e.id as establishment_id,
    e.name as establishment_name,
    e.district,
    e.app_categories,
    e.website,
    e.freshness_score
  from establishments e
  where e.id = any(array[${idList.join(",")}]::bigint[])
)
select
  s.establishment_id,
  s.establishment_name,
  s.district,
  s.app_categories,
  s.website,
  s.freshness_score,
  coalesce(
    json_agg(
      json_build_object(
        'canonical_product_id', d.canonical_product_id,
        'product_normalized_name', d.product_normalized_name,
        'product_group', d.product_group,
        'source_type', d.source_type,
        'confidence', d.confidence,
        'validation_status', d.validation_status,
        'why_this_product_matches', d.why_this_product_matches
      )
      order by d.confidence desc, d.product_normalized_name asc
    ) filter (where d.canonical_product_id is not null),
    '[]'::json
  ) as products
from sample s
left join search_product_establishment_dataset d on d.establishment_id = s.establishment_id
group by
  s.establishment_id,
  s.establishment_name,
  s.district,
  s.app_categories,
  s.website,
  s.freshness_score
order by s.establishment_id asc;
`;
}

function compareSnapshots(beforeSnapshot, afterSnapshot) {
  const beforeById = new Map(beforeSnapshot.stores.map((store) => [store.establishment_id, store]));
  const afterById = new Map(afterSnapshot.stores.map((store) => [store.establishment_id, store]));

  const changes = [];
  for (const [id, beforeStore] of beforeById.entries()) {
    const afterStore = afterById.get(id);
    if (!afterStore) continue;

    const beforeProducts = new Set(
      beforeStore.products.map((product) => stableNormalizeText(product.product_normalized_name))
    );
    const afterProducts = new Set(
      afterStore.products.map((product) => stableNormalizeText(product.product_normalized_name))
    );

    const addedProducts = [...afterProducts].filter((name) => !beforeProducts.has(name));
    const removedProducts = [...beforeProducts].filter((name) => !afterProducts.has(name));

    const avgBeforeConfidence =
      beforeStore.products.length > 0
        ? Number(
            (
              beforeStore.products.reduce((sum, product) => sum + Number(product.confidence ?? 0), 0) /
              beforeStore.products.length
            ).toFixed(4)
          )
        : 0;
    const avgAfterConfidence =
      afterStore.products.length > 0
        ? Number(
            (
              afterStore.products.reduce((sum, product) => sum + Number(product.confidence ?? 0), 0) /
              afterStore.products.length
            ).toFixed(4)
          )
        : 0;

    changes.push({
      establishment_id: id,
      establishment_name: afterStore.establishment_name,
      district: afterStore.district,
      product_count_before: beforeStore.product_count,
      product_count_after: afterStore.product_count,
      plausible_before: beforeStore.plausible_count,
      plausible_after: afterStore.plausible_count,
      doubtful_before: beforeStore.doubtful_count,
      doubtful_after: afterStore.doubtful_count,
      avg_confidence_before: avgBeforeConfidence,
      avg_confidence_after: avgAfterConfidence,
      added_products: addedProducts.slice(0, 12),
      removed_products: removedProducts.slice(0, 12)
    });
  }

  const goodExamples = [...changes]
    .filter((item) => item.plausible_after >= item.plausible_before && item.doubtful_after <= item.doubtful_before)
    .sort((a, b) => (b.plausible_after - b.doubtful_after) - (a.plausible_after - a.doubtful_after))
    .slice(0, 6);

  const doubtfulExamples = [...changes]
    .filter((item) => item.doubtful_after > 0 || item.product_count_after >= 8)
    .sort((a, b) => b.doubtful_after - a.doubtful_after || b.product_count_after - a.product_count_after)
    .slice(0, 6);

  return {
    generated_at: new Date().toISOString(),
    sample_size: changes.length,
    plausible_ratio_before: beforeSnapshot.plausible_ratio,
    plausible_ratio_after: afterSnapshot.plausible_ratio,
    doubtful_ratio_before: beforeSnapshot.doubtful_ratio,
    doubtful_ratio_after: afterSnapshot.doubtful_ratio,
    stores_with_changes: changes.filter(
      (item) =>
        item.product_count_before !== item.product_count_after ||
        item.avg_confidence_before !== item.avg_confidence_after
    ).length,
    stores: changes,
    good_examples: goodExamples,
    doubtful_examples: doubtfulExamples
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const sampleSize = Number(args["sample-size"] ?? DEFAULT_SAMPLE_SIZE);
  const baselineFile = String(args["baseline-file"] ?? DEFAULT_BASELINE_FILE);
  const afterFile = String(args["after-file"] ?? DEFAULT_AFTER_FILE);
  const compareFile = String(args["compare-file"] ?? DEFAULT_COMPARE_FILE);

  const mode = String(args.mode ?? "sample");

  if (mode === "baseline") {
    const sampleSql = buildSampleSql(sampleSize);
    const sampleResult = await runSupabaseQuery({ sql: sampleSql, output: "json" });
    const snapshot = evaluateSampleRows(sampleResult.parsed.rows ?? []);
    await writeJsonFile(baselineFile, snapshot);
    logInfo("Saved baseline enrichment sample", {
      sampleSize,
      output: baselineFile,
      plausibleRatio: snapshot.plausible_ratio,
      doubtfulRatio: snapshot.doubtful_ratio
    });
    return;
  }

  if (mode === "after") {
    const baseline = await readJsonFile(baselineFile);
    const ids = Array.isArray(baseline.stores) ? baseline.stores.map((store) => Number(store.establishment_id)) : [];
    const sql = buildRowsByIdsSql(ids);
    const sampleResult = await runSupabaseQuery({ sql, output: "json" });
    const snapshot = evaluateSampleRows(sampleResult.parsed.rows ?? []);
    await writeJsonFile(afterFile, snapshot);
    logInfo("Saved post-enrichment sample", {
      sampleSize: snapshot.stores_count,
      output: afterFile,
      plausibleRatio: snapshot.plausible_ratio,
      doubtfulRatio: snapshot.doubtful_ratio
    });
    return;
  }

  if (mode === "compare") {
    const beforeSnapshot = await readJsonFile(baselineFile);
    const afterSnapshot = await readJsonFile(afterFile);
    const comparison = compareSnapshots(beforeSnapshot, afterSnapshot);
    await writeJsonFile(compareFile, comparison);
    logInfo("Saved enrichment before/after comparison", {
      output: compareFile,
      sampleSize: comparison.sample_size,
      plausibleRatioBefore: comparison.plausible_ratio_before,
      plausibleRatioAfter: comparison.plausible_ratio_after
    });
    return;
  }

  const sampleSql = buildSampleSql(sampleSize);
  const sampleResult = await runSupabaseQuery({ sql: sampleSql, output: "json" });
  const snapshot = evaluateSampleRows(sampleResult.parsed.rows ?? []);
  logInfo("Sampled enrichment quality", {
    sampleSize: snapshot.stores_count,
    plausibleRatio: snapshot.plausible_ratio,
    doubtfulRatio: snapshot.doubtful_ratio
  });
}

main().catch((error) => {
  logWarn("Enrichment audit failed", String(error));
  process.exit(1);
});
