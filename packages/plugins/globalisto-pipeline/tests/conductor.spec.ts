import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Agent } from "@paperclipai/shared";
import { nextAction, type RunState } from "../src/engine/conductor.js";
import type { StepSpec } from "../src/engine/types.js";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

// ── pure unit tests for nextAction ───────────────────────────────────────────

const steps: StepSpec[] = [
  {
    id: "step:a",
    prompt: "prompts/a.md",
    inputs: [],
    outputs: ["A.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "step:b",
    prompt: "prompts/b.md",
    inputs: ["A.yaml"],
    outputs: ["B.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
];

function runState(partial: Partial<RunState>): RunState {
  return {
    completedStepIds: [],
    activeStepId: null,
    stepComplete: false,
    ...partial,
  };
}

describe("nextAction (pure unit)", () => {
  it("returns invoke for the first step when nothing is active or completed", () => {
    const action = nextAction(runState({}), steps);
    expect(action.kind).toBe("invoke");
    if (action.kind === "invoke") {
      expect(action.step.id).toBe("step:a");
    }
  });

  it("returns wait when a step is active but not complete", () => {
    const action = nextAction(runState({ activeStepId: "step:a", stepComplete: false }), steps);
    expect(action.kind).toBe("wait");
  });

  it("returns advance when a step is active and complete", () => {
    const action = nextAction(runState({ activeStepId: "step:a", stepComplete: true }), steps);
    expect(action.kind).toBe("advance");
    if (action.kind === "advance") {
      expect(action.step.id).toBe("step:a");
    }
  });

  it("returns complete when all steps are done and nothing active", () => {
    const action = nextAction(
      runState({ completedStepIds: ["step:a", "step:b"], activeStepId: null }),
      steps,
    );
    expect(action.kind).toBe("complete");
  });

  it("returns invoke for the next incomplete step after one is completed", () => {
    const action = nextAction(
      runState({ completedStepIds: ["step:a"], activeStepId: null }),
      steps,
    );
    expect(action.kind).toBe("invoke");
    if (action.kind === "invoke") {
      expect(action.step.id).toBe("step:b");
    }
  });
});

// ── integration smoke via createTestHarness ───────────────────────────────────

function makeAgent(id: string, companyId: string, name: string): Agent {
  const now = new Date();
  return {
    id,
    companyId,
    name,
    urlKey: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    role: "general",
    title: null,
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("conductor integration smoke (harness)", () => {
  it("manifest is valid", () => {
    expect(() => pluginManifestV1Schema.parse(manifest)).not.toThrow();
  });

  it("drives ≥2 steps, auto-passes human steps, and advances state correctly", async () => {
    const companyId = randomUUID();
    const glm5AgentId = randomUUID();
    const qwen37AgentId = randomUUID();

    const harness = createTestHarness({ manifest });
    harness.seed({
      agents: [
        makeAgent(glm5AgentId, companyId, "globalisto-worker-glm5"),
        makeAgent(qwen37AgentId, companyId, "globalisto-worker-qwen37"),
      ],
    });

    // Track invoke calls
    const invokeCalls: Array<{ agentId: string; companyId: string; prompt: string }> = [];
    let invokeCallCount = 0;
    harness.ctx.agents.invoke = async (agentId, cId, opts) => {
      invokeCalls.push({ agentId, companyId: cId, prompt: opts.prompt });
      invokeCallCount++;
      return { runId: `mock-run-${invokeCallCount}` };
    };

    await plugin.definition.setup(harness.ctx);

    // Start a pipeline run
    const result = await harness.performAction<{ runId: string; issueId: string }>("start", {
      topic: "german_engineering",
      profile: "mixed",
      companyId,
    });

    expect(result.runId).toEqual(expect.any(String));
    expect(result.issueId).toEqual(expect.any(String));

    // Verify an issue was created with the right title
    const createdIssue = await harness.ctx.issues.get(result.issueId, companyId);
    expect(createdIssue?.title).toBe("pipeline: german_engineering");

    // Verify INSERT was attempted
    expect(harness.dbExecutes.length).toBeGreaterThan(0);
    const insertExec = harness.dbExecutes.find((e) => e.sql.toLowerCase().includes("insert"));
    expect(insertExec).toBeTruthy();

    // ── Step 1: conductor runs, discovers first step → invoke ────────────────
    // Reset dbExecutes tracking between conductor runs isn't needed — just check total growth
    const execCountBefore = harness.dbExecutes.length;

    // Patch db.query to return the pipeline_runs row we "inserted"
    const mockRunId = result.runId;
    const mockIssueId = result.issueId;

    harness.ctx.db.query = async (sql: string) => {
      if (sql.includes("pipeline_runs") && sql.includes("status='running'")) {
        return [
          {
            id: mockRunId,
            company_id: companyId,
            topic: "german_engineering",
            profile: "mixed",
            status: "running",
            completed_step_ids: "[]",
            active_step_id: null,
            active_worker_run_id: null,
            active_issue_id: mockIssueId,
            step_complete: false,
            error: null,
          },
        ] as any[];
      }
      return [];
    };

    await harness.runJob("conductor");

    // First non-human step in THEMATIC_STEPS is discovery:step_1 (sonnet → globalisto-worker-qwen37 in mixed)
    expect(invokeCalls.length).toBe(1);
    const firstCall = invokeCalls[0];
    expect(firstCall.agentId).toBe(qwen37AgentId); // sonnet → qwen37 in "mixed"
    expect(firstCall.prompt).toContain("discovery:step_1");

    // Record the worker runId returned from mock invoke
    const workerRunId = "mock-run-1";

    // ── Step 2: fire agent.run.finished → marks step_complete=true ───────────
    await harness.emit(
      "agent.run.finished",
      { status: "completed" },
      { entityId: workerRunId },
    );

    const updateExec = harness.dbExecutes.find(
      (e) => e.sql.includes("step_complete=true") && e.params?.includes(workerRunId),
    );
    expect(updateExec).toBeTruthy();

    // ── Step 3: conductor runs again, sees step complete → advance ────────────
    // Simulate the DB now reflects the active step set + step_complete=true
    harness.ctx.db.query = async (sql: string) => {
      if (sql.includes("pipeline_runs") && sql.includes("status='running'")) {
        return [
          {
            id: mockRunId,
            company_id: companyId,
            topic: "german_engineering",
            profile: "mixed",
            status: "running",
            completed_step_ids: "[]",
            active_step_id: "discovery:step_1",
            active_worker_run_id: workerRunId,
            active_issue_id: mockIssueId,
            step_complete: true,
            error: null,
          },
        ] as any[];
      }
      return [];
    };

    await harness.runJob("conductor");

    // After advancing, the conductor should have executed an UPDATE that appends the step id
    const advanceExec = harness.dbExecutes.find(
      (e) =>
        e.sql.includes("completed_step_ids") &&
        e.sql.includes("pipeline_runs") &&
        e.params?.some((p) => typeof p === "string" && p.includes("discovery:step_1")),
    );
    expect(advanceExec).toBeTruthy();

    // ── Step 4: conductor runs again with step advanced → invokes step 2 ─────
    harness.ctx.db.query = async (sql: string) => {
      if (sql.includes("pipeline_runs") && sql.includes("status='running'")) {
        return [
          {
            id: mockRunId,
            company_id: companyId,
            topic: "german_engineering",
            profile: "mixed",
            status: "running",
            completed_step_ids: JSON.stringify(["discovery:step_1"]),
            active_step_id: null,
            active_worker_run_id: null,
            active_issue_id: mockIssueId,
            step_complete: false,
            error: null,
          },
        ] as any[];
      }
      return [];
    };

    await harness.runJob("conductor");

    // Should have invoked the second step now
    expect(invokeCalls.length).toBe(2);
    const secondCall = invokeCalls[1];
    expect(secondCall.agentId).toBe(qwen37AgentId); // discovery:step_1_5 is also sonnet → qwen37
  });

  it("setup runs without throwing", async () => {
    const harness = createTestHarness({ manifest });
    harness.ctx.agents.invoke = async () => ({ runId: randomUUID() });
    await expect(plugin.definition.setup(harness.ctx)).resolves.not.toThrow();
  });
});
