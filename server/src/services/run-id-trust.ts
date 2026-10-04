import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";

// The single derivation point for turning a caller-supplied run id (traced
// back to the X-Paperclip-Run-Id request header, via req.actor.runId /
// getActorInfo) into a value every write-sink can trust.
//
// Two live-incident classes this closes at once (2026-07-11):
//   1. A MALFORMED header (not uuid-shaped) passed straight to eq() against a
//      Postgres uuid column throws "invalid input syntax for type uuid",
//      uncaught -> bare 500 (isUuidLike alone already guarded some sinks
//      against this, but not all of them).
//   2. A WELL-FORMED but STALE/NONEXISTENT run id (uuid-shaped, but no
//      matching heartbeat_runs row — e.g. a run that was since pruned, or a
//      caller-fabricated uuid) still passes isUuidLike and still violates the
//      created_by_run_id / run_id foreign key at insert time -> the same bare
//      500, just one guard layer deeper.
//
// resolveVerifiedRunId collapses both into a single indexed existence check:
// a non-null return is GUARANTEED to be a real heartbeat_runs.id. Every
// write-sink (issue_comments.created_by_run_id/deleted_by_run_id,
// activity_log.run_id, issue_execution_decisions.created_by_run_id,
// document_annotation_comments.created_by_run_id,
// issue_tree_holds.created_by_run_id/released_by_run_id,
// routine_revisions.created_by_run_id) must consume ONLY this value, never
// the raw actor.runId.
export async function resolveVerifiedRunId(
  // Structural (Pick<Db, "select">), not the full Db type — callers pass
  // either the top-level db handle or a db.transaction(tx) handle
  // interchangeably (so verification and the write it guards happen against
  // the SAME transaction), and tx lacks Db's `$client` property.
  db: Pick<Db, "select">,
  runId: string | null | undefined,
): Promise<string | null> {
  if (!runId || !isUuidLike(runId)) return null;
  const row = await db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row ? runId : null;
}
