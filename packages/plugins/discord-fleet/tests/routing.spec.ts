import { describe, it, expect } from "vitest";
import { routeIssue } from "../src/routing/route.js";
import { validateConfig } from "../src/config/validate.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";

function makeConfig(): DiscordFleetConfig {
  return {
    botTokenSecretRef: "discord/bot-token",
    companies: [
      {
        companyId: "company-1",
        guildId: "guild-1",
        channels: { digest: "channel-digest", errors: "channel-errors", orphan: "channel-orphan" },
        projectRouting: { "proj-1": "channel-monitor" },
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "paperclip/api-key",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
    ],
  };
}

describe("routeIssue and validateConfig", () => {
  it("routes to projectRouting channel when projectId is mapped", () => {
    const config = makeConfig();
    const result = routeIssue(config, "company-1", "proj-1");
    expect(result.channelId).toBe("channel-monitor");
  });

  it("routes to orphan channel when projectId is not in routing", () => {
    const config = makeConfig();
    const result = routeIssue(config, "company-1", "unknown-proj");
    expect(result.channelId).toBe("channel-orphan");
  });

  it("routes to orphan channel when projectId is undefined", () => {
    const config = makeConfig();
    const result = routeIssue(config, "company-1", undefined);
    expect(result.channelId).toBe("channel-orphan");
  });

  it("throws when companyId is unknown", () => {
    const config = makeConfig();
    expect(() => routeIssue(config, "nonexistent")).toThrow("unknown company: nonexistent");
  });

  it("validateConfig throws on guild collision", () => {
    const config: DiscordFleetConfig = {
      botTokenSecretRef: "discord/bot-token",
      companies: [
        {
          companyId: "company-A",
          guildId: "shared-guild",
          channels: { digest: "d1", errors: "e1", orphan: "o1" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref-a",
          paperclipApiUrl: "http://localhost:3000",
          companyPrefix: "tca",
        },
        {
          companyId: "company-B",
          guildId: "shared-guild",
          channels: { digest: "d2", errors: "e2", orphan: "o2" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref-b",
          paperclipApiUrl: "http://localhost:3000",
          companyPrefix: "tcb",
        },
      ],
    };
    expect(() => validateConfig(config)).toThrow(
      /guild collision: companies company-A and company-B both reference guild shared-guild/,
    );
  });

  it("validateConfig does not throw when guilds are distinct", () => {
    const config: DiscordFleetConfig = {
      botTokenSecretRef: "discord/bot-token",
      companies: [
        {
          companyId: "company-A",
          guildId: "guild-A",
          channels: { digest: "d1", errors: "e1", orphan: "o1" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref-a",
          paperclipApiUrl: "http://localhost:3000",
          companyPrefix: "tca",
        },
        {
          companyId: "company-B",
          guildId: "guild-B",
          channels: { digest: "d2", errors: "e2", orphan: "o2" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "ref-b",
          paperclipApiUrl: "http://localhost:3000",
          companyPrefix: "tcb",
        },
      ],
    };
    expect(() => validateConfig(config)).not.toThrow();
  });
});
