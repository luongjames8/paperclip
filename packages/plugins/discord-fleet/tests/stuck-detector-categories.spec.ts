/**
 * Tests for CHANGE 3: stuck-detector new categories
 *   (b) blocked issues with empty/absent blockedByIssueIds
 *   (c) todo issues with an assignee older than threshold
 * Plus:
 *   (P2a) PaperclipClient.getBlockedIssues maps server blockedBy[] → blockedByIssueIds
 *   (P2c) PaperclipClient pagination sweeps beyond 200 rows
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import { PaperclipClient } from "../src/api/paperclip.js";
import type { PaperclipClient as PaperclipClientType, PaperclipIssue } from "../src/api/paperclip.js";
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
}> = {}): PaperclipClientType {
  return {
    getInProgressIssues: vi.fn().mockResolvedValue(overrides.inProgress ?? []),
    getBlockedIssues: vi.fn().mockResolvedValue(overrides.blocked ?? []),
    getAssignedTodoIssues: vi.fn().mockResolvedValue(overrides.todo ?? []),
  } as unknown as PaperclipClientType;
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

// ── P2a: PaperclipClient.getBlockedIssues — blockedBy mapping (codex P2) ─────

describe("PaperclipClient.getBlockedIssues — blockedBy → blockedByIssueIds mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRawIssue(id: string, blockedBy?: Array<{ id: string }>): Record<string, unknown> {
    return {
      id,
      identifier: `ISS-${id}`,
      title: "Test",
      status: "blocked",
      updatedAt: STALE_ISO,
      createdAt: STALE_ISO,
      ...(blockedBy !== undefined ? { blockedBy } : {}),
    };
  }

  it("passes includeBlockedBy=true to the server (codex P2a)", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => [],
    } as unknown as Response);

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "key");
    await client.getBlockedIssues("c1");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("includeBlockedBy=true"),
      expect.any(Object),
    );
  });

  it("maps blockedBy[].id to blockedByIssueIds on each issue (codex P2a)", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => [
        makeRawIssue("iss-1", [{ id: "blocker-a" }, { id: "blocker-b" }]),
        makeRawIssue("iss-2", []),
        makeRawIssue("iss-3"),  // no blockedBy key at all
      ],
    } as unknown as Response);

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "key");
    const issues = await client.getBlockedIssues("c1");

    expect(issues[0]?.blockedByIssueIds).toEqual(["blocker-a", "blocker-b"]);
    expect(issues[1]?.blockedByIssueIds).toEqual([]);
    expect(issues[2]?.blockedByIssueIds).toBeUndefined();  // absent → not mapped
  });

  it("does not alert a blocked issue whose blockedBy[] is non-empty after mapping (codex P2a)", async () => {
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(6);
    // The client mock already returns the mapped field directly
    const paperclip = makePaperclip({
      blocked: [makeIssue({ status: "blocked", blockedByIssueIds: ["real-blocker"] })],
    });

    vi.setSystemTime(new Date(NOW_ISO));
    await runStuckDetector(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const noBlockerCalls = calls.filter(([, , e]) => /no declared blockers/i.test(e?.title ?? ""));
    expect(noBlockerCalls).toHaveLength(0);
  });
});

// ── P2c: PaperclipClient pagination (codex P2) ───────────────────────────────

describe("PaperclipClient — pagination beyond 200 rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches a second page when first page returns 1000 rows (codex P2c)", async () => {
    const harness = createTestHarness({ manifest });

    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `iss-p1-${i}`,
      identifier: `ISS-P1-${i}`,
      title: "Issue",
      status: "blocked",
      updatedAt: STALE_ISO,
      createdAt: STALE_ISO,
    }));
    const page2 = [
      { id: "iss-p2-0", identifier: "ISS-P2-0", title: "Last", status: "blocked", updatedAt: STALE_ISO, createdAt: STALE_ISO },
    ];

    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch")
      .mockResolvedValueOnce({ status: 200, json: async () => page1 } as unknown as Response)
      .mockResolvedValueOnce({ status: 200, json: async () => page2 } as unknown as Response);

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "key");
    const issues = await client.getBlockedIssues("c1");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(issues).toHaveLength(1001);
    // Second call must include offset=1000
    const secondUrl = (fetchSpy.mock.calls[1]?.[0] ?? "") as string;
    expect(secondUrl).toContain("offset=1000");
  });

  it("stops at 2000 rows and logs a warning (codex P2c)", async () => {
    const harness = createTestHarness({ manifest });
    const warnSpy = vi.spyOn(harness.ctx.logger, "warn");

    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      id: `iss-${i}`,
      identifier: `ISS-${i}`,
      title: "Issue",
      status: "blocked",
      updatedAt: STALE_ISO,
      createdAt: STALE_ISO,
    }));

    vi.spyOn(harness.ctx.http, "fetch")
      .mockResolvedValue({ status: 200, json: async () => fullPage } as unknown as Response);

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "key");
    const issues = await client.getBlockedIssues("c1");

    // Should have stopped at 2000 despite each page being full
    expect(issues).toHaveLength(2000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("2000-row cap"),
      expect.any(Object),
    );
  });
});
