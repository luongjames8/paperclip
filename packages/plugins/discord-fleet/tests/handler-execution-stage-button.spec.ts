/**
 * Coverage: parseExecutionStageCustomId / parseExecutionStageChangesModalCustomId
 * (pure) + handleExecutionStageButton / handleExecutionStageChangesModal (fleet
 * issue #631 / PR-0) happy + error paths, plus the stale-stage compare-and-swap
 * (expectedExecutionStageId passed to updateIssueStatus, enforced server-side —
 * hardened across codex rounds 1-3; see execution-stage-button.ts's top-of-file
 * comment for why an earlier client-side GET-then-PATCH pre-check was replaced).
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

const mockUpdateIssueStatus = vi.fn().mockResolvedValue(undefined);

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
  it(`execstage-approve:${ISSUE_ID}:${STAGE_ID} → { action: 'approve', issueId, stageId }`, () => {
    expect(parseExecutionStageCustomId(`execstage-approve:${ISSUE_ID}:${STAGE_ID}`)).toEqual({
      action: "approve",
      issueId: ISSUE_ID,
      stageId: STAGE_ID,
    });
  });

  it(`execstage-changes:${ISSUE_ID}:${STAGE_ID} → { action: 'changes', issueId, stageId }`, () => {
    expect(parseExecutionStageCustomId(`execstage-changes:${ISSUE_ID}:${STAGE_ID}`)).toEqual({
      action: "changes",
      issueId: ISSUE_ID,
      stageId: STAGE_ID,
    });
  });

  it("unrecognized prefix → null", () => {
    expect(parseExecutionStageCustomId(`something-else:${ISSUE_ID}:${STAGE_ID}`)).toBeNull();
  });

  it("missing stageId segment (legacy/malformed customId) → null", () => {
    expect(parseExecutionStageCustomId(`execstage-approve:${ISSUE_ID}`)).toBeNull();
  });
});

describe("parseExecutionStageChangesModalCustomId", () => {
  it(`execstage-changes-modal:${ISSUE_ID}:${STAGE_ID} → { issueId, stageId }`, () => {
    expect(parseExecutionStageChangesModalCustomId(`execstage-changes-modal:${ISSUE_ID}:${STAGE_ID}`)).toEqual({
      issueId: ISSUE_ID,
      stageId: STAGE_ID,
    });
  });

  it("missing stageId segment → null", () => {
    expect(parseExecutionStageChangesModalCustomId(`execstage-changes-modal:${ISSUE_ID}`)).toBeNull();
  });
});

describe("handleExecutionStageButton — approve happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthorized (no userMapping) → ephemeral reply, no API call", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeButtonInteraction(`execstage-approve:${ISSUE_ID}:${STAGE_ID}`, { discordUserId: "unmapped-user" });

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("authorized → deferUpdate then updateIssueStatus(issueId, 'done', comment, stageId)", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const resolveSecret = vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const interaction = makeButtonInteraction(`execstage-approve:${ISSUE_ID}:${STAGE_ID}`, { username: "alice" });

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    // The stageId rides along on the PATCH as the compare-and-swap token —
    // the server enforces it atomically, no separate client-side pre-check.
    expect(mockUpdateIssueStatus).toHaveBeenCalledWith(ISSUE_ID, "done", expect.stringContaining("alice"), STAGE_ID);
    // codex P2: must resolve the clicker's PERSONAL key, never fall back to
    // the company-wide key — the engine checks exact participant identity.
    expect(resolveSecret).toHaveBeenCalledWith("alice-personal-key-ref");
  });

  it("mapping has no personal boardApiKeySecretRef → ephemeral rejection, no API call (codex P2)", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeButtonInteraction(`execstage-approve:${ISSUE_ID}:${STAGE_ID}`, { discordUserId: NO_KEY_DISCORD_ID });

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
    const interaction = makeButtonInteraction(`execstage-approve:${ISSUE_ID}:${STAGE_ID}`);

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
    const interaction = makeButtonInteraction(`execstage-approve:${ISSUE_ID}:${STAGE_ID}`);

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
    const interaction = makeButtonInteraction(`execstage-approve:${ISSUE_ID}:${STAGE_ID}`);

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("already been resolved, had changes requested, or been superseded") }),
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it("swallows DiscordAPIError[10062] from deferUpdate and returns early (no crash)", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const expired: any = new Error("Unknown interaction");
    expired.code = 10062;
    const interaction = makeButtonInteraction(`execstage-approve:${ISSUE_ID}:${STAGE_ID}`);
    interaction.deferUpdate = vi.fn().mockRejectedValue(expired);

    await expect(handleExecutionStageButton(harness.ctx, interaction, makeConfig())).resolves.toBeUndefined();

    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe("handleExecutionStageButton — request changes opens a modal first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("changes action → showModal is the FIRST response, no deferUpdate, no API call", async () => {
    const { handleExecutionStageButton } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeButtonInteraction(`execstage-changes:${ISSUE_ID}:${STAGE_ID}`);

    await handleExecutionStageButton(harness.ctx, interaction, makeConfig());

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
    const modal = interaction.showModal.mock.calls[0][0];
    expect(modal.data.custom_id).toBe(`execstage-changes-modal:${ISSUE_ID}:${STAGE_ID}`);
  });
});

describe("handleExecutionStageChangesModal — submit happy + error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls updateIssueStatus(issueId, 'in_progress', note, stageId) and resolves the card", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.secrets, "resolve").mockResolvedValue("tok-abc");
    const interaction = makeModalInteraction(`execstage-changes-modal:${ISSUE_ID}:${STAGE_ID}`, "Fix the caption on slide 2.");

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(mockUpdateIssueStatus).toHaveBeenCalledWith(ISSUE_ID, "in_progress", "Fix the caption on slide 2.", STAGE_ID);
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds[0].title).toMatch(/^✏️ Changes requested/);
    expect(call.components).toEqual([]);
  });

  it("empty note → rejects with a validation reply, no API call", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeModalInteraction(`execstage-changes-modal:${ISSUE_ID}:${STAGE_ID}`, "   ");

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("unauthorized (no userMapping) → ephemeral reply, no API call", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeModalInteraction(`execstage-changes-modal:${ISSUE_ID}:${STAGE_ID}`, "some note", { discordUserId: "unmapped-user" });

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(mockUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("mapping has no personal boardApiKeySecretRef → ephemeral rejection, no API call (codex P2)", async () => {
    const { handleExecutionStageChangesModal } = await import("../src/handlers/execution-stage-button.js");
    const harness = createTestHarness({ manifest });
    const interaction = makeModalInteraction(`execstage-changes-modal:${ISSUE_ID}:${STAGE_ID}`, "some note", { discordUserId: NO_KEY_DISCORD_ID });

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
    const interaction = makeModalInteraction(`execstage-changes-modal:${ISSUE_ID}:${STAGE_ID}`, "some note");

    await handleExecutionStageChangesModal(harness.ctx, interaction, makeConfig());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("already been resolved, had changes requested, or been superseded") }),
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
