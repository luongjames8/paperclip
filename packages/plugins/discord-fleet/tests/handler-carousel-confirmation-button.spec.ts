/**
 * Coverage: parseCarouselConfirmCustomId / parseCarouselConfirmRejectModalCustomId
 * (pure) + handleCarouselConfirmationButton / handleCarouselConfirmationRejectModal
 * happy + error paths, plus the customId length assertion in embeds.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import {
  parseCarouselConfirmCustomId,
  parseCarouselConfirmRejectModalCustomId,
} from "../src/handlers/carousel-confirmation-button.js";
import { buildCarouselConfirmationActionRow, CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX } from "../src/render/embeds.js";
import { PaperclipApiError } from "../src/api/paperclip.js";

const mockAcceptInteraction = vi.fn().mockResolvedValue(undefined);
const mockRejectInteraction = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/api/paperclip.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api/paperclip.js")>("../src/api/paperclip.js");
  return {
    ...actual,
    PaperclipClient: vi.fn().mockImplementation(() => ({
      acceptInteraction: mockAcceptInteraction,
      rejectInteraction: mockRejectInteraction,
    })),
  };
});

const ISSUE_ID = "11111111-1111-1111-1111-111111111111";
const INTERACTION_ID = "22222222-2222-2222-2222-222222222222";
const ALICE_DISCORD_ID = "discord-user-alice";
const MALLORY_DISCORD_ID = "discord-user-mallory";

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

function makeInteraction(
  customId: string,
  opts?: { username?: string; reason?: string; discordUserId?: string },
): any {
  const embed = {
    toJSON: () => ({ title: "Decision needed", color: 0x5865f2, description: "some description" }),
  };
  const interaction: any = {
    customId,
    guildId: "g1",
    user: { id: opts?.discordUserId ?? ALICE_DISCORD_ID, username: opts?.username ?? "alice" },
    message: { embeds: [embed] },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
  if (opts?.reason !== undefined) {
    interaction.fields = { getTextInputValue: vi.fn().mockReturnValue(opts.reason) };
  }
  return interaction;
}

describe("parseCarouselConfirmCustomId", () => {
  it(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID} → accept action`, () => {
    const result = parseCarouselConfirmCustomId(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`);
    expect(result).toEqual({ action: "accept", issueId: ISSUE_ID, interactionId: INTERACTION_ID });
  });

  it(`carousel-confirm-reject:${ISSUE_ID}:${INTERACTION_ID} → reject action`, () => {
    const result = parseCarouselConfirmCustomId(`carousel-confirm-reject:${ISSUE_ID}:${INTERACTION_ID}`);
    expect(result).toEqual({ action: "reject", issueId: ISSUE_ID, interactionId: INTERACTION_ID });
  });

  it("unrecognized prefix (e.g. an approval-* customId) → null — never cross-routed", () => {
    expect(parseCarouselConfirmCustomId("approval-approve:appr-1")).toBeNull();
  });

  it("missing interactionId segment → null", () => {
    expect(parseCarouselConfirmCustomId(`carousel-confirm-accept:${ISSUE_ID}`)).toBeNull();
  });
});

describe("CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX — customId length assertion", () => {
  it("full modal customId (prefix + issueId + ':' + interactionId) stays within Discord's 100-char limit", () => {
    const fullId = `${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID}`;
    expect(fullId.length).toBeLessThanOrEqual(100);
  });
});

describe("parseCarouselConfirmRejectModalCustomId", () => {
  it(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID} parses both ids`, () => {
    const result = parseCarouselConfirmRejectModalCustomId(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID}`);
    expect(result).toEqual({ issueId: ISSUE_ID, interactionId: INTERACTION_ID });
  });

  it("unrelated prefix → null", () => {
    expect(parseCarouselConfirmRejectModalCustomId("approval-revision-modal:appr-1")).toBeNull();
  });
});

describe("buildCarouselConfirmationActionRow — customId length assertion", () => {
  it("customIds stay within Discord's 100-char limit for UUID-length ids", () => {
    const row = buildCarouselConfirmationActionRow(ISSUE_ID, INTERACTION_ID);
    for (const c of row.components as any[]) {
      expect(c.custom_id.length).toBeLessThanOrEqual(100);
    }
    // Reject prefix is the longest: 24 + 36 + 1 + 36 = 97.
    const rejectButton = (row.components as any[]).find((c) => c.custom_id.startsWith("carousel-confirm-reject:"));
    expect(rejectButton.custom_id.length).toBe(97);
  });

  it("throws if a hypothetically longer id would exceed 100 chars", () => {
    const overlong = "x".repeat(80);
    expect(() => buildCarouselConfirmationActionRow(overlong, overlong)).toThrow(/exceeds Discord/);
  });
});

describe("handleCarouselConfirmationButton — accept happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls acceptInteraction with issueId + interactionId, then edits the trailer + strips components", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`, { username: "alice" });
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(mockAcceptInteraction).toHaveBeenCalledWith(ISSUE_ID, INTERACTION_ID);
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.components).toEqual([]);
    expect(call.embeds[0].footer.text).toMatch(/Accepted by alice/);
  });

  it("409 (already resolved) surfaces as an ephemeral followUp error, not a crash", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    mockAcceptInteraction.mockRejectedValueOnce(new PaperclipApiError("conflict", 409, "http://x"));

    const interaction = makeInteraction(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`);
    await expect(handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    const followUpCall = interaction.followUp.mock.calls[0][0];
    expect(followUpCall.ephemeral).toBe(true);
    expect(followUpCall.content).toMatch(/Already resolved elsewhere/);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it("422 (server rejects the request) surfaces as an ephemeral followUp error", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    mockAcceptInteraction.mockRejectedValueOnce(new PaperclipApiError("unprocessable", 422, "http://x"));

    const interaction = makeInteraction(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp.mock.calls[0][0].ephemeral).toBe(true);
    expect(interaction.followUp.mock.calls[0][0].content).toMatch(/Rejected by server/);
  });
});

describe("handleCarouselConfirmationButton — reject opens a modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a modal instead of deferring/calling the API directly", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });

    const interaction = makeInteraction(`carousel-confirm-reject:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
    const modal = interaction.showModal.mock.calls[0][0];
    expect(modal.data.custom_id).toBe(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID}`);
  });
});

// ─── Authorization gate: company.userMappings (codex P1, PR #27) ─────────────
//
// Any guild member who can see the channel could otherwise click accept/reject
// and act as the shared board actor. Mirrors approval-button's gate exactly:
// unmapped Discord user id → ephemeral refusal, zero paperclip API calls.

describe("handleCarouselConfirmationButton — authorization gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accept: unmapped user gets an ephemeral refusal and NO paperclip API call", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: MALLORY_DISCORD_ID,
      username: "mallory",
    });
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/not authorized/) }),
    );
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(mockAcceptInteraction).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("reject: unmapped user gets an ephemeral refusal before the modal is ever shown", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`carousel-confirm-reject:${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: MALLORY_DISCORD_ID,
      username: "mallory",
    });
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/not authorized/) }),
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("accept: mapped user proceeds normally (resolves company key when no per-user key set)", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: ALICE_DISCORD_ID,
      username: "alice",
    });
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(resolveSecret).toHaveBeenCalledWith("my-api-key-ref");
    expect(mockAcceptInteraction).toHaveBeenCalledWith(ISSUE_ID, INTERACTION_ID);
  });

  it("accept: per-user boardApiKeySecretRef is preferred over the company-wide key", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-per-user");

    const config = makeConfig();
    config.companies[0].userMappings![0].boardApiKeySecretRef = "alice-personal-key-ref";

    const interaction = makeInteraction(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: ALICE_DISCORD_ID,
      username: "alice",
    });
    await handleCarouselConfirmationButton(harness.ctx, interaction, config);

    expect(resolveSecret).toHaveBeenCalledWith("alice-personal-key-ref");
    expect(mockAcceptInteraction).toHaveBeenCalledWith(ISSUE_ID, INTERACTION_ID);
  });
});

describe("handleCarouselConfirmationRejectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unmapped user gets an ephemeral refusal and NO paperclip API call (re-checked on modal submit)", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: MALLORY_DISCORD_ID,
      username: "mallory",
      reason: "some reason",
    });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/not authorized/) }),
    );
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("mapped user proceeds normally, per-user boardApiKeySecretRef preferred over company key", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-per-user");

    const config = makeConfig();
    config.companies[0].userMappings![0].boardApiKeySecretRef = "alice-personal-key-ref";

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: ALICE_DISCORD_ID,
      username: "alice",
      reason: "Wrong week's slides",
    });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, config);

    expect(resolveSecret).toHaveBeenCalledWith("alice-personal-key-ref");
    expect(mockRejectInteraction).toHaveBeenCalledWith(ISSUE_ID, INTERACTION_ID, "Wrong week's slides");
  });

  it("requires a non-empty reason — empty input is rejected before calling the API", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID}`, { reason: "   " });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(mockRejectInteraction).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/reason is required/) }));
  });

  it("calls rejectInteraction with the typed reason, then edits the trailer + strips components", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID}`, { reason: "Wrong week's slides", username: "bob" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(mockRejectInteraction).toHaveBeenCalledWith(ISSUE_ID, INTERACTION_ID, "Wrong week's slides");
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.components).toEqual([]);
    expect(call.embeds[0].footer.text).toMatch(/Rejected by bob/);
  });

  it("409/422 from rejectInteraction surfaces as an ephemeral followUp error, not swallowed", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    mockRejectInteraction.mockRejectedValueOnce(new PaperclipApiError("unprocessable — reason required", 422, "http://x"));

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp.mock.calls[0][0].ephemeral).toBe(true);
    expect(interaction.followUp.mock.calls[0][0].content).toMatch(/Rejected by server/);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
