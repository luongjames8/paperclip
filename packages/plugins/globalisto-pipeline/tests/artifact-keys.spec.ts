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

    // Stub config.get + secrets.resolve so buildRestClient works
    vi.spyOn(harness.ctx.config, "get").mockResolvedValue({
      paperclipApiUrl: "http://paperclip:3100",
      paperclipApiKeySecretRef: "sec-uuid",
    });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("fake-key");

    // Track SDK documents.get calls (should be zero — REST path replaces them)
    const sdkDocGetSpy = vi.spyOn(harness.ctx.issues.documents, "get");

    // Track REST fetch calls to assert list-documents is called
    const documentListFetches: string[] = [];
    vi.spyOn(harness.ctx.http, "fetch").mockImplementation(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (opts?.method === "GET" && urlStr.includes("/api/issues/") && urlStr.includes("/documents")) {
        documentListFetches.push(urlStr);
        // Return the artifact the step needs so the conductor doesn't skip it
        return {
          status: 200,
          json: async () => [{ key: expectedKey, body: "x" }],
        } as Response;
      }
      if (opts?.method === "GET" && urlStr.includes("/api/companies/") && urlStr.includes("/agents")) {
        return {
          status: 200,
          json: async () => [
            { id: randomUUID(), name: "globalisto-worker-glm5" },
            { id: randomUUID(), name: "globalisto-worker-qwen37" },
          ],
        } as Response;
      }
      if (opts?.method === "POST" && urlStr.includes("/wakeup")) {
        return {
          status: 200,
          json: async () => ({ id: `mock-${randomUUID()}` }),
        } as Response;
      }
      return { status: 200, json: async () => ({}) } as Response;
    });

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

    // The SDK documents.get should NOT have been called (REST path replaces it)
    expect(sdkDocGetSpy).not.toHaveBeenCalled();

    // The REST list-documents endpoint IS fetched (at least once for the target step)
    expect(documentListFetches.length).toBeGreaterThan(0);
    expect(documentListFetches.some((u) => u.includes(issueId))).toBe(true);
  });
});
