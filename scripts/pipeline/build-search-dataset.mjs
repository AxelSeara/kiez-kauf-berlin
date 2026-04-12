import { logInfo, logWarn, runSupabaseQuery } from "./_utils.mjs";

async function main() {
  logInfo("Phase 7 (part B) - refresh search dataset materialization");

  await runSupabaseQuery({
    sql: "select refresh_search_product_establishment_mv();",
    output: "json"
  });

  const statsResult = await runSupabaseQuery({
    sql: `
select
  (select count(*)::int from establishments where external_source = 'osm-overpass') as establishments_total,
  (select count(*)::int from establishments where website is not null and btrim(website) <> '') as establishments_with_website,
  (select count(*)::int from establishment_website_enrichment) as website_enrichment_rows,
  (select count(*)::int from canonical_products) as canonical_products_total,
  (select count(*)::int from establishment_product_candidates) as candidate_rows_total,
  (select count(*)::int from establishment_product_candidates where source_type = 'website_extracted') as website_extracted_candidates,
  (select count(*)::int from establishment_product_candidates where source_type = 'ai_generated') as ai_generated_candidates,
  (select count(*)::int from establishment_product_candidates where source_type = 'rules_generated') as rules_generated_candidates,
  (select count(*)::int from establishment_product_merged) as merged_rows_total,
  (select count(*)::int from search_product_establishment_mv) as search_rows_total,
  (select count(*)::int from search_product_establishment_mv where candidate_source_url is not null) as search_rows_with_source_url;
`,
    output: "json"
  });

  const stats = statsResult.parsed.rows?.[0] ?? {};
  logInfo("Search dataset refreshed", stats);
}

main().catch((error) => {
  logWarn("Build search dataset failed", String(error));
  process.exit(1);
});
