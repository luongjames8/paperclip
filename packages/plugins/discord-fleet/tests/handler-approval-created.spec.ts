import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postToThread: vi.fn().mockResolvedValue("msg-id-1"),
  postToChannel: vi.fn().mockResolvedValue("msg-id-2"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id-3"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-4"),
  postEmbedsToChannel: vi.fn().mockResolvedValue("msg-id-5"),
}));

vi.mock("../src/render/issue-docs.js", async (importOriginal) => {
  // importOriginal keeps real exports (chunkEmbedsForDiscord, etc.) that the
  // postsBatch structured-render path also uses — only renderIssueDocs is
  // stubbed for this file's rich-renderer-integration assertions.
  const actual = await importOriginal<typeof import("../src/render/issue-docs.js")>();
  return {
    ...actual,
    renderIssueDocs: vi.fn().mockReturnValue([]),
  };
});

vi.mock("../src/api/paperclip.js", () => ({
  PaperclipClient: vi.fn().mockImplementation(() => ({
    getApprovalById: vi.fn().mockResolvedValue(null),
    getApprovalIssues: vi.fn().mockResolvedValue([]),
    listIssueDocuments: vi.fn().mockResolvedValue([]),
    addApprovalComment: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../src/render/embeds.js", async (importOriginal) => {
  // importOriginal keeps real exports (safe, enforceEmbedLimits, etc.) that
  // ../src/render/posts-batch.js depends on — only the build*Embed/ActionRow
  // helpers below are stubbed for this file's assertions.
  const actual = await importOriginal<typeof import("../src/render/embeds.js")>();
  return {
    ...actual,
    buildApprovalEmbed: vi.fn().mockReturnValue({ title: "approval embed" }),
    buildSeedIssueEmbed: vi.fn().mockReturnValue({ title: "seed embed" }),
    buildBlockedEmbed: vi.fn().mockReturnValue({ title: "blocked embed" }),
    buildApprovalActionRow: vi.fn().mockReturnValue({ type: 1, components: [] }),
    APPROVAL_BUTTON_PREFIX: { approve: "approval-approve:", reject: "approval-reject:" },
  };
});

function makeConfig(): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
    ],
  };
}

function makeApprovalCreatedEvent(
  payloadOverrides: Record<string, unknown> = {},
  eventOverrides: Partial<PluginEvent> = {},
): PluginEvent {
  return {
    eventId: "evt-a1",
    eventType: "approval.created",
    occurredAt: new Date().toISOString(),
    companyId: "c1",
    entityId: "appr-001",
    entityType: "approval",
    payload: {
      approvalId: "appr-001",
      approvalType: "budget",
      issueId: "iss-1",
      identifier: "ISS-1",
      ...payloadOverrides,
    },
    ...eventOverrides,
  };
}

function makeMockClient(): Client {
  return {} as Client;
}

describe("handleApprovalCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approval posts embed to channel + records approvalId in state", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeApprovalCreatedEvent();
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(client, "o1", expect.anything(), expect.anything());

    const pending = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: "pending-approvals",
    });
    expect(pending).toContain("appr-001");
  });

  it("approval with different approvalId also posts to channel and records state", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeApprovalCreatedEvent({
      approvalId: "appr-002",
      issueId: "iss-no-thread",
      identifier: "ISS-2",
    });
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(client, "o1", expect.anything(), expect.anything());

    const pending = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: "pending-approvals",
    });
    expect(pending).toContain("appr-002");
  });
});

// ─── approvalsChannelsByType routing + Bug 2.5 (PR-A) ────────────────────────
//
// The plugin previously ignored the root-level approvalsChannelsByType field
// (Bug 2) and silently dropped proposedComment on the orphan-fallback path
// (Bug 2.5). PR-A: regex-route approvals to fixed work-threads by title;
// chunk + post proposedComment on EVERY path including fallback.

