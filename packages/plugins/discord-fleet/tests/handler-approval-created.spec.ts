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

vi.mock("../src/render/issue-docs.js", () => ({
  renderIssueDocs: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/api/paperclip.js", () => ({
  PaperclipClient: vi.fn().mockImplementation(() => ({
    getApprovalById: vi.fn().mockResolvedValue(null),
    getApprovalIssues: vi.fn().mockResolvedValue([]),
    listIssueDocuments: vi.fn().mockResolvedValue([]),
    addApprovalComment: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../src/render/embeds.js", () => ({
  buildApprovalEmbed: vi.fn().mockReturnValue({ title: "approval embed" }),
  buildSeedIssueEmbed: vi.fn().mockReturnValue({ title: "seed embed" }),
  buildBlockedEmbed: vi.fn().mockReturnValue({ title: "blocked embed" }),
  buildApprovalActionRow: vi.fn().mockReturnValue({ type: 1, components: [] }),
  APPROVAL_BUTTON_PREFIX: { approve: "approval-approve:", reject: "approval-reject:" },
}));

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
    await handleApprovalCreated(harness.ctx, makeApprovalCreatedEvent(), makeMockClient(), makeConfig());

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
