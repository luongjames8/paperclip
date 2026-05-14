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