describe("handleApprovalCreated — approvalsChannelsByType + Bug 2.5", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches approvalsChannelsByType regex → posts embed to matched thread + chunks proposedComment", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    config.approvalsChannelsByType = {
      c1: [
        ["[Cc]arousel", "carousels-thread"],
        ["content batch|article batch", "content-batch-thread"],
      ],
    };
    const client = makeMockClient();

    const event = makeApprovalCreatedEvent({
      approvalId: "appr-carousel-1",
      title: "Carousel for Asakusa morning route",
      proposedComment:
        "## Slide 1\nIntro copy here.\n\n## Slide 2\nBody copy here.\n\n## Slide 3\nCTA copy here.",
    });
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(
      client,
      "carousels-thread",
      expect.anything(),
      expect.anything(),
    );
    // Chunks (one per ## section) posted as follow-ups into same thread.
    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "carousels-thread",
      expect.stringContaining("Slide 1"),
    );
    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "carousels-thread",
      expect.stringContaining("Slide 2"),
    );
  });

  it("no regex match → falls back to companyConfig.approvalFallbackChannelId (NOT channels.orphan) + chunks proposedComment", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    config.approvalsChannelsByType = {
      c1: [["[Cc]arousel", "carousels-thread"]],
    };
    // Per-company fallback (P2 fix: was previously root-level which leaked
    // across companies in multi-company deployments).
    config.companies[0].approvalFallbackChannelId = "system-dump-channel";
    const client = makeMockClient();

    const event = makeApprovalCreatedEvent({
      approvalId: "appr-unmatched",
      title: "Strategist proposal review",
      proposedComment: "## Section A\nbody A\n\n## Section B\nbody B",
    });
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(
      client,
      "system-dump-channel",
      expect.anything(),
      expect.anything(),
    );
    expect(postEmbedToChannel).not.toHaveBeenCalledWith(client, "o1", expect.anything(), expect.anything());
    // Bug 2.5 lock: chunks ARE posted on fallback path.
    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "system-dump-channel",
      expect.stringContaining("Section A"),
    );
    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "system-dump-channel",
      expect.stringContaining("Section B"),
    );
  });

  it("empty approvalsChannelsByType → graceful fallback to companyConfig.approvalFallbackChannelId", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    config.approvalsChannelsByType = { c1: [] };
    config.companies[0].approvalFallbackChannelId = "system-dump-channel";
    const client = makeMockClient();

    const event = makeApprovalCreatedEvent({ approvalId: "appr-empty-cfg" });
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(
      client,
      "system-dump-channel",
      expect.anything(),
      expect.anything(),
    );
  });

  it("backward compat: companyConfig.approvalFallbackChannelId absent → falls back to channels.orphan", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    // Per-company approvalFallbackChannelId intentionally unset.
    const client = makeMockClient();

    const event = makeApprovalCreatedEvent({ approvalId: "appr-legacy" });
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(client, "o1", expect.anything(), expect.anything());
  });

  it("per-company scoping: two companies with different fallbacks route their own approvals correctly", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config: DiscordFleetConfig = {
      botTokenSecretRef: "bot-ref",
      companies: [
        {
          companyId: "c1",
          guildId: "g1",
          channels: { digest: "d1", errors: "e1", orphan: "orphan-c1" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref1",
          paperclipApiUrl: "http://localhost:3000",
          companyPrefix: "tc1",
          approvalFallbackChannelId: "c1-fallback",
        },
        {
          companyId: "c2",
          guildId: "g2",
          channels: { digest: "d2", errors: "e2", orphan: "orphan-c2" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref2",
          paperclipApiUrl: "http://localhost:3000",
          companyPrefix: "tc2",
          approvalFallbackChannelId: "c2-fallback",
        },
      ],
    };
    const client = makeMockClient();

    await handleApprovalCreated(
      harness.ctx,
      makeApprovalCreatedEvent({ approvalId: "appr-c1" }, { companyId: "c1" }),
      client,
      config,
    );
    await handleApprovalCreated(
      harness.ctx,
      makeApprovalCreatedEvent({ approvalId: "appr-c2" }, { companyId: "c2" }),
      client,
      config,
    );

    // c1's approval goes to c1's fallback, c2's to c2's — no cross-company leak.
    expect(postEmbedToChannel).toHaveBeenCalledWith(client, "c1-fallback", expect.anything(), expect.anything());
    expect(postEmbedToChannel).toHaveBeenCalledWith(client, "c2-fallback", expect.anything(), expect.anything());
  });

  it("Bug 2.5 regression lock: orphan-fallback path chunks proposedComment, not just embed", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    // No approvalsChannelsByType, no approvalFallbackChannelId → orphan path.
    const client = makeMockClient();

    const event = makeApprovalCreatedEvent({
      approvalId: "appr-bug25",
      proposedComment: "## Title\nProposed body content here that operators must see.",
    });
    await handleApprovalCreated(harness.ctx, event, client, config);

    // The bug was: only the embed posted on this path. Lock: chunks ALSO post.
    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "o1",
      expect.stringContaining("Proposed body content"),
    );
  });
});

// ─── approvalType field-read — paperclip canonical vs legacy ─────────────────
//
// server/src/routes/approvals.ts:118 emits `details: { type: approval.type }`,
// which activity-log spreads into `payload`. The plugin previously read
// `payload.approvalType` only and showed "unknown" on every real event.
// Canonical field is `payload.type`; `payload.approvalType` kept as fallback.

describe("handleApprovalCreated — approvalType field-read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers payload.type (canonical paperclip field) over fallback", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { buildApprovalEmbed } = await import("../src/render/embeds.js");

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      type: "request_board_approval",
      approvalType: undefined, // explicit absence; the canonical field is what real paperclip events carry
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), makeConfig());

    expect(buildApprovalEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ approvalType: "request_board_approval" }),
    );
  });

  it("falls back to payload.approvalType when payload.type is absent (legacy / unit-test fixtures)", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { buildApprovalEmbed } = await import("../src/render/embeds.js");

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      type: undefined,
      approvalType: "legacy_budget",
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), makeConfig());

    expect(buildApprovalEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ approvalType: "legacy_budget" }),
    );
  });

  it("prefers payload.type when BOTH are present (canonical wins)", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { buildApprovalEmbed } = await import("../src/render/embeds.js");

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      type: "request_board_approval",
      approvalType: "should-not-be-used",
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), makeConfig());

    expect(buildApprovalEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ approvalType: "request_board_approval" }),
    );
  });

  it("falls through to 'unknown' when neither field is set", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { buildApprovalEmbed } = await import("../src/render/embeds.js");

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      type: undefined,
      approvalType: undefined,
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), makeConfig());

    expect(buildApprovalEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ approvalType: "unknown" }),
    );
  });
});

// ─── Two-phase marker dedup guard ────────────────────────────────────────────
//
// SEEN_APPROVALS_KEY is gone. The new mechanism uses per-approval state keys:
//   POSTING_MARKER_PREFIX + approvalId  → number (timestamp ms) written BEFORE send
//   POSTED_MARKER_PREFIX  + approvalId  → ISO string written AFTER Discord confirms
//
// Semantics:
//   (a) posted marker present → skip entirely
//   (b) posting marker holds a fresh timestamp (< POSTING_STALE_MS) → skip (concurrent in-flight)
//   (c) posting marker absent or stale → proceed; set posting marker then send
//   On header-send failure: set posting marker to 0 (not delete); rethrow.
//   On header-send success: set posted marker to ISO string.

