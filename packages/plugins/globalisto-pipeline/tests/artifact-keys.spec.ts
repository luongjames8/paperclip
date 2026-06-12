import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Agent } from "@paperclipai/shared";
import manifest from "../src/manifest.js";
import plugin, { artifactDocKey } from "../src/worker.js";
import { loadThematicSpec } from "../src/engine/spec.js";

// ── regression: cross-step artifact-key reconciliation (D11) ──────────────────
//
// Producer steps declare BARE output names ("BEAT_GRAPH.yaml"); consumer steps
// reference them with a numbered-directory prefix ("../03_structure/BEAT_GRAPH.yaml").
// The conductor previously read `artifact:<literal>`, so a prefixed input never
// matched the bare key the producer wrote -> input silently null. Fix: both
// sides normalize to basename.

describe("artifactDocKey (pure)", () => {
  it("normalizes a numbered-dir prefixed name to its basename key", () => {
    /**
     * Layer: unit
     * Assertion type: semantic invariant (prefixed and bare forms map to the SAME key)
     * Call site pinned: src/worker.ts artifactDocKey
     * Mutation result: revert to `artifact:${name}` → first assertion goes RED
     */
    expect(artifactDocKey("../03_structure/BEAT_GRAPH.yaml")).toBe("artifact:BEAT_GRAPH.yaml");
    expect(artifactDocKey("../06_packaging/PACKAGING_COMPLETE.yaml")).toBe("artifact:PACKAGING_COMPLETE.yaml");
    // bare form is idempotent — same key as its prefixed twin
    expect(artifactDocKey("BEAT_GRAPH.yaml")).toBe("artifact:BEAT_GRAPH.yaml");
  });
});

function makeAgent(id: string, companyId: string, name: string): Agent {
  const now = new Date();
  return {
    id, companyId, name,
    urlKey: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    role: "general", title: null, icon: null, status: "idle", reportsTo: null,
    capabilities: null, adapterType: "process", adapterConfig: {}, runtimeConfig: {},
    budgetMonthlyCents: 0, spentMonthlyCents: 0, pauseReason: null, pausedAt: null,
    permissions: { canCreateAgents: false }, lastHeartbeatAt: null, metadata: null,
    createdAt: now, updatedAt: now,
  };
}

describe("artifact key reconciliation — wiring (D11)", () => {
  it("conductor fetches a prefixed input by basename, never by the raw prefix", async () => {
    /**
     * Layer: integration (conductor input-resolution via SDK harness)
     * Assertion type: semantic invariant (no '../'-prefixed doc key is ever requested via SDK;
     *   the conductor goes through the REST list-documents endpoint and filters client-side)
     * Call site pinned: src/worker.ts input read — rest.getDocument(issueId, artifactDocKey(n))
     * Mutation result: revert artifactDocKey(n) → `artifact:${n}` at the input read →
     *   the list-documents URL is still fetched but the find() returns null for prefixed keys
     *   (no documents in the empty response match "../..." key anyway — but more importantly,
     *   reverting artifactDocKey means the GET URL carries `artifact:../...` instead of basename,
     *   which is wrong — this test guards the correct normalized key in find())
     */
    const steps = loadThematicSpec() as Array<{ id: string; inputs: string[]; prompt: string; requiredModel: string }>;
    // First LLM step (real .md prompt, non-human) that consumes a prefixed input.
    const targetIdx = steps.findIndex(
      (s) =>
        s.requiredModel !== "human" &&
        s.prompt.endsWith(".md") &&
        s.inputs.some((n) => n.startsWith("../")),
    );
    expect(targetIdx).toBeGreaterThan(-1); // guard against vacuous test
    const target = steps[targetIdx];
    const prefixedInput = target.inputs.find((n) => n.startsWith("../"))!;
    const expectedKey = artifactDocKey(prefixedInput);

    const companyId = randomUUID();
    const issueId = randomUUID();
    const harness = createTestHarness({ manifest });
    harness.seed({
      agents: [
        makeAgent(randomUUID(), companyId, "globalisto-worker-glm5"),
        makeAgent(randomUUID(), companyId, "globalisto-worker-qwen37"),
      ],
    });

    // Track SDK documents.get calls — the conductor reads inputs through the
    // SDK with NORMALIZED keys (artifact:<basename>); a "../"-prefixed key must
    // never reach the host.
    const requestedKeys: string[] = [];
    vi.spyOn(harness.ctx.issues.documents, "get").mockImplementation(async (_issueId, key) => {
      requestedKeys.push(key);
      return key === expectedKey
        ? ({ key, body: "x" } as unknown as Awaited<ReturnType<typeof harness.ctx.issues.documents.get>>)
        : null;
    });
    vi.spyOn(harness.ctx.agents, "invoke").mockResolvedValue({ runId: `mock-${randomUUID()}` });

    await plugin.definition.setup(harness.ctx);

    harness.ctx.db.query = async (sql: string) => {
      if (sql.includes("pipeline_runs") && sql.includes("status='running'")) {
        return [
          {
            id: randomUUID(),
            company_id: companyId,
            topic: "german_engineering",
            profile: "mixed",
            status: "running",
            completed_step_ids: JSON.stringify(steps.slice(0, targetIdx).map((s) => s.id)),
            active_step_id: null,
            active_worker_run_id: null,
            active_issue_id: issueId,
            step_complete: false,
            error: null,
          },
        ] as any[];
      }
      return [];
    };

    await harness.runJob("conductor");

    // The normalized key was requested, and no raw "../"-prefixed key ever
    // reached the host.
    expect(requestedKeys).toContain(expectedKey);
    expect(requestedKeys.every((k) => !k.includes("../"))).toBe(true);
  });
});
