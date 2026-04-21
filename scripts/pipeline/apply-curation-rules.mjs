import {
  CHECKPOINT_FILE,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint
} from "./_utils.mjs";

function buildSql(windowDays, minSupport, minPositive, minPrecision, maxApply) {
  return `
with eligible as (
  select
    id,
    app_category,
    product_group,
    support_count,
    positive_count,
    precision_score
  from public.curation_rule_suggestions
  where window_days = ${Number(windowDays)}
    and status = 'suggested'
    and auto_apply_eligible = true
    and support_count >= ${Number(minSupport)}
    and positive_count >= ${Number(minPositive)}
    and precision_score >= ${Number(minPrecision)}
  order by precision_score desc, support_count desc
  limit ${Number(maxApply)}
), upserted_rules as (
  insert into public.app_category_group_rules (
    app_category,
    product_group,
    base_confidence,
    reason,
    source,
    support_count,
    precision_score,
    auto_apply_eligible,
    is_active
  )
  select
    e.app_category,
    e.product_group,
    greatest(
      0.55,
      least(
        0.98,
        (e.precision_score - 0.03)
        + case
            when e.support_count >= 50 then 0.04
            when e.support_count >= 30 then 0.02
            else 0
          end
      )
    )::numeric(5,4) as base_confidence,
    (
      'Learned from curated admin actions (' ||
      e.positive_count::text || '/' || e.support_count::text ||
      ', precision ' || e.precision_score::text || ').'
    )::text as reason,
    'curation'::text as source,
    e.support_count,
    e.precision_score,
    true as auto_apply_eligible,
    true as is_active
  from eligible e
  on conflict (app_category, product_group)
  do update set
    base_confidence = greatest(public.app_category_group_rules.base_confidence, excluded.base_confidence),
    reason = excluded.reason,
    source = 'curation',
    support_count = excluded.support_count,
    precision_score = excluded.precision_score,
    auto_apply_eligible = true,
    is_active = true,
    updated_at = now()
  returning app_category, product_group
), marked as (
  update public.curation_rule_suggestions s
  set
    status = 'applied',
    applied_at = now(),
    notes = 'Auto applied with conservative thresholds.',
    updated_at = now()
  from eligible e
  where s.id = e.id
  returning s.id, s.app_category, s.product_group, s.support_count, s.precision_score
), events as (
  insert into public.curation_events (
    event_type,
    entity_type,
    app_category,
    product_group,
    reason,
    before_state,
    after_state,
    metadata,
    actor_type
  )
  select
    'rule_apply'::text,
    'rule'::text,
    m.app_category,
    m.product_group,
    'Auto-applied conservative curation rule.',
    jsonb_build_object(
      'support_count', m.support_count,
      'precision_score', m.precision_score
    ),
    jsonb_build_object(
      'status', 'applied'
    ),
    jsonb_build_object(
      'window_days', ${Number(windowDays)},
      'min_support', ${Number(minSupport)},
      'min_positive', ${Number(minPositive)},
      'min_precision', ${Number(minPrecision)}
    ),
    'pipeline'
  from marked m
  returning id
)
select
  (select count(*)::int from eligible) as eligible_rows,
  (select count(*)::int from upserted_rules) as rules_upserted,
  (select count(*)::int from marked) as suggestions_applied,
  (select count(*)::int from events) as events_logged;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const windowDays = Number(args["window-days"] ?? 90);
  const minSupport = Number(args["min-support"] ?? 20);
  const minPositive = Number(args["min-positive"] ?? 10);
  const minPrecision = Number(args["min-precision"] ?? 0.9);
  const maxApply = Number(args["max-apply"] ?? 120);

  logInfo("Applying conservative curation rules", {
    windowDays,
    minSupport,
    minPositive,
    minPrecision,
    maxApply,
    checkpointFile: CHECKPOINT_FILE
  });

  const sql = buildSql(windowDays, minSupport, minPositive, minPrecision, maxApply);
  const result = await runSupabaseQuery({ sql, output: "json" });
  const row = result.parsed.rows?.[0] ?? {};

  const checkpoint = await loadCheckpoint();
  checkpoint.applyCurationRules = {
    windowDays,
    minSupport,
    minPositive,
    minPrecision,
    maxApply,
    eligibleRows: Number(row.eligible_rows ?? 0),
    rulesUpserted: Number(row.rules_upserted ?? 0),
    suggestionsApplied: Number(row.suggestions_applied ?? 0),
    eventsLogged: Number(row.events_logged ?? 0),
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Conservative curation rules applied", checkpoint.applyCurationRules);
}

main().catch((error) => {
  logWarn("Applying curation rules failed", String(error));
  process.exit(1);
});
