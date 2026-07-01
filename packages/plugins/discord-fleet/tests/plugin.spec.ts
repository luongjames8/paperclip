import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";

vi.mock("../src/discord/client.js", () => ({
  createDiscordClient: vi.fn(() => ({ user: null, on: vi.fn(), once: vi.fn(), destroy: vi.fn() })),
  connectDiscordClient: vi.fn().mockResolvedValue(undefined),
  destroyDiscordClient: vi.fn(),
}));

vi.mock("../src/discord/slash.js", () => ({
  registerSlashCommands: vi.fn().mockResolvedValue(undefined),
  setupInteractionHandler: vi.fn(),
}));

// Mock PaperclipClient so jobs that reach the API layer throw fast without
// making real HTTP calls to http://localhost:3000 (which hangs under Node
// fetch's default timeout).
vi.mock("../src/api/paperclip.js", () => ({
  PaperclipClient: vi.fn().mockImplementation(() => ({
    getInProgressIssues: vi.fn().mockRejectedValue(new Error("no server in test")),
    getBlockedIssues: vi.fn().mockRejectedValue(new Error("no server in test")),
    getAssignedTodoIssues: vi.fn().mockRejectedValue(new Error("no server in test")),
    getBacklogAndTodoIssues: vi.fn().mockRejectedValue(new Error("no server in test")),
    getApprovalIssues: vi.fn().mockRejectedValue(new Error("no server in test")),
    getPendingApprovals: vi.fn().mockRejectedValue(new Error("no server in test")),
    getRoutines: vi.fn().mockRejectedValue(new Error("no server in test")),
    listIssueDocuments: vi.fn().mockRejectedValue(new Error("no server in test")),
    listIssueInteractions: vi.fn().mockRejectedValue(new Error("no server in test")),
    rejectApproval: vi.fn().mockRejectedValue(new Error("no server in test")),
  })),
}));

describe("plugin worker", () => {
  // 15s timeout: this test imports the full worker module (discord.js included)
  // and intermittently exceeds the 5s default while the suite transforms in parallel.
  it("sets up event handlers and job handlers with a valid config", { timeout: 15_000 }, async () => {
    const plugin = (await import("../src/worker.js")).default;

    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities, "jobs.schedule"],
      config: {
        botTokenSecretRef: "discord/bot-token",
        companies: [
          {
            companyId: "company-1",
            guildId: "guild-1",
            channels: { digest: "ch-digest", errors: "ch-errors", orphan: "ch-orphan" },
            projectRouting: {},
            // Cron Feb 29 00:00 — rarely lands within the 15-min fire window the
            // digest job uses to detect a missed slot, so this test is deterministic
            // regardless of wall clock. (Previous "0 7 * * *" intermittently fired
            // around 23:00-23:15 UTC when the prior 7am Taipei slot was <15min old.)
            digest: { cronExpression: "0 0 29 2 *", timezone: "Asia/Taipei" },
            stuckIssueThresholdHours: 6,
            paperclipApiKeySecretRef: "paperclip/api-key",
            paperclipApiUrl: "http://localhost:3000",
            companyPrefix: "tc1",
          },
        ],
      },
    });

    await plugin.definition.setup(harness.ctx);

    // Verify the worker registered the expected jobs.
    // digest resolves immediately — the Feb-29 cron never lands within the
    // 15-min fire window during a normal test run, so the timezone guard
    // skips it before reaching any API calls.
    // stuck-detector and routine-health throw because the mocked PaperclipClient
    // methods reject immediately (avoids real HTTP calls to localhost:3000).
    await expect(harness.runJob("discord-fleet.digest")).resolves.toBeUndefined();
    await expect(harness.runJob("discord-fleet.stuck-detector")).rejects.toThrow();
    await expect(harness.runJob("discord-fleet.routine-health")).rejects.toThrow();
  });
});
