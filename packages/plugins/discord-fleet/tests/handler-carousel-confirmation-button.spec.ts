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

const ANCHOR_ISSUE_URL = "http://paperclip:3100/tc1/issues/ISS-1";

// Real discord.js Embed instances expose `.description` as a direct getter
// (no .toJSON() call needed to read it) — the anchor-resolution code
// (renderAnchorResolved in the handler) reads interaction.message.embeds[0]
// directly, so the mock must shape its embed the same way.
function makeInteraction(
  customId: string,
  opts?: { username?: string; reason?: string; discordUserId?: string },
): any {
  const embed = {
    title: "Decision needed",
    color: 0x5865f2,
    description: `🟡 awaiting decision\n[View full batch in Paperclip](${ANCHOR_ISSUE_URL})`,
    toJSON() {
      return { title: this.title, color: this.color, description: this.description };
    },
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

  it("calls acceptInteraction with issueId + interactionId, then edits the ANCHOR (accepted status) + strips components", async () => {
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
    expect(call.embeds[0].description).toMatch(/✅ accepted/);
    expect(call.embeds[0].description).toMatch(/Accepted by alice/);
  });

  // ─── ACK-FIRST ordering (kills failure 1, 2026-07-11 live incident) ───────
  //
  // deferUpdate must be the FIRST call this handler makes — strictly before
  // any paperclip I/O (secrets.resolve, listIssueInteractions). A slow
  // network call ahead of the ack is exactly what blew the 3s window and
  // produced a swallowed DiscordAPIError 10062 with zero operator-visible
  // outcome.
  it("deferUpdate fires BEFORE any paperclip I/O (secrets.resolve / listIssueInteractions)", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const callOrder: string[] = [];
    vi.spyOn(harness.ctx.secrets, "resolve").mockImplementation(async () => {
      callOrder.push("secrets.resolve");
      return "tok-abc";
    });
    mockListIssueInteractions.mockImplementation(async () => {
      callOrder.push("listIssueInteractions");
      return currentInteractionRow();
    });

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    interaction.deferUpdate = vi.fn().mockImplementation(async () => {
      callOrder.push("deferUpdate");
    });
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(callOrder[0]).toBe("deferUpdate");
    expect(callOrder.indexOf("deferUpdate")).toBeLessThan(callOrder.indexOf("secrets.resolve"));
    expect(callOrder.indexOf("deferUpdate")).toBeLessThan(callOrder.indexOf("listIssueInteractions"));
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
//
// ACK-FIRST NOTE (2026-07-11 rewrite): for ACCEPT, deferUpdate is now the
// unconditional first response, so a stale refusal now arrives via
// followUp (not reply) — the interaction is already acked by the time the
// version check runs. For REJECT, showModal is now the unconditional first
// response (validation moved to modal-submit entirely), so a stale hash8 on
// the BUTTON click no longer prevents the modal from opening — the refusal
// now happens when the (fresh) modal-submit interaction is validated. See
// the "handleCarouselConfirmationRejectModal — stale version-token guard on
// submit" describe block below for that path.

describe("handleCarouselConfirmationButton — stale version-token guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accept: hash8 mismatch (stale trailer) → ack (deferUpdate) THEN ephemeral stale followUp, ZERO paperclip mutation calls", async () => {
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${STALE_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(mockAcceptInteraction).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("reject: hash8 mismatch on the BUTTON click still opens the modal (validation deferred to modal submit) — zero paperclip mutation calls from the button click itself", async () => {
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-no:${STALE_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
    // isCurrentVersion (the paperclip fetch) is NEVER invoked from the button
    // click anymore — it only runs after the modal-submit interaction acks.
    expect(mockListIssueInteractions).not.toHaveBeenCalled();
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
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("LEGACY (pre-versioning, no hash token) accept customId → ack THEN ephemeral stale followUp, zero paperclip mutation calls", async () => {
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`carousel-confirm-accept:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(mockAcceptInteraction).not.toHaveBeenCalled();
  });

  it("interaction no longer found (e.g. deleted/resolved) → stale refusal, not a crash", async () => {
    mockListIssueInteractions.mockResolvedValue([]); // interactionId not present
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
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
//
// ACK-FIRST NOTE: accept's refusal is now a followUp (post-ack); reject's
// mapping check moved entirely to modal-submit (see the reject-modal
// describe block), so an unmapped user's BUTTON click still opens the modal.

describe("handleCarouselConfirmationButton — authorization gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
  });

  it("accept: unmapped user gets an ack (deferUpdate) THEN an ephemeral followUp refusal, NO paperclip API call", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: MALLORY_DISCORD_ID,
      username: "mallory",
    });
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/not authorized/) }),
    );
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(mockAcceptInteraction).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("reject: unmapped user's BUTTON click still opens the modal (auth check deferred to modal submit) — zero paperclip API calls from the click itself", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-no:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: MALLORY_DISCORD_ID,
      username: "mallory",
    });
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
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

  it("unmapped user gets an ack (deferUpdate) THEN an ephemeral followUp refusal, NO paperclip API call (re-checked on modal submit)", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, {
      discordUserId: MALLORY_DISCORD_ID,
      username: "mallory",
      reason: "some reason",
    });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/not authorized/) }),
    );
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  // ─── ACK-FIRST ordering on modal submit ───────────────────────────────────
  it("deferUpdate fires BEFORE any paperclip I/O on modal submit too (fresh token, own ack)", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    const callOrder: string[] = [];
    vi.spyOn(harness.ctx.secrets, "resolve").mockImplementation(async () => {
      callOrder.push("secrets.resolve");
      return "tok-abc";
    });
    mockListIssueInteractions.mockImplementation(async () => {
      callOrder.push("listIssueInteractions");
      return currentInteractionRow();
    });

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    interaction.deferUpdate = vi.fn().mockImplementation(async () => {
      callOrder.push("deferUpdate");
    });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(callOrder[0]).toBe("deferUpdate");
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
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/reason is required/) }));
  });

  it("calls rejectInteraction with the typed reason, then edits the ANCHOR (rejected status) + strips components", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "Wrong week's slides", username: "bob" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(mockRejectInteraction).toHaveBeenCalledWith(ISSUE_ID, INTERACTION_ID, "Wrong week's slides");
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.components).toEqual([]);
    expect(call.embeds[0].description).toMatch(/❌ rejected/);
    expect(call.embeds[0].description).toMatch(/Rejected by bob/);
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
  it("hash8 mismatch on submit → ack (deferUpdate) THEN ephemeral stale followUp, ZERO paperclip mutation calls", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${STALE_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("LEGACY (no hash token) reject-modal customId → ack THEN stale followUp refusal, zero paperclip mutation calls", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY}${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/stale/i) }),
    );
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });
});

// ─── 10062 (interaction expired) at the ack call itself ─────────────────────
//
// Discord's 3s window can still expire even with ack-first (e.g. gateway
// starvation) — the handler must return gracefully, not throw and hit the
// dispatcher's swallow-and-log path.

describe("handleCarouselConfirmationButton — 10062 at the ack call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reject: showModal throwing 10062 is caught and returns gracefully (no unhandled throw)", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });

    const interaction = makeInteraction(`car-no:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    const expiredErr: any = new Error("Unknown interaction");
    expiredErr.code = 10062;
    interaction.showModal = vi.fn().mockRejectedValue(expiredErr);

    await expect(handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();
    expect(mockRejectInteraction).not.toHaveBeenCalled();
  });

  it("accept: deferUpdate throwing 10062 is caught and returns gracefully (no unhandled throw)", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    const expiredErr: any = new Error("Unknown interaction");
    expiredErr.code = 10062;
    interaction.deferUpdate = vi.fn().mockRejectedValue(expiredErr);

    await expect(handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();
    expect(mockAcceptInteraction).not.toHaveBeenCalled();
  });

  it("a non-10062 error from deferUpdate still throws (not silently swallowed at the ack layer — the OUTER dispatcher logs it)", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    interaction.deferUpdate = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig())).rejects.toThrow("network blip");
  });
});

// ─── Unexpected error AFTER ack → visible followUp, never silently swallowed ─
//
// Kills the "button handler threw, swallowed to keep worker alive" failure
// mode (2026-07-11 live incident, failure 1): once the interaction is acked,
// this handler's own try/catch must ALWAYS attempt a followUp before letting
// anything reach the top-level dispatcher's console.error-only swallow.

describe("handleCarouselConfirmationButton — unexpected error after ack surfaces visibly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
  });

  it("accept: an unexpected throw after ack (e.g. secrets.resolve blows up) still produces a visible ephemeral followUp", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockRejectedValue(new Error("secrets store unreachable"));

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await expect(handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/went wrong/i) }),
    );
  });

  it("accept: even if the followUp itself fails, the handler resolves without throwing (last line of defense is the outer dispatcher's log)", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockRejectedValue(new Error("secrets store unreachable"));

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    interaction.followUp = vi.fn().mockRejectedValue(new Error("15-minute window expired"));

    await expect(handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();
  });

  it("reject modal submit: an unexpected throw after ack still produces a visible ephemeral followUp", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockRejectedValue(new Error("secrets store unreachable"));

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    await expect(handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/went wrong/i) }),
    );
  });
});

// ─── Anchor edit-not-repost invariant ────────────────────────────────────────
//
// The button handler must NEVER post a new message for a decision outcome —
// only edit the anchor (interaction.editReply). Guards against a regression
// that reintroduces "stacked generations" via the button-handler side.

describe("handleCarouselConfirmationButton / RejectModal — anchor edit-not-repost invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListIssueInteractions.mockResolvedValue(currentInteractionRow());
  });

  it("accept: only editReply is used to render the outcome — no reply/followUp on the happy path", async () => {
    const { handleCarouselConfirmationButton } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`car-ok:${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`);
    await handleCarouselConfirmationButton(harness.ctx, interaction, makeConfig());

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("reject modal submit: only editReply is used to render the outcome on the happy path", async () => {
    const { handleCarouselConfirmationRejectModal } = await import("../src/handlers/carousel-confirmation-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");

    const interaction = makeInteraction(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${CURRENT_HASH8}:${ISSUE_ID}:${INTERACTION_ID}`, { reason: "some reason" });
    await handleCarouselConfirmationRejectModal(harness.ctx, interaction, makeConfig());

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});
