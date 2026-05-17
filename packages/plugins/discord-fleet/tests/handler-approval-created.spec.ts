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

// ─── SEEN_APPROVALS_KEY dedup guard ──────────────────────────────────────────

describe("handleApprovalCreated — SEEN_APPROVALS_KEY dedup guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedup: second call with same approvalId is a no-op (no posts)", async () => {
    const { handleApprovalCreated, SEEN_APPROVALS_KEY } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const event = makeApprovalCreatedEvent();

    await handleApprovalCreated(harness.ctx, event, client, config);
    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);  // first call posted; second was no-op

    const seen = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: SEEN_APPROVALS_KEY });
    expect(seen).toEqual(["appr-001"]);
  });

  it("dedup survives PENDING_APPROVALS_KEY wipe (digest semantics)", async () => {
    const { handleApprovalCreated, SEEN_APPROVALS_KEY, PENDING_APPROVALS_KEY } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const event = makeApprovalCreatedEvent();

    await handleApprovalCreated(harness.ctx, event, client, config);

    // Simulate digest wiping PENDING (jobs/digest.ts:100):
    await harness.ctx.state.set({ scopeKind: "company", scopeId: "c1", stateKey: PENDING_APPROVALS_KEY }, []);

    await handleApprovalCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);  // still deduped via SEEN
  });

  it("PENDING_APPROVALS_KEY is also populated (digest job still sees the approval)", async () => {
    const { handleApprovalCreated, PENDING_APPROVALS_KEY } = await import("../src/handlers/approval-created.js");

    const harness = createTestHarness({ manifest });
    await handleApprovalCreated(harness.ctx, makeApprovalCreatedEvent(), makeMockClient(), makeConfig());

    const pending = await harness.ctx.state.get({ scopeKind: "company", scopeId: "c1", stateKey: PENDING_APPROVALS_KEY });
    expect(pending).toEqual(["appr-001"]);
  });
});