describe("handleApprovalCreated — two-phase marker dedup guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedup: second call with same approvalId is a no-op (no posts)", async () => {
    const { handleApprovalCreated, POSTED_MARKER_PREFIX } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const event = makeApprovalCreatedEvent();

    await handleApprovalCreated(harness.ctx, event, client, config);
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);  // first call posted; second was no-op

    // posted marker must be an ISO string
    const posted = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: `${POSTED_MARKER_PREFIX}appr-001` });
    expect(typeof posted).toBe("string");
    expect(new Date(posted as string).getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("dedup survives PENDING_APPROVALS_KEY wipe (digest semantics)", async () => {
    const { handleApprovalCreated, POSTED_MARKER_PREFIX, PENDING_APPROVALS_KEY } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const event = makeApprovalCreatedEvent();

    await handleApprovalCreated(harness.ctx, event, client, config);

    // Simulate digest wiping PENDING (jobs/digest.ts:100):
    await harness.ctx.state.set({ scopeKind: "company", scopeId: "c1", stateKey: PENDING_APPROVALS_KEY }, []);

    await handleApprovalCreated(harness.ctx, event, client, config);

    // posted marker is still set → dedup works even after pending wipe
    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    const posted = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: `${POSTED_MARKER_PREFIX}appr-001` });
    expect(posted).toBeTruthy();
  });

  it("PENDING_APPROVALS_KEY is also populated (digest job still sees the approval)", async () => {
    const { handleApprovalCreated, PENDING_APPROVALS_KEY } = await import("../src/handlers/approval-created.js");

    const harness = createTestHarness({ manifest });
    await handleApprovalCreated(harness.ctx, makeApprovalCreatedEvent(), makeMockClient(), makeConfig());

    const pending = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: PENDING_APPROVALS_KEY });
    expect(pending).toEqual(["appr-001"]);
  });

  it("duplicate delivery with inter-event gap: second invocation after guard is written posts nothing (live 2026-07-02 bug)", async () => {
    // The live incident: two approval.created events for the same approvalId
    // 500 ms apart. Fix: posted marker is written only after Discord confirms the
    // send, and posting marker is written before the send so a concurrent
    // duplicate delivery within POSTING_STALE_MS is suppressed.
    // This test serialises the two invocations (second starts after first completes).
    const { handleApprovalCreated, POSTED_MARKER_PREFIX } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const event = makeApprovalCreatedEvent();

    // First delivery: processes and writes posted marker before returning.
    await handleApprovalCreated(harness.ctx, event, client, config);
    // Second delivery (500 ms later in production): posted marker already set → no-op.
    await handleApprovalCreated(harness.ctx, event, client, config);

    // Only ONE card posted; second invocation hit the guard.
    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);

    // posted marker is an ISO string (written after confirmed send)
    const posted = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: `${POSTED_MARKER_PREFIX}appr-001` });
    expect(typeof posted).toBe("string");
  });

  it("failed header send sets posting marker to 0 so a retried delivery can post (codex P2)", async () => {
    // On header-send failure the handler sets posting marker to 0 (not deletes it)
    // so the stale-marker check sees it as stale and retried deliveries proceed.
    // posted marker must NOT exist after a failure.
    const { handleApprovalCreated, POSTED_MARKER_PREFIX, POSTING_MARKER_PREFIX } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const event = makeApprovalCreatedEvent();

    // First delivery: header send fails.
    (postEmbedToChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("send failed"));
    await expect(handleApprovalCreated(harness.ctx, event, client, config)).rejects.toThrow("send failed");

    // posted marker must NOT exist — card is retryable
    const postedAfterFailure = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: `${POSTED_MARKER_PREFIX}appr-001` });
    expect(postedAfterFailure).toBeNull();

    // posting marker must be 0 (failed-send rollback signal)
    const postingAfterFailure = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: `${POSTING_MARKER_PREFIX}appr-001` });
    expect(postingAfterFailure).toBe(0);

    // Retried delivery: posting marker is 0 (stale → proceed) so the card posts.
    await handleApprovalCreated(harness.ctx, event, client, config);
    expect(postEmbedToChannel).toHaveBeenCalledTimes(2);

    // After successful retry: posted marker is now set as ISO string
    const postedAfterRetry = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: `${POSTED_MARKER_PREFIX}appr-001` });
    expect(typeof postedAfterRetry).toBe("string");
  });

  it("header card post failure logs approvalId/companyId/destinationChannelId AND fires the delivery-failure fallback comment (incident live suspect)", async () => {
    // Verifies the fix for the incident's flagged live suspect: a channel-level
    // post failure (bad/deleted destinationChannelId, missing permission
    // override, archived thread, etc.) while the bot IS a guild member used to
    // terminate with only a plugin-log entry and no operator-visible trace.
    const { handleApprovalCreated, POSTING_MARKER_PREFIX } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const event = makeApprovalCreatedEvent();

    (postEmbedToChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Unknown Channel"));
    await expect(handleApprovalCreated(harness.ctx, event, client, config)).rejects.toThrow("Unknown Channel");

    // Silent-failure fix: error log carries approvalId/companyId/destinationChannelId.
    const errorLog = harness.logs.find((l) => l.message === "approval-created: header card post failed");
    expect(errorLog?.meta).toMatchObject({
      approvalId: "appr-001",
      companyId: "c1",
      destinationChannelId: "o1",
    });

    // Fallback comment fires so the operator sees non-delivery in Paperclip
    // even without plugin-log access.
    const paperclipInstance = (PaperclipClient as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(paperclipInstance.addApprovalComment).toHaveBeenCalledWith(
      "appr-001",
      expect.stringContaining("could not deliver this approval to Discord"),
    );

    // The failed-send rollback (posting marker -> 0) still happens alongside the fallback.
    const postingAfterFailure = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: `${POSTING_MARKER_PREFIX}appr-001` });
    expect(postingAfterFailure).toBe(0);
  });
});

// ─── Rich renderer integration ───────────────────────────────────────────────

