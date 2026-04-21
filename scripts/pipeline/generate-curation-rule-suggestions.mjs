import {
  CHECKPOINT_FILE,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint
} from "./_utils.mjs";

function buildSql(windowDays, minSupport, minPositive, minPrecision) {
  return `
with scoped as (
  select
    lower(btrim(app_category)) as app_category,
    lower(btrim(product_group)) as product_group,
    event_type
  from public.curation_events
  where created_at >= now() - (${Number(windowDays)}::int * interval '1 day')
    and event_type in ('product_add', 'product_validate', 'product_reject', 'product_remove')
    and app_category is not null
    and product_group is not null
), aggregated as (
  select
    app_category,
    product_group,
    count(*)::int as support_count,
    count(*) filter (where event_type in ('product_add', 'product_validate'))::int as positive_count
  from scoped
  group by app_category, product_group
), scored as (
  select
    app_category,
    product_group,
    support_count,
    positive_count,
    case when support_count > 0 then round((positive_count::numeric / support_count::numeric), 4) else 0 end as precision_score,
    (
      support_count >= ${Number(minSupport)}
      and positive_count >= ${Number(minPositive)}
      and (case when support_count > 0 then (positive_count::numeric / support_count::numeric) else 0 end) >= ${Number(minPrecision)}
    ) as auto_apply_eligible
  from aggregated
  where support_count >= 3
), upserted as (
  insert into public.curation_rule_suggestions (
    app_category,
    product_group,
    window_days,
    support_count,
    positive_count,
    precision_score,
    auto_apply_eligible,
    status,
    generated_at,
    notes
  )
  select
    app_category,
    product_group,
    ${Number(windowDays)}::int,
    support_count,
    positive_count,
    precision_score,
    auto_apply_eligible,
    'suggested',
    now(),
    'Generated from curation_events'
  from scored
  on conflict (app_category, product_group, window_days)
  do update set
    support_count = excluded.support_count,
    positive_count = excluded.positive_count,
    precision_score = excluded.precision_score,
    auto_apply_eligible = case
      when public.curation_rule_suggestions.status = 'suggested' then excluded.auto_apply_eligible
      else false
    end,
    status = case
      when public.curation_rule_suggestions.status in ('applied', 'discarded')
        then public.curation_rule_suggestions.status
      else 'suggested'
    end,
    generated_at = excluded.generated_at,
    notes = excluded.notes,
    updated_at = now()
  returning id, auto_apply_eligible, status
), summary_event as (
  insert into public.curation_events (
    event_type,
    entity_type,
    reason,
    after_state,
    metadata,
    actor_type
  )
  values (
    'rule_suggest',
    'rule',
    'Generated curation rule suggestions from manual events.',
    jsonb_build_object(
      'window_days', ${Number(windowDays)},
      'min_support', ${Number(minSupport)},
      'min_positive', ${Number(minPositive)},
      'min_precision', ${Number(minPrecision)}
    ),
    jsonb_build_object(
      'upserted_rows', (select count(*) from upserted),
      'pending_auto_apply', (select count(*) from upserted where status = 'suggested' and auto_apply_eligible = true)
    ),
    'pipeline'
  )
  returning id
)
select
  (select count(*)::int from upserted) as upserted_rows,
  (select count(*)::int from upserted where status = 'suggested' and auto_apply_eligible = true) as pending_auto_apply,
  (select id from summary_event limit 1) as event_id;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const windowDays = Number(args["window-days"] ?? 90);
  const minSupport = Number(args["min-support"] ?? 20);
  const minPositive = Number(args["min-positive"] ?? 10);
  const minPrecision = Number(args["min-precision"] ?? 0.9);

  logInfo("Generating curation rule suggestions", {
    windowDays,
    minSupport,
    minPositive,
    minPrecision,
    checkpointFile: CHECKPOINT_FILE
  });

  const sql = buildSql(windowDays, minSupport, minPositive, minPrecision);
  const result = await runSupabaseQuery({ sql, output: "json" });
  const row = result.parsed.rows?.[0] ?? {};

  const checkpoint = await loadCheckpoint();
  checkpoint.curationRuleSuggestions = {
    windowDays,
    minSupport,
    minPositive,
    minPrecision,
    upsertedRows: Number(row.upserted_rows ?? 0),
    pendingAutoApply: Number(row.pending_auto_apply ?? 0),
    eventId: Number(row.event_id ?? 0) || null,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Curation rule suggestions generated", checkpoint.curationRuleSuggestions);
}

main().catch((error) => {
  logWarn("Curation suggestion generation failed", String(error));
  process.exit(1);
});
