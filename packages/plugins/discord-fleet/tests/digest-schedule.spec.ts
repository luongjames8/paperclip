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

// Asia/Taipei is UTC+8. Cron: "0 7 * * *" (07:00 Taipei each day).
//
// Jan 15 07:00 Taipei = Jan 14 23:00 UTC
const SLOT_JAN15_0700 = "2025-01-14T23:00:00.000Z";
// Jan 14 22:59 UTC = Jan 15 06:59 Taipei (1 min before scheduled)
const NOW_0659_TAIPEI = new Date(Date.UTC(2025, 0, 14, 22, 59, 0));
// Jan 14 23:01 UTC = Jan 15 07:01 Taipei (1 min after scheduled)
const NOW_0701_TAIPEI = new Date(Date.UTC(2025, 0, 14, 23, 1, 0));
// Jan 15 00:00 UTC = Jan 15 08:00 Taipei
const NOW_0800_TAIPEI = new Date(Date.UTC(2025, 0, 15, 0, 0, 0));

// Apr 26 2026 scenarios:
// Apr 26 07:00 Taipei = Apr 25 23:00 UTC
const SLOT_APR26_0700 = "2026-04-25T23:00:00.000Z";
// Apr 25 23:10 UTC = Apr 26 07:10 Taipei (within 15-min window)
const NOW_0710_TAIPEI_APR26 = new Date(Date.UTC(2026, 3, 25, 23, 10, 0));
// Apr 25 19:00 UTC = Apr 26 03:00 Taipei (outside window)
const NOW_0300_TAIPEI_APR26 = new Date(Date.UTC(2026, 3, 25, 19, 0, 0));
// Apr 26 05:00 UTC = Apr 26 13:00 Taipei (missed-fire scenario)
const NOW_1300_TAIPEI_APR26 = new Date(Date.UTC(2026, 3, 26, 5, 0, 0));
// Apr 23 23:00 UTC = Apr 24 07:00 Taipei (stale last-fire, 2 days ago)
const LAST_FIRE_APR24 = "2026-04-23T23:00:00.000Z";

function makeCompanyConfig(): CompanyConfig {
  return {
    companyId: "c1",
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

function makeMockPaperclip(): PaperclipClient {
  return {
    getErrorsLast24h: vi.fn().mockResolvedValue([]),
    getInProgressIssues: vi.fn().mockResolvedValue([]),
    getRoutines: vi.fn().mockResolvedValue([]),
    getIssueById: vi.fn().mockResolvedValue(null),
  } as unknown as PaperclipClient;
}

describe("digest timezone scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT fire at 06:59 Taipei (before scheduled hour)", async () => {
    const { runDigest } = await import("../src/jobs/digest.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });

    await runDigest(harness.ctx, "c1", makeMockClient(), makeCompanyConfig(), makeMockPaperclip(), NOW_0659_TAIPEI);

    expect(postToChannel).not.toHaveBeenCalled();

    // State must remain null — skipping must not write a fire timestamp
    const lastFire = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: "last-digest-fire",
    });
    expect(lastFire).toBeNull();
  });

  it("fires at 07:01 Taipei and stamps the 07:00 scheduled slot (not wall time)", async () => {
    const { runDigest } = await import("../src/jobs/digest.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });

    await runDigest(harness.ctx, "c1", makeMockClient(), makeCompanyConfig(), makeMockPaperclip(), NOW_0701_TAIPEI);

    expect(postToChannel).toHaveBeenCalledTimes(1);

    const lastFire = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: "last-digest-fire",
    });
    // Must stamp the 07:00 slot time, not when the handler ran (07:01)
    expect(lastFire).toEqual(SLOT_JAN15_0700);
  });

  it("does NOT fire again at 08:00 Taipei if already fired at the 07:00 slot today", async () => {
    const { runDigest } = await import("../src/jobs/digest.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });

    // Simulate that digest already fired — state has the slot timestamp
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: "last-digest-fire" },
      SLOT_JAN15_0700,
    );

    await runDigest(harness.ctx, "c1", makeMockClient(), makeCompanyConfig(), makeMockPaperclip(), NOW_0800_TAIPEI);

    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("fires exactly once after multi-day outage (missed-fire: last=Apr24, now=Apr26 13:00)", async () => {
    const { runDigest } = await import("../src/jobs/digest.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });

    // Simulate last fire was Apr 24 07:00 Taipei (2 days ago)
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: "last-digest-fire" },
      LAST_FIRE_APR24,
    );

    await runDigest(harness.ctx, "c1", makeMockClient(), makeCompanyConfig(), makeMockPaperclip(), NOW_1300_TAIPEI_APR26);

    // Fires once — does NOT replay Apr 25, fires only for Apr 26 slot
    expect(postToChannel).toHaveBeenCalledTimes(1);

    const lastFire = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: "last-digest-fire",
    });
    // Must stamp Apr 26 07:00 slot, not the current wall time (13:00)
    expect(lastFire).toEqual(SLOT_APR26_0700);
  });

  it("first-ever fire outside window (03:00 Taipei) → skips, state stays null", async () => {
    const { runDigest } = await import("../src/jobs/digest.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });

    await runDigest(harness.ctx, "c1", makeMockClient(), makeCompanyConfig(), makeMockPaperclip(), NOW_0300_TAIPEI_APR26);

    expect(postToChannel).not.toHaveBeenCalled();

    const lastFire = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: "last-digest-fire",
    });
    expect(lastFire).toBeNull();
  });

  it("first-ever fire inside 15-min window (07:10 Taipei) → fires, stamps 07:00 slot", async () => {
    const { runDigest } = await import("../src/jobs/digest.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });

    await runDigest(harness.ctx, "c1", makeMockClient(), makeCompanyConfig(), makeMockPaperclip(), NOW_0710_TAIPEI_APR26);

    expect(postToChannel).toHaveBeenCalledTimes(1);

    const lastFire = await harness.ctx.state.get({
      scopeKind: "company",
      scopeId: "c1",
      stateKey: "last-digest-fire",
    });
    // Must stamp the 07:00 slot, not 07:10 wall time
    expect(lastFire).toEqual(SLOT_APR26_0700);
  });
});
