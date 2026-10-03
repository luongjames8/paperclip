/**
 * Coverage: parseExecutionStageCustomId / parseExecutionStageChangesModalCustomId
 * (pure) + handleExecutionStageButton / handleExecutionStageChangesModal (fleet
 * issue #631 / PR-0) happy + error paths, plus the stale-stage compare-and-swap
 * (expectedExecutionStageId + expectedLastDecisionToken passed to
 * updateIssueStatus, enforced server-side — hardened across codex rounds 1-5;
 * see execution-stage-button.ts's top-of-file comment for why an earlier
 * client-side GET-then-PATCH pre-check was replaced, and embeds.ts's
 * executionStageDecisionToken doc comment for why stageId alone isn't a
 * unique "pending generation" across a changes-requested cycle).
 * Mirrors handler-approval-button.spec.ts's structure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import {
  parseExecutionStageCustomId,
  parseExecutionStageChangesModalCustomId,
} from "../src/handlers/execution-stage-button.js";
import { PaperclipApiError } from "../src/api/paperclip.js";

const mockUpdateIssueStatus = vi.fn().mockResolvedValue({ executionStageDecisionRecorded: true });

vi.mock("../src/api/paperclip.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api/paperclip.js")>("../src/api/paperclip.js");
  return {
    ...actual,
    PaperclipClient: vi.fn().mockImplementation(() => ({
      updateIssueStatus: mockUpdateIssueStatus,
    })),
  };
});

const ISSUE_ID = "11111111-1111-1111-1111-111111111111";
const STAGE_ID = "22222222-2222-2222-2222-222222222222";
const DECISION_TOKEN = "abcd1234";
const ALICE_DISCORD_ID = "discord-user-alice";
const NO_KEY_DISCORD_ID = "discord-user-nokey";

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
            boardApiKeySecretRef: "alice-personal-key-ref",
          },
          // No boardApiKeySecretRef — used by the "requires a personal key" tests.
          { discordUserId: NO_KEY_DISCORD_ID, paperclipUserId: "pc-user-nokey", role: "operator" },
        ],
      },
    ],
  };
}

function makeButtonInteraction(customId: string, opts?: { username?: string; discordUserId?: string }): any {
  const embed = {
    title: "🟡 Review needed — ISS-1",
    toJSON: () => ({ title: "🟡 Review needed — ISS-1", color: 0xfee75c, description: "some description" }),
  };
  return {
    customId,
    guildId: "g1",
    user: { id: opts?.discordUserId ?? ALICE_DISCORD_ID, username: opts?.username ?? "alice" },
    message: { embeds: [embed] },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

function makeModalInteraction(customId: string, note: string | undefined, opts?: { username?: string; discordUserId?: string }): any {
  const embed = {
    title: "🟡 Review needed — ISS-1",
    toJSON: () => ({ title: "🟡 Review needed — ISS-1", color: 0xfee75c, description: "some description" }),
  };
  return {
    customId,
    guildId: "g1",
    user: { id: opts?.discordUserId ?? ALICE_DISCORD_ID, username: opts?.username ?? "alice" },
    message: { embeds: [embed] },
    fields: { getTextInputValue: vi.fn().mockReturnValue(note ?? "") },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

describe("parseExecutionStageCustomId", () => {
  it(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN} → { action: 'approve', issueId, stageId, decisionToken }`, () => {
    expect(parseExecutionStageCustomId(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`)).toEqual({
      action: "approve",
      issueId: ISSUE_ID,
      stageId: STAGE_ID,
      decisionToken: DECISION_TOKEN,
    });
  });

  it(`exs-chg:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN} → { action: 'changes', issueId, stageId, decisionToken }`, () => {
    expect(parseExecutionStageCustomId(`exs-chg:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`)).toEqual({
      action: "changes",
      issueId: ISSUE_ID,
      stageId: STAGE_ID,
      decisionToken: DECISION_TOKEN,
    });
  });

  it("unrecognized prefix → null", () => {
    expect(parseExecutionStageCustomId(`something-else:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`)).toBeNull();
  });

  it("missing decisionToken segment (legacy/malformed customId) → null", () => {
    expect(parseExecutionStageCustomId(`exs-ok:${ISSUE_ID}:${STAGE_ID}`)).toBeNull();
  });
});

describe("parseExecutionStageChangesModalCustomId", () => {
  it(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN} → { issueId, stageId, decisionToken }`, () => {
    expect(parseExecutionStageChangesModalCustomId(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`)).toEqual({
      issueId: ISSUE_ID,
      stageId: STAGE_ID,
      decisionToken: DECISION_TOKEN,
    });
  });

  it("missing decisionToken segment → null", () => {
    expect(parseExecutionStageChangesModalCustomId(`exs-chgm:${ISSUE_ID}:${STAGE_ID}`)).toBeNull();
  });
});

describe("handleExecutionStageButton — approve happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthorized (no userMapping) → ephemeral reply, no API call", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, { discordUserId: "unmapped-user" });

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("authorized → deferUpdate then updateIssueStatus(issueId, 'done', comment, stageId, decisionToken)", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, { username: "alice" });

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    // stageId + decisionToken ride along on the PATCH as the compare-and-swap
    // tokens — the server enforces both atomically, no client-side pre-check.
    expect(mockUpdateIssueStatus).toHaveBeenCalledWith(ISSUE_ID, "done", expect.stringContaining("alice"), STAGE_ID, DECISION_TOKEN);
    // codex P2: must resolve the clicker's PERSONAL key, never fall back to
    // the company-wide key — the engine checks exact participant identity.
    expect(resolveSecret).toHaveBeenCalledWith("alice-personal-key-ref");
  });

  it("mapping has no personal boardApiKeySecretRef → ephemeral rejection, no API call (codex P2)", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, { discordUserId: NO_KEY_DISCORD_ID });

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("personal boardApiKeySecretRef"), ephemeral: true }),
    );
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("editReply shows a resolved (no-button) card after approving", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds[0].title).toMatch(/^✅ Approved/);
    expect(call.components).toEqual([]);
  });

  it("422 from the API surfaces 'Rejected by server:' to the clicker", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    mockUpdateIssueStatus.mockRejectedValueOnce(new PaperclipApiError("nope", 422, "http://x"));
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Rejected by server:") }),
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it("409 (server-side compare-and-swap rejection) surfaces the stale-stage message, not a raw error", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    mockUpdateIssueStatus.mockRejectedValueOnce(new PaperclipApiError("stage superseded", 409, "http://x"));
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("newer version was posted") }),
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it("swallows DiscordAPIError[10062] from deferUpdate and returns early (no crash)", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const expired: any = new Error("Unknown interaction");
    expired.code = 10062;
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);
    interaction.deferUpdate = vi.fn().mockRejectedValue(expired);

    await expect(handleExecutionStageButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  // codex round 10: a 200 response doesn't by itself prove a decision was
  // recorded — a policy edit under a stale card (server-side gate closes the
  // known cases, but the client must not trust "didn't throw" alone) can
  // return 200 with executionStageDecisionRecorded:false. The card must show
  // an honest "stage changed" outcome, not "✅ Approved".
  it("executionStageDecisionRecorded:false → honest 'stage changed' outcome, not '✅ Approved'", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    mockUpdateIssueStatus.mockResolvedValueOnce({ executionStageDecisionRecorded: false });
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("newer version was posted"), ephemeral: true }),
    );
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds[0].title).toMatch(/^⚠️ Stage changed/);
    expect(call.embeds[0].title).not.toMatch(/Approved/);
  });

  // adversarial-seam-hardening (round 11): secrets.resolve used to run
  // OUTSIDE the try/catch that reports API failures — a missing/renamed
  // secret threw uncaught past deferUpdate, leaving the click acknowledged
  // but silent. Now folded into the same guarded call.
  it("ctx.secrets.resolve throwing (missing/renamed secret) → ephemeral failure message, no crash, no card render", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockRejectedValue(new Error("secret ref not found"));
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);

    await expect(handleExecutionStageButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Failed to approve:"), ephemeral: true }),
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  // adversarial-seam-hardening (round 11): the render step (editReply/
  // followUp) used to be unguarded — if it throws AFTER the decision already
  // succeeded server-side, the operator saw a stale card with live buttons
  // and no indication anything happened. Now caught, logged, and a
  // best-effort ephemeral message names the outcome anyway.
  it("render step (editReply) throwing after a SUCCESSFUL decision → logged, best-effort ephemeral message, no crash", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const interaction = makeButtonInteraction(`exs-ok:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);
    interaction.editReply = vi.fn().mockRejectedValue(new Error("interaction token expired"));

    await expect(handleExecutionStageButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(mockUpdateIssueStatus).toHaveBeenCalled();
    const errorLog = harness.logs.find(
      (l) => l.message === "execution-stage-button: decision succeeded server-side but rendering the outcome failed — Paperclip is correct, the Discord card may be stale",
    );
    expect(errorLog?.meta).toMatchObject({ issueId: ISSUE_ID });
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("couldn't update the card"), ephemeral: true }),
    );
  });
});

describe("handleExecutionStageButton — request changes opens a modal first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("changes action → showModal is the FIRST response, no deferUpdate, no API call", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeButtonInteraction(`exs-chg:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    const modal = interaction.showModal.mock.calls[0][0];
    expect(modal.data.custom_id).toBe(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`);
  });
});

describe("handleExecutionStageChangesModal — submit happy + error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls updateIssueStatus(issueId, 'in_progress', note, stageId, decisionToken) and resolves the card", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "Fix the caption on slide 2.");

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(mockUpdateIssueStatus).toHaveBeenCalledWith(ISSUE_ID, "in_progress", "Fix the caption on slide 2.", STAGE_ID, DECISION_TOKEN);
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds[0].title).toMatch(/^✏️ Changes requested/);
    expect(call.components).toEqual([]);
  });

  it("empty note → rejects with a validation reply, no API call", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "   ");

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("unauthorized (no userMapping) → ephemeral reply, no API call", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "some note", { discordUserId: "unmapped-user" });

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("mapping has no personal boardApiKeySecretRef → ephemeral rejection, no API call (codex P2)", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "some note", { discordUserId: NO_KEY_DISCORD_ID });

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("personal boardApiKeySecretRef"), ephemeral: true }),
    );
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("409 (server-side compare-and-swap rejection) surfaces the stale-stage message, not a raw error", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    mockUpdateIssueStatus.mockRejectedValueOnce(new PaperclipApiError("stage superseded", 409, "http://x"));
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "some note");

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("newer version was posted") }),
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  // codex round 10: same "200 isn't proof" gap as the approve path.
  it("executionStageDecisionRecorded:false → honest 'stage changed' outcome, not '✏️ Changes requested'", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    mockUpdateIssueStatus.mockResolvedValueOnce({ executionStageDecisionRecorded: false });
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "some note");

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("newer version was posted"), ephemeral: true }),
    );
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds[0].title).toMatch(/^⚠️ Stage changed/);
    expect(call.embeds[0].title).not.toMatch(/Changes requested/);
  });

  // adversarial-seam-hardening (round 11): the modal submit's deferUpdate()
  // had NO try/catch at all — unlike the button handler's equivalent call,
  // an expired-interaction (10062) throw here propagated uncaught. Both
  // paths now share runExecutionStageDecision, so this is symmetric.
  it("swallows DiscordAPIError[10062] from deferUpdate and returns early (no crash)", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const expired: any = new Error("Unknown interaction");
    expired.code = 10062;
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "some note");
    interaction.deferUpdate = vi.fn().mockRejectedValue(expired);

    await expect(handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  // adversarial-seam-hardening (round 11): same secrets.resolve-outside-try
  // gap codex flagged for the button path also existed here.
  it("ctx.secrets.resolve throwing (missing/renamed secret) → ephemeral failure message, no crash, no card render", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockRejectedValue(new Error("secret ref not found"));
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "some note");

    await expect(handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Failed to request changes:"), ephemeral: true }),
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it("render step (editReply) throwing after a SUCCESSFUL decision → logged, best-effort ephemeral message, no crash", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "some note");
    interaction.editReply = vi.fn().mockRejectedValue(new Error("interaction token expired"));

    await expect(handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(mockUpdateIssueStatus).toHaveBeenCalled();
    const errorLog = harness.logs.find(
      (l) => l.message === "execution-stage-button: decision succeeded server-side but rendering the outcome failed — Paperclip is correct, the Discord card may be stale",
    );
    expect(errorLog?.meta).toMatchObject({ issueId: ISSUE_ID });
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("couldn't update the card"), ephemeral: true }),
    );
  });

  // adversarial-seam-hardening (round 11): renderResolved used to return
  // silently with no log line if the interaction message had no embed
  // snapshot — indistinguishable from every other silent failure this seam
  // exists to eliminate.
  it("missing embed on the interaction message → logs a warning instead of silently returning", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const interaction = makeModalInteraction(`exs-chgm:${ISSUE_ID}:${STAGE_ID}:${DECISION_TOKEN}`, "some note");
    interaction.message = { embeds: [] };

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.editReply).not.toHaveBeenCalled();
    const warnLog = harness.logs.find(
      (l) => l.message === "execution-stage-button: no embed on the interaction message, outcome not rendered",
    );
    expect(warnLog?.meta).toMatchObject({ label: "✏️ Changes requested" });
  });
});
