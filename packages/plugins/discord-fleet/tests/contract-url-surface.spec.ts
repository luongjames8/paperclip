/**
 * Layer: contract + invariant
 * Assertion type: semantic invariant — every URL-emitting handler must embed companyPrefix
 *   between the host and the /issues/ or /approvals/ segment.
 * Pinned call sites:
 *   src/handlers/issue-created.ts:21 (issueUrl helper)
 *   src/handlers/issue-updated.ts:39 (blocked path)
 *   src/jobs/stuck-detector.ts:31
 * Mutation result: remove companyPrefix from any of those → respective tests go RED
 *
 * AC coverage: AC1, AC2, AC3, AC9
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { Client } from "discord.js";
import type { PaperclipClient } from "../src/api/paperclip.js";

vi.mock("../src/discord/rest.js", () => ({
  postToThread: vi.fn().mockResolvedValue("msg-id-1"),
  postToChannel: vi.fn().mockResolvedValue("msg-id-2"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id-3"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-4"),
}));

vi.mock("../src/render/embeds.js", () => ({
  buildSeedIssueEmbed: vi.fn().mockReturnValue({ title: "seed embed" }),
  buildBlockedEmbed: vi.fn().mockReturnValue({ title: "blocked embed" }),
  buildStuckIssueEmbed: vi.fn().mockReturnValue({ title: "stuck embed" }),
  buildApprovalEmbed: vi.fn().mockReturnValue({ title: "approval embed" }),
}));

// Canonical pattern derived from App.tsx board route tree for issues
const CANONICAL_ISSUE_URL_RE =
  /^https?:\/\/[^/]+\/(?<prefix>[A-Z]+)\/issues\/(?<identifier>[A-Za-z0-9_-]+)$/;

// Pre-fix broken pattern: host/issues/:identifier (no prefix between host and /issues)
const BROKEN_ISSUE_URL_RE = /^https?:\/\/[^/]+\/issues\//;

function makeConfig(companyId: string, companyPrefix: string): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId,
        companyPrefix,
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: { "proj-1": "monitor-channel" },
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://100.98.95.12:3100",
      },
    ],
  };
}

function makeIssueCreatedEvent(companyId: string, identifier: string): PluginEvent {
  return {
    eventId: "evt-contract-ic",
    eventType: "issue.created",
    occurredAt: new Date().toISOString(),
    companyId,
    entityId: "iss-test",
    entityType: "issue",
    payload: {
      identifier,
      title: "Test Issue",
      status: "todo",
      projectId: "proj-1",
      originKind: "routine_execution",
    },
  };
}

function makeIssueUpdatedBlockedEvent(companyId: string, identifier: string): PluginEvent {
  return {
    eventId: "evt-contract-iu",
    eventType: "issue.updated",
    occurredAt: new Date().toISOString(),
    companyId,
    entityId: "iss-test",
    entityType: "issue",
    payload: {
      identifier,
      title: "Test Issue",
      status: "blocked",
      reason: "dependency blocked",
      projectId: "proj-1",
    },
  };
}

function makeStuckIssue(identifier: string) {
  return {
    id: "iss-test",
    identifier,
    title: "Test Stuck Issue",
    status: "in_progress",
    updatedAt: new Date(Date.now() - 8 * 3_600_000).toISOString(), // 8h ago, exceeds 6h threshold
    assigneeId: undefined,
  };
}

describe("issue URL — board canonical route contract", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── issue-created: canonical URL ────────────────────────────────────────────

  it("URL passed to buildSeedIssueEmbed matches /:companyPrefix/issues/:identifier for HIN (AC1)", async () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant
     * Call site pinned: src/handlers/issue-created.ts:21
     * Mutation result: remove companyPrefix from issueUrl() → test RED (URL is /issues/:id, no prefix)
     */
    const { handleIssueCreated } = await import("../src/handlers/issue-created.js");
    const { buildSeedIssueEmbed } = await import("../src/render/embeds.js");
    const harness = createTestHarness({ manifest });

    await handleIssueCreated(
      harness.ctx,
      makeIssueCreatedEvent("c-hin", "HIN-42"),
      {} as Client,
      makeConfig("c-hin", "HIN"),
    );

    const calls = (buildSeedIssueEmbed as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const { issueUrl } = calls[0][0] as { issueUrl: string };

    expect(
      CANONICAL_ISSUE_URL_RE.test(issueUrl),
      `issueUrl "${issueUrl}" must match /:companyPrefix/issues/:identifier`,
    ).toBe(true);
    const m = CANONICAL_ISSUE_URL_RE.exec(issueUrl)!;
    expect(m.groups!.prefix).toBe("HIN");
    expect(m.groups!.identifier).toBe("HIN-42");
  });

  it.each([
    {
      companyId: "a572ed46-aed4-4a71-b624-774b7faddb84",
      prefix: "HIN",
      label: "Hinomaru",
      identifier: "HIN-1",
    },
    {
      companyId: "07589fac-ef50-41ba-afd6-afa1d014260b",
      prefix: "SAF",
      label: "SafeGate",
      identifier: "SAF-1",
    },
    {
      companyId: "5198a4b7-976a-4f4c-93a4-8310683cc08d",
      prefix: "THE",
      label: "Thetis",
      identifier: "THE-1",
    },
    {
      companyId: "synthetic-tcb",
      prefix: "TCB",
      label: "TestCompanyB",
      identifier: "TCB-1",
    },
  ])(
    "[$label] issue-created URL includes $prefix prefix — invariant holds for all 4 companies (AC1)",
    async ({ companyId, prefix, identifier }) => {
      /**
       * Layer: invariant
       * Assertion type: semantic invariant (URL builder must embed companyPrefix for every company)
       * Call site pinned: src/handlers/issue-created.ts:21
       * Mutation result: remove prefix from URL builder → all 4 rows RED
       */
      const { handleIssueCreated } = await import("../src/handlers/issue-created.js");
      const { buildSeedIssueEmbed } = await import("../src/render/embeds.js");
      const harness = createTestHarness({ manifest });

      await handleIssueCreated(
        harness.ctx,
        makeIssueCreatedEvent(companyId, identifier),
        {} as Client,
        makeConfig(companyId, prefix),
      );

      const calls = (buildSeedIssueEmbed as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(1);
      const { issueUrl } = calls[0][0] as { issueUrl: string };

      expect(
        CANONICAL_ISSUE_URL_RE.test(issueUrl),
        `[${prefix}] issueUrl "${issueUrl}" must embed company prefix`,
      ).toBe(true);
      const m = CANONICAL_ISSUE_URL_RE.exec(issueUrl)!;
      expect(m.groups!.prefix).toBe(prefix);
    },
  );

  it("issue-created URL does NOT match /issues/:id pattern (no prefix) — regression guard (AC1)", async () => {
    /**
     * Layer: contract
     * Assertion type: mutation-pin — catches regression to issueUrl() without companyPrefix
     * Call site pinned: src/handlers/issue-created.ts:21
     * Mutation result: revert issueUrl() to `${baseUrl}/issues/${id}` → BROKEN_ISSUE_URL_RE matches → RED
     */
    const { handleIssueCreated } = await import("../src/handlers/issue-created.js");
    const { buildSeedIssueEmbed } = await import("../src/render/embeds.js");
    const harness = createTestHarness({ manifest });

    await handleIssueCreated(
      harness.ctx,
      makeIssueCreatedEvent("c-hin", "HIN-42"),
      {} as Client,
      makeConfig("c-hin", "HIN"),
    );

    const { issueUrl } = (buildSeedIssueEmbed as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      issueUrl: string;
    };
    expect(
      BROKEN_ISSUE_URL_RE.test(issueUrl),
      `issueUrl "${issueUrl}" must NOT match broken /issues/:id pattern (no company prefix)`,
    ).toBe(false);
  });

  // ── issue-updated (blocked path): canonical URL ─────────────────────────────

  it("issue-updated blocked: URL passed to buildBlockedEmbed matches /:companyPrefix/issues/:identifier (AC2)", async () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant
     * Call site pinned: src/handlers/issue-updated.ts:39
     * Mutation result: remove companyPrefix from URL at line 39 → test RED
     */
    const { handleIssueUpdated } = await import("../src/handlers/issue-updated.js");
    const { buildBlockedEmbed } = await import("../src/render/embeds.js");
    const { CoalesceBuffer } = await import("../src/util/coalesce.js");
    const harness = createTestHarness({ manifest });
    const coalescer = new CoalesceBuffer(2000);

    await handleIssueUpdated(
      harness.ctx,
      makeIssueUpdatedBlockedEvent("c-hin", "HIN-42"),
      {} as Client,
      makeConfig("c-hin", "HIN"),
      coalescer,
    );

    const calls = (buildBlockedEmbed as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const { issueUrl } = calls[0][0] as { issueUrl: string };

    expect(
      CANONICAL_ISSUE_URL_RE.test(issueUrl),
      `issueUrl "${issueUrl}" must match /:companyPrefix/issues/:identifier`,
    ).toBe(true);
    const m = CANONICAL_ISSUE_URL_RE.exec(issueUrl)!;
    expect(m.groups!.prefix).toBe("HIN");
    expect(m.groups!.identifier).toBe("HIN-42");
  });

  it("issue-updated blocked URL does NOT match /issues/:id pattern (regression guard) (AC2)", async () => {
    /**
     * Layer: contract
     * Assertion type: mutation-pin
     * Call site pinned: src/handlers/issue-updated.ts:39
     * Mutation result: revert URL to `${paperclipApiUrl}/issues/${identifier}` → BROKEN matches → RED
     */
    const { handleIssueUpdated } = await import("../src/handlers/issue-updated.js");
    const { buildBlockedEmbed } = await import("../src/render/embeds.js");
    const { CoalesceBuffer } = await import("../src/util/coalesce.js");
    const harness = createTestHarness({ manifest });
    const coalescer = new CoalesceBuffer(2000);

    await handleIssueUpdated(
      harness.ctx,
      makeIssueUpdatedBlockedEvent("c-hin", "HIN-42"),
      {} as Client,
      makeConfig("c-hin", "HIN"),
      coalescer,
    );

    const { issueUrl } = (buildBlockedEmbed as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      issueUrl: string;
    };
    expect(
      BROKEN_ISSUE_URL_RE.test(issueUrl),
      `issueUrl "${issueUrl}" must NOT match broken /issues/:id pattern`,
    ).toBe(false);
  });

  // ── stuck-detector: canonical URL ───────────────────────────────────────────

  it("stuck-detector: URL passed to buildStuckIssueEmbed matches /:companyPrefix/issues/:identifier (AC3)", async () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant
     * Call site pinned: src/jobs/stuck-detector.ts:31
     * Mutation result: remove companyPrefix from URL at line 31 → test RED
     */
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { buildStuckIssueEmbed } = await import("../src/render/embeds.js");
    const harness = createTestHarness({ manifest });

    const mockPaperclip = {
      getInProgressIssues: vi.fn().mockResolvedValue([makeStuckIssue("HIN-99")]),
    } as unknown as PaperclipClient;
    const factory = vi.fn().mockResolvedValue(mockPaperclip);

    await runStuckDetector(harness.ctx, {} as Client, makeConfig("c-hin", "HIN"), factory);

    const calls = (buildStuckIssueEmbed as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const { issueUrl } = calls[0][0] as { issueUrl: string };

    expect(
      CANONICAL_ISSUE_URL_RE.test(issueUrl),
      `issueUrl "${issueUrl}" must match /:companyPrefix/issues/:identifier`,
    ).toBe(true);
    const m = CANONICAL_ISSUE_URL_RE.exec(issueUrl)!;
    expect(m.groups!.prefix).toBe("HIN");
  });

  // ── legacy cohort: companyPrefix absent (simulates DB row before field existed) ─

  it("stuck-detector: skips legacy company without companyPrefix — guard fires, no embed built, warn logged (AC9)", async () => {
    /**
     * Layer: invariant (tripwire-tier)
     * Assertion type: semantic invariant — skip guard at src/jobs/stuck-detector.ts:17-19 must fire
     *   when companyPrefix is absent; test is EXPLICIT (not vacuous) — asserts NO embed call
     * Call site pinned: src/jobs/stuck-detector.ts:17-19 (skip guard — `if (!company.companyPrefix?.trim())`)
     * Mutation result: remove guard lines 17-19 → buildStuckIssueEmbed IS called with broken URL
     *   → expect(...).not.toHaveBeenCalled() fails → RED
     *
     * Defect fixed: P1-3 from adversarial B3 — prior version used `if (calls.length > 0) { assert }`
     *   which passes vacuously when calls.length === 0. This rewrite makes the expected-skip explicit.
     */
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { buildStuckIssueEmbed } = await import("../src/render/embeds.js");
    const harness = createTestHarness({ manifest });

    const legacyConfig = {
      botTokenSecretRef: "bot-ref",
      companies: [
        {
          companyId: "c-legacy",
          // companyPrefix intentionally omitted — simulates a DB row inserted before this field existed
          guildId: "g-legacy",
          channels: { digest: "d1", errors: "e1", orphan: "o1" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref",
          paperclipApiUrl: "http://100.98.95.12:3100",
        },
      ],
    } as unknown as DiscordFleetConfig;

    const mockPaperclip = {
      getInProgressIssues: vi.fn().mockResolvedValue([makeStuckIssue("HIN-99")]),
    } as unknown as PaperclipClient;
    const factory = vi.fn().mockResolvedValue(mockPaperclip);

    // Guard must skip company without throwing
    await expect(
      runStuckDetector(harness.ctx, {} as Client, legacyConfig, factory),
    ).resolves.toBeUndefined();

    // EXPLICIT: guard fired — embed must NOT be built
    // Mutation-pin: remove stuck-detector.ts:17-19 → buildStuckIssueEmbed IS called → RED
    expect(
      buildStuckIssueEmbed,
      "buildStuckIssueEmbed must NOT be called for legacy company without companyPrefix — skip guard must fire",
    ).not.toHaveBeenCalled();

    // EXPLICIT: warn must be logged so operators can diagnose the skip
    const warnEntry = harness.logs.find(
      (l) => l.level === "warn" && l.message.includes("companyPrefix"),
    );
    expect(
      warnEntry,
      "warn log must be emitted when companyPrefix is missing",
    ).toBeDefined();
    expect(
      warnEntry?.meta,
      "warn log must include companyId for operator debugging",
    ).toMatchObject({ companyId: "c-legacy" });
  });
});