describe("handleApprovalCreated — rich renderer integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rich path: when renderer returns groups, posts header then one message per group", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");

    (renderIssueDocs as any).mockReturnValue([
      [{ title: "a" }, { title: "b" }],   // group 1
      [{ title: "c" }],                    // group 2
    ]);

    const harness = createTestHarness({ manifest });
    // Explicit legacy route (fleet issue #687): this fixture carries no
    // approvalKind/co-location thread, so without a route it would hit the
    // loud-unrouted-fallback warning and add an unrelated postToChannel call.
    const config = makeConfig();
    config.approvalsChannelsByType = { c1: [["^budget$", "o1"]] };
    await handleApprovalCreated(harness.ctx, makeApprovalCreatedEvent(), makeMockClient(), config);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);      // header
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(2);     // two body groups
    expect(postToChannel).not.toHaveBeenCalled();             // no content (proposedComment absent in this event)
  });

  it("CHANGE 1: when renderer returns [], chunk-posts proposedComment (always-post path)", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");

    (renderIssueDocs as any).mockReturnValue([]);

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({ proposedComment: "## section\nbody text here" });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), makeConfig());

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();
  });

  it("fetch failure: still posts header, falls back to proposedComment, marks posted", async () => {
    const { handleApprovalCreated, POSTED_MARKER_PREFIX } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");

    // Force the client to throw on getApprovalIssues (content is in proposedComment so getApprovalById not called)
    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockResolvedValue(null),
      getApprovalIssues: vi.fn().mockRejectedValue(new Error("boom")),
      listIssueDocuments: vi.fn(),
    }));
    (renderIssueDocs as any).mockReturnValue([]);  // matches empty-bundle behavior

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({ proposedComment: "fallback text" });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), makeConfig());

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    expect(postToChannel).toHaveBeenCalled();
    // posted marker must be an ISO string (header send succeeded)
    const posted = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: `${POSTED_MARKER_PREFIX}appr-001` });
    expect(typeof posted).toBe("string");
  });

  it("rich-post failure: when all rich groups fail, falls back to proposedComment", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");

    // Renderer returns groups (so rich path runs), but every postEmbedsToChannel call fails.
    (renderIssueDocs as any).mockReturnValue([
      [{ title: "a" }],
      [{ title: "b" }],
    ]);
    (postEmbedsToChannel as any).mockRejectedValue(new Error("discord 400: invalid image url"));

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({ proposedComment: "## section\nfallback body" });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), makeConfig());

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);          // header still posted
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(2);         // both groups attempted
    expect(postToChannel).toHaveBeenCalled();                     // proposedComment fallback fired
  });

  it("CHANGE 1: proposedComment is posted BEFORE rich groups, regardless of rich-group success/failure", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");

    (renderIssueDocs as any).mockReturnValue([
      [{ title: "a" }],
      [{ title: "b" }],
    ]);
    // First rich group succeeds, second fails — content must still be posted regardless.
    (postEmbedsToChannel as any)
      .mockResolvedValueOnce("msg-1")
      .mockRejectedValueOnce(new Error("discord 5xx transient"));

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({ proposedComment: "reviewable content" });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), makeConfig());

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);       // header
    expect(postToChannel).toHaveBeenCalled();                   // CHANGE 1: content always posted
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(2);      // both rich groups attempted
  });
});

// ─── Full-approval fetch fallback (codex P2) ─────────────────────────────────
//
// The approval.created activity-log payload only carries title + proposedComment
// (server/src/routes/approvals.ts:134-150). When approval content is in
// payload.details or payload.description the initial card is blank.
// Fix: when resolveApprovalContent over the event payload returns empty, fetch
// the full approval via GET /api/approvals/:id and retry.

describe("handleApprovalCreated — partial event payload is never trusted as complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("event has proposedComment BUT stored approval has summary+risks → card carries the stored payload", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");

    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockResolvedValue({
        id: "appr-001",
        type: "request_board_approval",
        status: "pending",
        createdAt: new Date().toISOString(),
        payload: {
          title: "Post week-27 batch",
          summary: "3 posts ready for IG",
          recommendedAction: "Approve",
          risks: ["one venue unverified"],
          proposedComment: "short note",
        },
      }),
      getApprovalIssues: vi.fn().mockResolvedValue([]),
      listIssueComments: vi.fn().mockResolvedValue([]),
      listIssueDocuments: vi.fn().mockResolvedValue([]),
    }));

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    await handleApprovalCreated(
      harness.ctx as any,
      makeApprovalCreatedEvent({ approvalId: "appr-001", title: "Post week-27 batch", proposedComment: "short note" }) as any,
      client as any,
      config as any,
    );

    const contentPosts = (postToChannel as any).mock.calls.map((c: any[]) => c[2]).join("\n");
    expect(contentPosts).toContain("3 posts ready for IG");
    expect(contentPosts).toContain("one venue unverified");
  });
});

