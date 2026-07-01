/**
 * Tests for CHANGE 3: stuck-detector new categories
 *   (b) blocked issues with empty/absent blockedByIssueIds
 *   (c) todo issues with an assignee older than threshold
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipClient, PaperclipIssue } from "../src/api/paperclip.js";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id"),
  postToChannel: vi.fn().mockResolvedValue("msg-id"),
  postToThread: vi.fn().mockResolvedValue("msg-id"),
}));

const NOW_ISO = "2026-07-01T12:00:00.000Z";
const STALE_ISO = "2026-07-01T00:00:00.000Z"; // 12h ago relative to NOW_ISO

function makeConfig(stuckHours = 6): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: stuckHours,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
    ],
  };
}

function makeIssue(overrides: Partial<PaperclipIssue> = {}): PaperclipIssue {
  return {
    id: "iss-1",
    identifier: "ISS-1",
    title: "Test issue",
    status: "blocked",
    updatedAt: STALE_ISO,
    createdAt: STALE_ISO,
    ...overrides,
  };
}

function makePaperclip(overrides: Partial<{
  inProgress: PaperclipIssue[];
  blocked: PaperclipIssue[];
  todo: PaperclipIssue[];
}> = {}): PaperclipClient {
  return {
    getInProgressIssues: vi.fn().mockResolvedValue(overrides.inProgress ?? []),
    getBlockedIssues: vi.fn().mockResolvedValue(overrides.blocked ?? []),
    getAssignedTodoIssues: vi.fn().mockResolvedValue(overrides.todo ?? []),
  } as unknown as PaperclipClient;
}

describe("runStuckDetector — category B: blocked with no blockers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts a group embed when a blocked issue has empty blockedByIssueIds", async () => {
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    const paperclip = makePaperclip({
      blocked: [makeIssue({ status: "blocked", blockedByIssueIds: [] })],
    });

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    // errors channel should receive the group embed
    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const errorChannelCalls = calls.filter(([, ch]) => ch === "e1");
    expect(errorChannelCalls.length).toBeGreaterThan(0);
    const embed = errorChannelCalls.find(([, , e]) => /no declared blockers/i.test(e?.title ?? ""))?.[2];
    expect(embed?.title).toMatch(/no declared blockers/i);
  });

  it("posts a group embed when blockedByIssueIds is absent", async () => {
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    // blockedByIssueIds is undefined (absent from server response)
    const paperclip = makePaperclip({
      blocked: [makeIssue({ status: "blocked" })],  // no blockedByIssueIds key
    });

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const errorChannelCalls = calls.filter(([, ch]) => ch === "e1");
    expect(errorChannelCalls.length).toBeGreaterThan(0);
  });

  it("does NOT alert a blocked issue that has non-empty blockedByIssueIds", async () => {
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    const paperclip = makePaperclip({
      blocked: [makeIssue({ status: "blocked", blockedByIssueIds: ["other-iss-1"] })],
    });

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const noBlockerCalls = calls.filter(([, , e]) => /no declared blockers/i.test(e?.title ?? ""));
    expect(noBlockerCalls).toHaveLength(0);
  });

  it("does not re-alert within 24h per issue", async () => {
    const { runStuckDetector, STUCK_DETECTOR_STATE_KEY } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    const paperclip = makePaperclip({
      blocked: [makeIssue({ id: "iss-bb", identifier: "ISS-BB", status: "blocked", blockedByIssueIds: [] })],
    });

    // Seed state: already alerted this issue 1h ago.
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: STUCK_DETECTOR_STATE_KEY },
      { "blocked_no_blockers:iss-bb": new Date(new Date(NOW_ISO).getTime() - 1 * 3_600_000).toISOString() },
    );

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const noBlockerCalls = calls.filter(([, , e]) => /no declared blockers/i.test(e?.title ?? ""));
    expect(noBlockerCalls).toHaveLength(0);
  });
});

describe("runStuckDetector — category C: assigned todo with no wake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts a group embed for an assigned todo issue older than threshold", async () => {
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    const paperclip = makePaperclip({
      todo: [makeIssue({ id: "iss-t1", identifier: "ISS-T1", status: "todo", assigneeAgentId: "agent-1" })],
    });

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const lostWakeCalls = calls.filter(([, , e]) => /assigned todo/i.test(e?.title ?? ""));
    expect(lostWakeCalls.length).toBeGreaterThan(0);
  });

  it("does NOT alert unassigned todo issues", async () => {
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    const paperclip = makePaperclip({
      todo: [makeIssue({ status: "todo" })],  // no assignee
    });

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const lostWakeCalls = calls.filter(([, , e]) => /assigned todo/i.test(e?.title ?? ""));
    expect(lostWakeCalls).toHaveLength(0);
  });

  it("does NOT alert assigned todo issues newer than threshold", async () => {
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    // Issue updated only 2h ago — below threshold of 6h
    const recentIso = new Date(new Date(NOW_ISO).getTime() - 2 * 3_600_000).toISOString();
    const paperclip = makePaperclip({
      todo: [makeIssue({ status: "todo", assigneeAgentId: "agent-1", updatedAt: recentIso })],
    });

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const lostWakeCalls = calls.filter(([, , e]) => /assigned todo/i.test(e?.title ?? ""));
    expect(lostWakeCalls).toHaveLength(0);
  });

  it("does not re-alert within 24h per issue (category C)", async () => {
    const { runStuckDetector, STUCK_DETECTOR_STATE_KEY } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    const paperclip = makePaperclip({
      todo: [makeIssue({ id: "iss-t2", identifier: "ISS-T2", status: "todo", assigneeAgentId: "agent-1" })],
    });

    // Seed: already alerted 2h ago
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: STUCK_DETECTOR_STATE_KEY },
      { "todo_assigned:iss-t2": new Date(new Date(NOW_ISO).getTime() - 2 * 3_600_000).toISOString() },
    );

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const lostWakeCalls = calls.filter(([, , e]) => /assigned todo/i.test(e?.title ?? ""));
    expect(lostWakeCalls).toHaveLength(0);
  });
});
