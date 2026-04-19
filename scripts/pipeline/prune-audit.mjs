import { logInfo, logWarn, parseArgs, runSupabaseQuery } from "./_utils.mjs";

async function estimatePrunableRows(keepLatestPerCandidate) {
  const sql = `
with ranked as (
  select
    id,
    candidate_id,
    row_number() over (
      partition by candidate_id
      order by changed_at desc, id desc
    ) as rn,
    coalesce(new_row->>'validation_status', old_row->>'validation_status') as validation_status
  from establishment_product_candidate_audit
)
select count(*)::bigint as prunable_rows
from ranked
where rn > greatest(${Number(keepLatestPerCandidate)}, 1)
  and coalesce(validation_status, '') not in ('validated', 'rejected');
`;

  const result = await runSupabaseQuery({ sql, output: "json" });
  return Number(result.parsed.rows?.[0]?.prunable_rows ?? 0);
}

async function pruneAuditRows(keepLatestPerCandidate) {
  const sql = `
select deleted_rows
from prune_establishment_product_candidate_audit(${Number(keepLatestPerCandidate)});
`;
  const result = await runSupabaseQuery({ sql, output: "json" });
  return Number(result.parsed.rows?.[0]?.deleted_rows ?? 0);
}

async function main() {
  const args = parseArgs(process.argv);
  const keepLatestPerCandidate = Number(args["keep-latest-per-candidate"] ?? 2);
  const dryRun = Boolean(args["dry-run"]);

  if (!Number.isFinite(keepLatestPerCandidate) || keepLatestPerCandidate < 1) {
    throw new Error("--keep-latest-per-candidate must be >= 1");
  }

  logInfo("Audit prune started", {
    keepLatestPerCandidate,
    dryRun
  });

  const prunableRows = await estimatePrunableRows(keepLatestPerCandidate);
  logInfo("Audit prune estimate", {
    prunableRows
  });

  if (dryRun) {
    logInfo("Dry run requested. No rows were deleted.");
    return;
  }

  if (prunableRows === 0) {
    logInfo("No audit rows to prune.");
    return;
  }

  const deletedRows = await pruneAuditRows(keepLatestPerCandidate);
  logInfo("Audit prune completed", {
    deletedRows
  });
}

main().catch((error) => {
  logWarn("Audit prune failed", String(error));
  process.exit(1);
});