describe("handleApprovalCreated — linked-issue digest fallback (agent-independent card)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("empty payload everywhere + linked issue with comments → digest posted from the issue record", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");

    // The 2026-07-04 incident shape: agent put content NOWHERE the renderer
    // reads (or nowhere at all) — but the issue's comment trail exists,
    // because the runtime forces it.
    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockResolvedValue({
        id: "appr-001",
        type: "request_board_approval",
        status: "pending",
        createdAt: new Date().toISOString(),
        payload: { title: "Relay" },
      }),
      getApprovalIssues: vi.fn().mockResolvedValue([
        { id: "iss-1", identifier: "PRO-9", title: "Relay", status: "in_review" },
      ]),
      // Real API shape: NEWEST-FIRST (routes/issues.ts:6032-6035). Four
      // comments — the digest must surface the newest 3 and drop the oldest.
      listIssueComments: vi.fn().mockResolvedValue([
        { id: "c4", body: "assembled note gated on board approval appr-001", createdAt: "2026-07-04T14:36:00Z" },
        { id: "c3", body: "scouts complete, barrier resolved", createdAt: "2026-07-04T14:33:00Z" },
        { id: "c2", body: "decomposition: created 3 sub-issues", createdAt: "2026-07-04T14:31:00Z" },
        { id: "c1", body: "OLDEST bootstrap comment — must NOT appear", createdAt: "2026-07-04T14:30:00Z" },
      ]),
      listIssueDocuments: vi.fn().mockResolvedValue([]),
    }));

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    await handleApprovalCreated(
      harness.ctx as any,
      makeApprovalCreatedEvent({ approvalId: "appr-001", title: "Relay" }) as any,
      client as any,
      config as any,
    );

    const contentPosts = (postToChannel as any).mock.calls.map((c: any[]) => c[2]).join("\n");
    expect(contentPosts).toContain("PRO-9");
    expect(contentPosts).toContain("assembled note gated on board approval");
    expect(contentPosts).toContain("/issues/PRO-9");
    expect(contentPosts).not.toContain("OLDEST bootstrap comment");
    // display order: oldest of the newest-3 first, newest last
    expect(contentPosts.indexOf("decomposition")).toBeLessThan(contentPosts.indexOf("assembled note"));
  });
});

describe("handleApprovalCreated — full-approval fetch fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("event-payload-without-content + fetched-payload-with-details → content chunks posted", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");

    // Simulate: event carries no content fields (as server emits), but full approval has details.
    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockResolvedValue({
        id: "appr-001",
        type: "request_board_approval",
        status: "pending",
        createdAt: new Date().toISOString(),
        payload: {
          title: "Tour content batch week 27",
          details: "## Section A\nContent from details field.\n\n## Section B\nMore content here.",
        },
      }),
      getApprovalIssues: vi.fn().mockResolvedValue([]),
      listIssueDocuments: vi.fn().mockResolvedValue([]),
    }));

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    // Event payload has no proposedComment / details / description (only title + type as server emits).
    const event = makeApprovalCreatedEvent({
      approvalId: "appr-001",
      title: "Tour content batch week 27",
      type: "request_board_approval",
      proposedComment: undefined,
    });
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);   // header posted
    // Content from fetched details field must be chunked and posted.
    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "o1",
      expect.stringContaining("Section A"),
    );
    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "o1",
      expect.stringContaining("Section B"),
    );
  });

  it("fetch failure → header still posts, no content chunks, approval marked posted", async () => {
    const { handleApprovalCreated, POSTED_MARKER_PREFIX } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");

    // getApprovalById throws; getApprovalIssues also throws to keep bundle empty.
    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockRejectedValue(new Error("network timeout")),
      getApprovalIssues: vi.fn().mockRejectedValue(new Error("network timeout")),
      listIssueDocuments: vi.fn(),
    }));

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    // Explicit legacy route (fleet issue #687): without it this fixture is
    // unrouted and the loud-fallback warning adds an unrelated postToChannel
    // call that this test's "no content posted" assertion doesn't expect.
    config.approvalsChannelsByType = { c1: [["^budget$", "o1"]] };
    const client = makeMockClient();

    // Event has no content → triggers fallback fetch which then fails.
    const event = makeApprovalCreatedEvent({
      approvalId: "appr-nofetch",
      title: "Approval with fetch error",
      proposedComment: undefined,
    });
    await handleApprovalCreated(harness.ctx, event, client, config);

    // Header must still be posted despite fetch failure.
    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    // No content posted — fetch failed, no fallback available.
    expect(postToChannel).not.toHaveBeenCalled();
    // Approval is marked posted (header confirmed) so reminders don't re-post the header.
    const posted = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: `${POSTED_MARKER_PREFIX}appr-nofetch`,
    });
    expect(typeof posted).toBe("string");
  });
});

// ─── postsBatch structured render contract (GH #501) ─────────────────────────
//
// Mirrors carouselBatch's philosophy on request_confirmation interactions:
// a structured payload.postsBatch (version 1, items[]) renders as one embed
// per post via postEmbedsToChannel INSTEAD of the plaintext chunkBySection
// path. Absent/malformed postsBatch degrades to the existing plaintext path
// unchanged — legacy cards (and any card whose editor hasn't shipped
// postsBatch yet) render exactly as before this change.

function validPostsBatch() {
  return {
    version: 1,
    weekOf: "2026-07-13",
    items: [
      {
        slug: "tokyo-trifecta",
        day: "Mon",
        postTime: "Mon 2026-07-13 12:00 Taipei",
        imageUrl: "https://hinomaru.one/images/tours/trifecta-card.avif",
        hook: "Three neighborhoods, three completely different Tokyos.",
        platforms: { threads: "Three neighborhoods...", x: "Three neighborhoods (short)..." },
      },
    ],
  };
}

// This block's fixtures are about postsBatch CONTENT rendering, not routing —
// they carry no approvalKind/co-location thread, so without an explicit
// legacy route they'd all hit the new loud-unrouted-fallback warning post
// (fleet issue #687) and its extra postToChannel call would pollute every
// call-count assertion below. routedConfig() gives them a deterministic
// legacy-ladder match (payload.approvalType: "budget", the default fixture
// value) to the SAME "o1" channel makeConfig() already falls back to —
// same destination, zero routing ambiguity, tests stay focused on content.
function routedConfig(): DiscordFleetConfig {
  const config = makeConfig();
  config.approvalsChannelsByType = { c1: [["^budget$", "o1"]] };
  return config;
}

