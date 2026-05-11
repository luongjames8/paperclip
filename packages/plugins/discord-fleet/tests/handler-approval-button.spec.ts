/**
 * Layer: unit + integration
 * Coverage: parseApprovalCustomId (pure) + handleApprovalButton (happy path)
 * Adversarial paths (malformed inputs, error branches) are handled by the parallel
 * adversarial-validator subagent — this file covers happy-path baseline only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseApprovalCustomId } from "../src/handlers/approval-button.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";

// ─── PaperclipClient mock ────────────────────────────────────────────────────

const mockApproveApproval = vi.fn().mockResolvedValue(undefined);
const mockRejectApproval = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/api/paperclip.js", () => ({
  PaperclipClient: vi.fn().mockImplementation(() => ({
    approveApproval: mockApproveApproval,
    rejectApproval: mockRejectApproval,
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALICE_DISCORD_ID = "discord-user-alice";

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
        paperclipApiKeySecretRef: "my-api-key-ref",
        paperclipApiUrl: "http://paperclip:3100",
        companyPrefix: "tc1",
        userMappings: [
          {
            discordUserId: ALICE_DISCORD_ID,
            paperclipUserId: "pc-user-alice",
            role: "operator",
          },
        ],
      },
    ],
  };
}

function makeButtonInteraction(customId: string, username = "alice"): any {
  const embed = {
    title: "🟡 ISS-1 — needs approval",
    toJSON: () => ({
      title: "🟡 ISS-1 — needs approval",
      color: 0xfee75c,
      description: "some description",
    }),
  };
  return {
    customId,
    guildId: "g1",
    user: { id: ALICE_DISCORD_ID, username },
    message: { embeds: [embed] },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── parseApprovalCustomId — pure function tests ──────────────────────────────

describe("parseApprovalCustomId", () => {
  it("approval-approve:appr-001 → { action: 'approve', approvalId: 'appr-001' }", () => {
    const result = parseApprovalCustomId("approval-approve:appr-001");
    expect(result).toEqual({ action: "approve", approvalId: "appr-001" });
  });

  it("approval-reject:appr-002 → { action: 'reject', approvalId: 'appr-002' }", () => {
    const result = parseApprovalCustomId("approval-reject:appr-002");
    expect(result).toEqual({ action: "reject", approvalId: "appr-002" });
  });

  it("unrecognized prefix → null", () => {
    const result = parseApprovalCustomId("something-else:appr-003");
    expect(result).toBeNull();
  });
});

// ─── handleApprovalButton — happy path ───────────────────────────────────────

describe("handleApprovalButton — approve happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves secret via paperclipApiKeySecretRef", async () => {
    const { handleApprovalButton } = await import("../src/handlers/approval-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeButtonInteraction("approval-approve:appr-foo");
    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(resolveSecret).toHaveBeenCalledWith("my-api-key-ref");
  });

  it("calls approveApproval with approvalId and discord:<username> note", async () => {
    const { handleApprovalButton } = await import("../src/handlers/approval-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeButtonInteraction("approval-approve:appr-foo", "alice");
    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(mockApproveApproval).toHaveBeenCalledWith("appr-foo", "discord:alice");
    expect(mockRejectApproval).not.toHaveBeenCalled();
  });

  it("calls deferUpdate exactly once before calling approveApproval", async () => {
    const { handleApprovalButton } = await import("../src/handlers/approval-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeButtonInteraction("approval-approve:appr-foo");
    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
  });

  it("editReply called with green color 0x57f287 and '✅ Approved' prefix in title", async () => {
    const { handleApprovalButton } = await import("../src/handlers/approval-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeButtonInteraction("approval-approve:appr-foo", "alice");
    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds[0].color).toBe(0x57f287);
    expect(call.embeds[0].title).toMatch(/^✅ Approved/);
    expect(call.embeds[0].footer.text).toMatch(/alice/);
    expect(call.embeds[0].footer.text).toMatch(/✅ Approved/);
    expect(call.components).toEqual([]);
  });
});

describe("handleApprovalButton — reject happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls rejectApproval with approvalId and discord:<username> note", async () => {
    const { handleApprovalButton } = await import("../src/handlers/approval-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-xyz");

    const interaction = makeButtonInteraction("approval-reject:appr-bar", "bob");
    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(mockRejectApproval).toHaveBeenCalledWith("appr-bar", "discord:bob");
    expect(mockApproveApproval).not.toHaveBeenCalled();
  });

  it("editReply called with red color 0xed4245 and '❌ Rejected' prefix in title", async () => {
    const { handleApprovalButton } = await import("../src/handlers/approval-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-xyz");

    const interaction = makeButtonInteraction("approval-reject:appr-bar", "bob");
    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds[0].color).toBe(0xed4245);
    expect(call.embeds[0].title).toMatch(/^❌ Rejected/);
    expect(call.embeds[0].footer.text).toMatch(/bob/);
    expect(call.embeds[0].footer.text).toMatch(/❌ Rejected/);
    expect(call.components).toEqual([]);
  });
});
