/**
 * Coverage: parseCarouselConfirmCustomId / parseCarouselConfirmRejectModalCustomId
 * (pure) + handleCarouselConfirmationButton / handleCarouselConfirmationRejectModal
 * happy + error paths, plus the customId length assertion in embeds.ts, plus the
 * version-token (hash8) stale-trailer guard added in PR #27 codex round 3.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import {
  parseCarouselConfirmCustomId,
  parseCarouselConfirmRejectModalCustomId,
} from "../src/handlers/carousel-confirmation-button.js";
import {
  buildCarouselConfirmationActionRow,
  CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX,
  CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY,
  CAROUSEL_HASH_TOKEN_LEN,
} from "../src/render/embeds.js";
import { PaperclipApiError } from "../src/api/paperclip.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const mockAcceptInteraction = vi.fn().mockResolvedValue(undefined);
const mockRejectInteraction = vi.fn().mockResolvedValue(undefined);
const mockListIssueInteractions = vi.fn();

vi.mock("../src/api/paperclip.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api/paperclip.js")>("../src/api/paperclip.js");
  return {
    ...actual,
    PaperclipClient: vi.fn().mockImplementation(() => ({
      acceptInteraction: mockAcceptInteraction,
      rejectInteraction: mockRejectInteraction,
      listIssueInteractions: mockListIssueInteractions,
    })),
  };
});

const ISSUE_ID = "11111111-1111-1111-1111-111111111111";
const INTERACTION_ID = "22222222-2222-2222-2222-222222222222";
const ALICE_DISCORD_ID = "discord-user-alice";
const MALLORY_DISCORD_ID = "discord-user-mallory";

const CURRENT_DETAILS = "**1. tokyo-tour (Mon)**\n![slide1](https://r2.example.com/1.jpg)\n\nCaption.";
const CURRENT_HASH8 = sha256(CURRENT_DETAILS).slice(0, CAROUSEL_HASH_TOKEN_LEN);
const STALE_HASH8 = sha256("some other, older artifact body").slice(0, CAROUSEL_HASH_TOKEN_LEN);

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

// Interaction as re-fetched from paperclip at click time, carrying the CURRENT
// (i.e. matching CURRENT_HASH8) detailsMarkdown.
function currentInteractionRow() {
  return [{ id: INTERACTION_ID, kind: "request_confirmation", status: "pending", payload: { detailsMarkdown: CURRENT_DETAILS } }];
}

describe("parseCarouselConfirmCustomId", () => {
  it(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID} → accept action + hash8`, () => {
    const result = parseCarouselConfirmCustomId(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    expect(result).toEqual({ action: "accept", issueId: ISSUE_ID, interactionId: INTERACTION_ID, hash8: CURRENT_HASH8 });
  });

  it(`car-no:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID} → reject action + hash8`, () => {
    const result = parseCarouselConfirmCustomId(`car-no:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    expect(result).toEqual({ action: "reject", issueId: ISSUE_ID, interactionId: INTERACTION_ID, hash8: CURRENT_HASH8 });
  });

  it("unrecognized prefix (e.g. an approval-* customId) → null — never cross-routed", () => {
    expect(parseCarouselConfirmCustomId("approval-approve:appr-1")).toBeNull();
  });

  it("missing interactionId segment → null", () => {
    expect(parseCarouselConfirmCustomId(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}`)).toBeNull();
  });

  // ─── Backward compat: OLD (pre-versioning) customId shape ──────────────────
  it(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID} (LEGACY, no hash) → accept action, hash8 undefined`, () => {
    const result = parseCarouselConfirmCustomId(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`);
    expect(result).toEqual({ action: "accept", issueId: ISSUE_ID, interactionId: INTERACTION_ID });
    expect(result?.hash8).toBeUndefined();
  });

  it(`carousel-confirm-reject:${ISSUE_ID}:${INTERACTION_ID} (LEGACY, no hash) → reject action, hash8 undefined`, () => {
    const result = parseCarouselConfirmCustomId(`carousel-confirm-reject:${ISSUE_ID}:${INTERACTION_ID}`);
    expect(result).toEqual({ action: "reject", issueId: ISSUE_ID, interactionId: INTERACTION_ID });
    expect(result?.hash8).toBeUndefined();
  });
});

describe("customId length assertion (new versioned format)", () => {
  it("full reject-modal customId (prefix + hash8 + issueId + ':' + interactionId) stays within Discord's 100-char limit", () => {
    const fullId = `${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`;
    expect(fullId.length).toBeLessThanOrEqual(100);
  });
});

describe("parseCarouselConfirmRejectModalCustomId", () => {
  it(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID} parses ids + hash8`, () => {
    const result = parseCarouselConfirmRejectModalCustomId(
      `${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`,
    );
    expect(result).toEqual({ issueId: ISSUE_ID, interactionId: INTERACTION_ID, hash8: CURRENT_HASH8 });
  });

  it("unrelated prefix → null", () => {
    expect(parseCarouselConfirmRejectModalCustomId("approval-revision-modal:appr-1")).toBeNull();
  });

  it(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY}${ISSUE_ID}:${INTERACTION_ID} (LEGACY, no hash) parses ids, hash8 undefined`, () => {
    const result = parseCarouselConfirmRejectModalCustomId(
      `${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY}${ISSUE_ID}:${INTERACTION_ID}`,
    );
    expect(result).toEqual({ issueId: ISSUE_ID, interactionId: INTERACTION_ID });
    expect(result?.hash8).toBeUndefined();
  });
});

describe("buildCarouselConfirmationActionRow — customId length assertion", () => {
  it("customIds stay within Discord's 100-char limit for UUID-length ids + hash8 token", () => {
    const row = buildCarouselConfirmationActionRow(ISSUE_ID, INTERACTION_ID, CURRENT_HASH8);
    for (const c of row.components as any[]) {
      expect(c.custom_id.length).toBeLessThanOrEqual(100);
    }
    // Reject prefix is the longest: 7 ("car-no:") + 8 (hash8) + 1 + 36 + 1 + 36 = 89.
    const rejectButton = (row.components as any[]).find((c) => c.custom_id.startsWith("car-no:"));
    expect(rejectButton.custom_id.length).toBe(89);
  });

  it("throws if a hypothetically longer id would exceed 100 chars", () => {
    const overlong = "x".repeat(80);
    expect(() => buildCarouselConfirmationActionRow(overlong, overlong, CURRENT_HASH8)).toThrow(/exceeds Discord/);
  });
});

describe("handleCarouselConfirmationButton — accept happy path (matching hash proceeds)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
  });

  it("calls acceptInteraction with issueId + interactionId, then edits the trailer + strips components", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { username: "alice" });
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

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
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

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp.mock.calls[0][0].ephemeral).toBe(true);
    expect(interaction.followUp.mock.calls[0][0].content).toMatch(/Rejected by server/);
  });
});

describe("handleCarouselConfirmationButton — reject opens a modal (matching hash)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
  });

  it("shows a modal instead of deferring/calling the API directly", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-no:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
    const modal = interaction.showModal.mock.calls[0][0];
    expect(modal.data.custom_id).toBe(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
  });
});

// ─── Version-token stale-trailer guard (codex P2 round 3, PR #27) ───────────
//
// A previous trailer left live after a hashChanged re-post must refuse
// accept/reject clicks — its customId's hash8 no longer matches the
// interaction's CURRENT detailsMarkdown.

describe("handleCarouselConfirmationButton — stale version-token guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accept: hash8 mismatch (stale trailer) → ephemeral stale refusal, ZERO paperclip mutation calls", async () => {
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${STALE_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockAcceptInteraction).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("reject: hash8 mismatch → ephemeral stale refusal BEFORE the modal is shown", async () => {
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-no:${STALE_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("matching hash8 proceeds normally (control case — proves the guard discriminates, not blanket-refuses)", async () => {
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(mockAcceptInteraction).toHaveBeenCalledWith(ISSUE_ID, INTERACTION_ID);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("LEGACY (pre-versioning, no hash token) customId → stale refusal, zero paperclip mutation calls", async () => {
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockAcceptInteraction).not.toHaveBeenCalled();
  });

  it("interaction no longer found (e.g. deleted/resolved) → stale refusal, not a crash", async () => {
    mockListIssueInteractions.mockResolvedValue([]); // interactionId not present
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(mockAcceptInteraction).not.toHaveBeenCalled();
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
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
  });

  it("accept: unmapped user gets an ephemeral refusal and NO paperclip API call", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
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

    const interaction = makeInteraction(`car-no:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
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

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
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

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
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
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
  });

  it("unmapped user gets an ephemeral refusal and NO paperclip API call (re-checked on modal submit)", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
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

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
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

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "   " });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(mockRejectInteraction).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/reason is required/) }));
  });

  it("calls rejectInteraction with the typed reason, then edits the trailer + strips components", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "Wrong week's slides", username: "bob" });
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

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp.mock.calls[0][0].ephemeral).toBe(true);
    expect(interaction.followUp.mock.calls[0][0].content).toMatch(/Rejected by server/);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  // ─── Version-token stale-trailer guard on modal submit ────────────────────
  it("hash8 mismatch on submit → ephemeral stale refusal, ZERO paperclip mutation calls", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${STALE_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("LEGACY (no hash token) reject-modal customId → stale refusal, zero paperclip mutation calls", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY}${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });
});