describe("handleApprovalCreated — postsBatch structured render (GH #501)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but NOT a mockImplementation/queued
    // mockResolvedValueOnce chain set by an earlier test — restore every mock
    // this describe block depends on to its module-level default (see the
    // top-of-file vi.mock calls) so one test's override (e.g. "total delivery
    // failure" setting postEmbedsToChannel to always reject) can't leak into
    // a LATER test in this same describe block/file.
    const { PaperclipClient } = await import("../src/api/paperclip.js");
    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockResolvedValue(null),
      getApprovalIssues: vi.fn().mockResolvedValue([]),
      listIssueDocuments: vi.fn().mockResolvedValue([]),
      addApprovalComment: vi.fn().mockResolvedValue(undefined),
    }));
    const { postToThread, postToChannel, postEmbedToThread, postEmbedToChannel, postEmbedsToChannel } = await import("../src/discord/rest.js");
    (postToThread as any).mockResolvedValue("msg-id-1");
    (postToChannel as any).mockResolvedValue("msg-id-2");
    (postEmbedToThread as any).mockResolvedValue("msg-id-3");
    (postEmbedToChannel as any).mockResolvedValue("msg-id-4");
    (postEmbedsToChannel as any).mockResolvedValue("msg-id-5");
  });

  it("structured postsBatch on the event payload → posts embeds via postEmbedsToChannel, not plaintext", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      proposedComment: "## raw markdown fallback text, should NOT be posted when postsBatch parses",
      postsBatch: validPostsBatch(),
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1); // header
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1); // one group of postsBatch embeds
    expect(postToChannel).not.toHaveBeenCalled(); // plaintext path skipped entirely
  });

  it("structured postsBatch found only on the FULL fetched approval (event payload is partial) → still renders as embeds", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);

    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockResolvedValue({
        id: "appr-001",
        payload: { proposedComment: "prose fallback", postsBatch: validPostsBatch() },
      }),
      getApprovalIssues: vi.fn().mockResolvedValue([]),
      listIssueDocuments: vi.fn().mockResolvedValue([]),
    }));

    const harness = createTestHarness({ manifest });
    // Event payload has NO postsBatch (matches the real server: approval.created
    // activity only carries title + proposedComment) — only the fetched approval has it.
    const event = makeApprovalCreatedEvent({ proposedComment: "event-payload prose" });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1);
    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("malformed postsBatch (wrong version) degrades to the plaintext path — proposedComment still posts", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      proposedComment: "## plaintext fallback body",
      postsBatch: { version: 2, items: [] },
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();
  });

  it("absent postsBatch (legacy card) degrades to the plaintext path unchanged", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({ proposedComment: "legacy prose artifact, 28887 chars in production" });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();
  });

  it("postsBatch embed group post failure is logged and does not throw (best-effort, matches rich-doc path semantics)", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);
    (postEmbedsToChannel as any).mockRejectedValue(new Error("discord 400: invalid image url"));

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({ postsBatch: validPostsBatch() });
    await expect(handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig())).resolves.not.toThrow();
  });

  // codex P2: when postsBatch parses but EVERY postEmbedsToChannel call fails,
  // the operator must not be left with a header-only card — the plaintext
  // path (effectiveContent) is the floor that was always posted before this
  // change (see "CHANGE 1" in the rich-renderer-integration describe block).
  it("total postsBatch delivery failure (every embed group post fails) falls back to the plaintext path", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);
    (postEmbedsToChannel as any).mockRejectedValue(new Error("discord 400: invalid image url"));

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      proposedComment: "plaintext fallback content, should post since postsBatch totally failed to deliver",
      postsBatch: validPostsBatch(),
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postEmbedsToChannel).toHaveBeenCalled(); // structured attempt was made
    expect(postToChannel).toHaveBeenCalled(); // fell back to plaintext since nothing delivered
  });

  // DELIVERY-COMPLETENESS (codex P2, round 6): a bare "at least one group
  // delivered" boolean used to gate the plaintext fallback ONLY — it never
  // surfaced a later group's failure to the operator at all. The three tests
  // below pin the per-unit (deliveredSlugs/missingSlugs) replacement across
  // its three distinguishable outcomes: transient failure that self-heals via
  // the retry, residual failure after the retry (must warn), and the
  // no-groups-exist edge (must NOT be treated as a partial failure).
  const threeItemBatch = {
    version: 1 as const,
    items: [
      { slug: "a", day: "Mon", postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h".repeat(2000), platforms: {} },
      { slug: "b", day: "Tue", postTime: null, imageUrl: "https://x.example.com/b.jpg", hook: "h".repeat(2000), platforms: {} },
      { slug: "c", day: "Wed", postTime: null, imageUrl: "https://x.example.com/c.jpg", hook: "h".repeat(2000), platforms: {} },
    ],
  };

  it("PARTIAL postsBatch delivery where the failed group's RETRY succeeds — self-heals, no warning, no plaintext fallback", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);
    // 3 large-hook items pack into 2 groups (~2040 chars/embed vs
    // EMBED_TOTAL_MAX=6000 caps 2 per group). Group 1 succeeds; group 2 fails
    // once then succeeds on the built-in retry (3rd call falls through to the
    // module's default mockResolvedValue).
    (postEmbedsToChannel as any)
      .mockResolvedValueOnce("msg-1")
      .mockRejectedValueOnce(new Error("discord 5xx transient"));

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      proposedComment: "plaintext fallback content, should NOT post — everything delivered after retry",
      postsBatch: threeItemBatch,
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    // 2 groups + 1 retry of the failed group = 3 calls.
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(3);
    // Everything delivered (after retry) → no partial-delivery warning, no plaintext fallback.
    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("PARTIAL postsBatch delivery where a group's retry ALSO fails — posts the unsuppressable warning naming the missing slugs, does NOT fall back to full plaintext", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);
    // Group 1 succeeds; group 2 fails on both the initial attempt and the retry.
    (postEmbedsToChannel as any)
      .mockResolvedValueOnce("msg-1")
      .mockRejectedValueOnce(new Error("discord 5xx transient"))
      .mockRejectedValueOnce(new Error("discord 5xx transient (retry)"));

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      proposedComment: "plaintext fallback content, should NOT post — this is a PARTIAL failure, not total",
      postsBatch: threeItemBatch,
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postEmbedsToChannel).toHaveBeenCalledTimes(3);
    // Residual failure after retry → the loud, unsuppressable warning fires...
    expect(postToChannel).toHaveBeenCalledTimes(1);
    const warningCall = (postToChannel as any).mock.calls[0];
    expect(warningCall[2]).toContain("failed to deliver");
    // ...naming the slug(s) that make up the failed group (group 2 = "c" per
    // the packing above: group 1 = [a, b], group 2 = [c]).
    expect(warningCall[2]).toContain("c");
    // ...but this is a PARTIAL failure (some content delivered), so the full
    // proposedComment plaintext fallback must NOT also fire — that would
    // duplicate posts a/b that already delivered successfully.
    expect(warningCall[2]).not.toContain("plaintext fallback content");
  });

  it("postsBatch with an EMPTY items array is not a partial-failure case — falls through to plaintext unchanged", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({
      proposedComment: "plaintext fallback content — SHOULD post since postsBatch.items is empty",
      postsBatch: { version: 1 as const, items: [] },
    });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    // No groups, no overflow → no embed calls, no warning, straight to plaintext.
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    const calls = (postToChannel as any).mock.calls.map((c: any[]) => c[2]);
    expect(calls.some((body: string) => body.includes("plaintext fallback content"))).toBe(true);
    expect(calls.some((body: string) => body.includes("failed to deliver"))).toBe(false);
  });

  // codex P2: summary/recommendedAction/risks must reach Discord alongside
  // postsBatch embeds — renderPostsBatchEmbeds only carries per-post fields.
  it("summary/recommendedAction/risks post via postToChannel ALONGSIDE the postsBatch embeds (not swallowed)", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);

    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockResolvedValue({
        id: "appr-001",
        payload: {
          summary: "Weekly posts batch for 2026-07-13",
          recommendedAction: "Approve all 13 posts",
          risks: ["One image URL is a placeholder"],
          postsBatch: validPostsBatch(),
        },
      }),
      getApprovalIssues: vi.fn().mockResolvedValue([]),
      listIssueDocuments: vi.fn().mockResolvedValue([]),
    }));

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({});
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postToChannel).toHaveBeenCalledTimes(1);
    const guidanceCall = (postToChannel as any).mock.calls[0][2] as string;
    expect(guidanceCall).toContain("Weekly posts batch for 2026-07-13");
    expect(guidanceCall).toContain("Approve all 13 posts");
    expect(guidanceCall).toContain("One image URL is a placeholder");
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1); // postsBatch embeds still post
  });

  // DELIVERY-COMPLETENESS (codex P2, round 6): guidance is part of the card's
  // visible content too — a residual guidance-post failure (both the initial
  // attempt and its retry fail) must surface via the unsuppressable warning,
  // not vanish into a log line while the embeds post successfully underneath it.
  it("guidance post failure (both attempts) is tracked and surfaces via the partial-delivery warning, even though the embeds succeed", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);
    (postToChannel as any)
      .mockRejectedValueOnce(new Error("discord 5xx transient"))
      .mockRejectedValueOnce(new Error("discord 5xx transient (retry)"));

    (PaperclipClient as any).mockImplementation(() => ({
      getApprovalById: vi.fn().mockResolvedValue({
        id: "appr-001",
        payload: {
          summary: "Weekly posts batch for 2026-07-13",
          postsBatch: validPostsBatch(),
        },
      }),
      getApprovalIssues: vi.fn().mockResolvedValue([]),
      listIssueDocuments: vi.fn().mockResolvedValue([]),
    }));

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({});
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    // Embeds still post successfully (independent of the guidance failure).
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1);
    // postToChannel: 1st call = guidance attempt (fails), 2nd = guidance retry
    // (fails), 3rd = the partial-delivery warning.
    expect(postToChannel).toHaveBeenCalledTimes(3);
    const warningCall = (postToChannel as any).mock.calls[2][2] as string;
    expect(warningCall).toContain("failed to deliver");
    expect(warningCall).toContain("guidance");
  });

  it("no guidance fields set → postToChannel is not called for postsBatch (unchanged from before)", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);

    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({ postsBatch: validPostsBatch() });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postToChannel).not.toHaveBeenCalled();
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1);
  });

  // codex P2: a platform copy longer than Discord's 1024-char embed field
  // limit must post as a plaintext follow-up (the FULL text), not just a
  // truncated field value.
  it("platform copy >1024 chars posts a plaintext follow-up with the FULL text", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    (renderIssueDocs as any).mockReturnValue([]);

    const longCopy = "Long-form Facebook copy. ".repeat(60); // well over 1024 chars
    const batchWithLongCopy = {
      version: 1,
      items: [{
        slug: "tokyo-trifecta", day: "Mon", postTime: null,
        imageUrl: "https://hinomaru.one/images/tours/trifecta-card.avif",
        hook: "Three neighborhoods.",
        platforms: { facebook: longCopy },
      }],
    };
    const harness = createTestHarness({ manifest });
    const event = makeApprovalCreatedEvent({ postsBatch: batchWithLongCopy });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), routedConfig());

    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1);
    expect(postToChannel).toHaveBeenCalledTimes(1);
    const overflowCall = (postToChannel as any).mock.calls[0][2] as string;
    expect(overflowCall).toContain("tokyo-trifecta");
    expect(overflowCall).toContain("Facebook");
    expect(overflowCall).toContain(longCopy);
  });
});

