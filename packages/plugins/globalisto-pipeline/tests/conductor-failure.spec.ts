import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

// ── regression: terminal worker-run failure handling ──────────────────────────
//
// The paperclip host emits DISTINCT events per terminal heartbeat-run status
// (server/src/services/heartbeat.ts:4487-4497):
//   succeeded          -> agent.run.finished
//   failed | timed_out -> agent.run.failed
//   cancelled          -> agent.run.cancelled
//
// Before the fix the conductor subscribed to agent.run.finished ONLY, so a
// failed/cancelled worker run reached no handler: step_complete stayed false,
// active_step_id stayed set, nextAction() returned "wait" every tick, and the
// pipeline run stalled forever with no operator signal. Observed live
// (2026-06-07): globalisto qwen37 heartbeat_runs all status=failed; pipeline_run
// never advanced.
//
// Policy (decided): HALT + SURFACE — mark the pipeline run failed and record the
// worker error. No auto-retry in v1.

describe("conductor run-failure handling (regression)", () => {
  it("agent.run.failed marks the pipeline run failed and records the error", async () => {
    /**
     * Layer: integration (plugin run-lifecycle event handler via SDK test harness)
     * Assertion type: semantic invariant (a terminal worker failure halts + surfaces, not dropped)
     * Call site pinned: src/worker.ts ctx.events.on("agent.run.failed", ...) → haltPipelineForWorkerRun
     * Mutation result: remove the agent.run.failed handler → test goes RED (0 db.execute references the run)
     */
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);

    const workerRunId = `worker-run-${randomUUID()}`;
    await harness.emit(
      "agent.run.failed",
      { status: "failed", error: "gateway unreachable" },
      { entityId: workerRunId },
    );

    const halt = harness.dbExecutes.find(
      (e) =>
        e.sql.includes("status='failed'") &&
        (e.params ?? []).some((p) => p === workerRunId),
    );
    expect(halt).toBeTruthy();
    // the recorded error propagates the worker error string
    expect((halt!.params ?? []).some((p) => typeof p === "string" && p.includes("gateway unreachable"))).toBe(true);
  });

  it("agent.run.cancelled also halts the pipeline run", async () => {
    /**
     * Layer: integration
     * Assertion type: semantic invariant (cancelled is a terminal non-success too)
     * Call site pinned: src/worker.ts ctx.events.on("agent.run.cancelled", ...) → haltPipelineForWorkerRun
     * Mutation result: remove the agent.run.cancelled handler → RED
     */
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);

    const workerRunId = `worker-run-${randomUUID()}`;
    await harness.emit("agent.run.cancelled", { status: "cancelled" }, { entityId: workerRunId });

    const halt = harness.dbExecutes.find(
      (e) =>
        e.sql.includes("status='failed'") &&
        (e.params ?? []).some((p) => p === workerRunId),
    );
    expect(halt).toBeTruthy();
  });
});
