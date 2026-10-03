import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { CompanyConfig } from "../src/config/schema.js";
import type { PaperclipClient } from "../src/api/paperclip.js";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postToChannel: vi.fn().mockResolvedValue("msg-id-123"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-456"),
  postToThread: vi.fn().mockResolvedValue("msg-id-789"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id-abc"),
}));

function makeCompanyConfig(): CompanyConfig {
  return {
    companyId: "company-1",
    guildId: "guild-1",
    channels: { digest: "channel-digest", errors: "channel-errors", orphan: "channel-orphan" },
    projectRouting: {},
    digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
    stuckIssueThresholdHours: 6,
    paperclipApiKeySecretRef: "paperclip/api-key",
    paperclipApiUrl: "http://localhost:3000",
    companyPrefix: "tc1",
  };
}

function makeMockClient(): Client {
  return {} as Client;
}

// Taipei 07:01 = UTC 23:01 on Jan 14 — within 15 min of the 07:00 fire → should fire
const NOW_AT_0701_TAIPEI = new Date(Date.UTC(2025, 0, 14, 23, 1, 0));

describe("runDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts 'All clear' when there are no errors and no pending approvals", async () => {
    const { runDigest } = await import("../src/jobs/digest.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const mockPaperclip = {
      getErrorsLast24h: vi.fn().mockResolvedValue([]),
      getInProgressIssues: vi.fn().mockResolvedValue([]),
      getRoutines: vi.fn().mockResolvedValue([]),
      getIssueById: vi.fn().mockResolvedValue(null),
    } as unknown as PaperclipClient;

    await runDigest(harness.ctx, "company-1", makeMockClient(), makeCompanyConfig(), mockPaperclip, NOW_AT_0701_TAIPEI);

    expect(postToChannel).toHaveBeenCalledTimes(1);
    const [, , text] = (postToChannel as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("All clear");
  });

  it("posts pending approvals and blocked issues when both are present", async () => {
    const { runDigest } = await import("../src/jobs/digest.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });

    // Seed one pending approval ID in state
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "company-1", stateKey: "pending-approvals" },
      ["approval-id-001"],
    );

    const mockPaperclip = {
      getErrorsLast24h: vi.fn().mockResolvedValue([
        {
          id: "iss-1",
          identifier: "ISS-001",
          title: "Something went very wrong in production",
          status: "blocked",
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ]),
      getInProgressIssues: vi.fn().mockResolvedValue([]),
      getRoutines: vi.fn().mockResolvedValue([]),
      getIssueById: vi.fn().mockResolvedValue(null),
    } as unknown as PaperclipClient;

    await runDigest(harness.ctx, "company-1", makeMockClient(), makeCompanyConfig(), mockPaperclip, NOW_AT_0701_TAIPEI);

    expect(postToChannel).toHaveBeenCalledTimes(1);
    const [, , text] = (postToChannel as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("Pending approvals");
    expect(text).toContain("Blocked issues");

    // M1: pending-approvals must be cleared after digest so they don't re-post next run
    const remaining = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "company-1",
      stateKey: "pending-approvals",
    });
    expect(remaining).toEqual([]);
  });
});