// ─── approvalKind routing (fleet issue #687) ─────────────────────────────────
//
// New rung-1 exact map (config.approvalKindChannels), the deprecated legacy
// ladder kept as rung 2, work-thread co-location kept as rung 3, and a loud
// (never-silent) warning whenever delivery lands on rung 4 (fallback).

describe("handleApprovalCreated — approvalKind routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approvalKindChannels exact match wins over the legacy approvalsChannelsByType ladder", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    config.approvalKindChannels = { c1: { content_batch_approval: "kind-channel" } };
    // Legacy ladder ALSO matches this event (approvalType: "budget" from the
    // default fixture) — kind must win regardless of legacy-table content.
    config.approvalsChannelsByType = { c1: [["^budget$", "legacy-channel"]] };

    const event = makeApprovalCreatedEvent({ approvalKind: "content_batch_approval" });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(makeMockClient(), "kind-channel", expect.anything(), expect.anything());
  });

  it("a kind absent from approvalKindChannels falls through to the legacy ladder (not treated as unrouted)", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    // Map has entries, just not for THIS event's kind.
    config.approvalKindChannels = { c1: { some_other_kind: "kind-channel" } };
    config.approvalsChannelsByType = { c1: [["^budget$", "legacy-channel"]] };

    const event = makeApprovalCreatedEvent({ approvalKind: "content_batch_approval" });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(makeMockClient(), "legacy-channel", expect.anything(), expect.anything());
    // Routed via the legacy ladder, not the fallback — no unrouted warning.
    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("a company with ONLY the legacy approvalsChannelsByType configured (today's real fleet state) routes exactly as before — zero behavior change", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    // approvalKindChannels entirely absent from config — pre-migration state.
    config.approvalsChannelsByType = { c1: [["^budget$", "legacy-channel"]] };

    const event = makeApprovalCreatedEvent(); // no approvalKind field at all
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(makeMockClient(), "legacy-channel", expect.anything(), expect.anything());
    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("unrouted (no kind/legacy match, no co-location) posts a visible warning naming the kind", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    config.companies[0].approvalFallbackChannelId = "fallback-channel";

    const event = makeApprovalCreatedEvent({ approvalKind: "totally_unmapped_kind", approvalType: undefined });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), config);

    expect(postToChannel).toHaveBeenCalledWith(
      makeMockClient(),
      "fallback-channel",
      expect.stringContaining("unrouted approvalKind: totally_unmapped_kind"),
    );
  });

  it("unrouted with a wholly absent approvalKind renders 'absent', not an empty string", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    config.companies[0].approvalFallbackChannelId = "fallback-channel";

    const event = makeApprovalCreatedEvent({ approvalType: undefined });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), config);

    expect(postToChannel).toHaveBeenCalledWith(
      makeMockClient(),
      "fallback-channel",
      expect.stringContaining("unrouted approvalKind: absent"),
    );
  });

  it("co-location (existing work thread) is a successful route, NOT unrouted — no warning posted", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { setThreadForIssue } = await import("../src/routing/thread-state.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    await setThreadForIssue(harness.ctx, "c1", "iss-1", {
      threadId: "thread-1",
      channelId: "thread-1",
      createdAt: new Date().toISOString(),
    });
    const config = makeConfig();

    const event = makeApprovalCreatedEvent({ approvalKind: "totally_unmapped_kind", approvalType: undefined });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(makeMockClient(), "thread-1", expect.anything(), expect.anything());
    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("a failed warning-post does not un-post the header or leave the approval retryable", async () => {
    const { handleApprovalCreated, POSTED_MARKER_PREFIX } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");
    (postToChannel as any).mockRejectedValueOnce(new Error("discord 500"));

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    config.companies[0].approvalFallbackChannelId = "fallback-channel";

    const event = makeApprovalCreatedEvent({ approvalKind: "totally_unmapped_kind", approvalType: undefined });
    await handleApprovalCreated(harness.ctx, event, makeMockClient(), config);

    // Header posted exactly once — the warning-post failure is best-effort
    // and must not trigger a retry/duplicate of the header.
    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    const posted = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: `${POSTED_MARKER_PREFIX}appr-001`,
    });
    expect(posted).toBeTruthy();
  });

  it("multi-company: identical kind string routes each company to ITS OWN mapped channel — no cross-company leak", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config: DiscordFleetConfig = {
      botTokenSecretRef: "bot-ref",
      companies: [
        {
          companyId: "c1",
          guildId: "g1",
          channels: { digest: "d1", errors: "e1", orphan: "orphan-c1" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref1",
          paperclipApiUrl: "http://localhost:3000",
          companyPrefix: "tc1",
        },
        {
          companyId: "c2",
          guildId: "g2",
          channels: { digest: "d2", errors: "e2", orphan: "orphan-c2" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref2",
          paperclipApiUrl: "http://localhost:3000",
          companyPrefix: "tc2",
        },
      ],
      approvalKindChannels: {
        c1: { content_batch_approval: "c1-kind-channel" },
        c2: { content_batch_approval: "c2-kind-channel" },
      },
    };

    await handleApprovalCreated(
      harness.ctx,
      makeApprovalCreatedEvent({ approvalId: "appr-c1", approvalKind: "content_batch_approval" }, { companyId: "c1" }),
      makeMockClient(),
      config,
    );
    await handleApprovalCreated(
      harness.ctx,
      makeApprovalCreatedEvent({ approvalId: "appr-c2", approvalKind: "content_batch_approval" }, { companyId: "c2" }),
      makeMockClient(),
      config,
    );

    expect(postEmbedToChannel).toHaveBeenCalledWith(makeMockClient(), "c1-kind-channel", expect.anything(), expect.anything());
    expect(postEmbedToChannel).toHaveBeenCalledWith(makeMockClient(), "c2-kind-channel", expect.anything(), expect.anything());
  });
});
