import { logInfo, logWarn, parseArgs, runSupabaseQuery } from "./_utils.mjs";

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function buildEstimateSql(includeRejected) {
  const statuses = includeRejected
    ? "array['unvalidated','likely','rejected']::validation_status_enum[]"
    : "array['unvalidated','likely']::validation_status_enum[]";

  return `
with deletable as (
  select c.id
  from public.establishment_product_candidates c
  where c.source_type = 'rules_generated'
    and c.validation_status = any(${statuses})
    and not exists (
      select 1
      from public.establishment_product_merged m
      where m.establishment_id = c.establishment_id
        and m.canonical_product_id = c.canonical_product_id
    )
)
select count(*)::bigint as deletable_rows
from deletable;
`;
}

function buildDeleteSql(includeRejected) {
  const statuses = includeRejected
    ? "array['unvalidated','likely','rejected']::validation_status_enum[]"
    : "array['unvalidated','likely']::validation_status_enum[]";

  return `
with deleted as (
  delete from public.establishment_product_candidates c
  where c.source_type = 'rules_generated'
    and c.validation_status = any(${statuses})
    and not exists (
      select 1
      from public.establishment_product_merged m
      where m.establishment_id = c.establishment_id
        and m.canonical_product_id = c.canonical_product_id
    )
  returning 1
)
select count(*)::bigint as deleted_rows
from deleted;
`;
}

async function readSizes() {
  const result = await runSupabaseQuery({
    sql: `
select
  pg_database_size(current_database())::bigint as db_size_bytes,
  pg_total_relation_size('public.establishment_product_candidates')::bigint as candidates_size_bytes;
`,
    output: "json"
  });
  return {
    db: Number(result.parsed.rows?.[0]?.db_size_bytes ?? 0),
    candidates: Number(result.parsed.rows?.[0]?.candidates_size_bytes ?? 0)
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = parseBoolean(args["dry-run"], false);
  const includeRejected = parseBoolean(args["include-rejected"], false);
  const vacuumFull = parseBoolean(args["vacuum-full"], false);

  logInfo("Non-serving candidate prune started", {
    dryRun,
    includeRejected,
    vacuumFull
  });

  const beforeSizes = await readSizes();
  const estimateResult = await runSupabaseQuery({
    sql: buildEstimateSql(includeRejected),
    output: "json"
  });
  const deletableRows = Number(estimateResult.parsed.rows?.[0]?.deletable_rows ?? 0);

  logInfo("Non-serving candidate prune estimate", {
    deletableRows
  });

  if (dryRun || deletableRows === 0) {
    logInfo("Prune skipped", {
      reason: dryRun ? "dry-run" : "no-deletable-rows"
    });
    return;
  }

  const deleteResult = await runSupabaseQuery({
    sql: buildDeleteSql(includeRejected),
    output: "json"
  });
  const deletedRows = Number(deleteResult.parsed.rows?.[0]?.deleted_rows ?? 0);

  await runSupabaseQuery({
    sql: "vacuum (analyze) public.establishment_product_candidates;",
    output: "json"
  });

  if (vacuumFull) {
    await runSupabaseQuery({
      sql: "vacuum full public.establishment_product_candidates;",
      output: "json"
    });
  }

  const afterSizes = await readSizes();

  logInfo("Non-serving candidate prune completed", {
    deletedRows,
    dbSizeBeforeBytes: beforeSizes.db,
    dbSizeAfterBytes: afterSizes.db,
    dbSizeDeltaBytes: afterSizes.db - beforeSizes.db,
    candidatesSizeBeforeBytes: beforeSizes.candidates,
    candidatesSizeAfterBytes: afterSizes.candidates,
    candidatesSizeDeltaBytes: afterSizes.candidates - beforeSizes.candidates
  });
}

main().catch((error) => {
  logWarn("Non-serving candidate prune failed", String(error));
  process.exit(1);
});
