import { logInfo, logWarn, runSupabaseQuery } from "./_utils.mjs";

const SQL = `
with moved as (
  update establishment_product_candidates c
  set
    source_type = 'rules_generated'::source_type_enum,
    generation_method = 'legacy_ai_heuristic_reclassified_v1',
    extraction_method = coalesce(c.extraction_method, 'legacy_heuristic_relabel_v1'),
    validation_notes = coalesce(
      c.validation_notes,
      'Reclassified from ai_generated because it was produced by heuristic fallback without live LLM.'
    ),
    inferred_from = coalesce(c.inferred_from, '{}'::jsonb) || jsonb_build_object(
      'relabel_reason', 'heuristic_without_live_llm',
      'relabelled_at', now()
    ),
    updated_at = now()
  where c.source_type = 'ai_generated'
    and c.generation_method = 'ai_heuristic_candidate_refiner_v1'
    and c.validation_status <> 'validated'
  returning c.id
)
select count(*)::int as relabeled_rows from moved;
`;

async function main() {
  const result = await runSupabaseQuery({ sql: SQL, output: "json" });
  const relabeledRows = Number(result.parsed.rows?.[0]?.relabeled_rows ?? 0);

  logInfo("Legacy AI labels cleanup completed", {
    relabeledRows
  });
}

main().catch((error) => {
  logWarn("Legacy AI labels cleanup failed", String(error));
  process.exit(1);
});
