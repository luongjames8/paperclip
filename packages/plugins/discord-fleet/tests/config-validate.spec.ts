import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/validate.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";

// Fleet issue #687: approvalKindChannels validation. Base fixture mirrors the
// makeConfig() helper other test files use — one valid company, nothing else
// configured — so each test only needs to add the field under test.
function baseConfig(): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        companyPrefix: "tc1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
      },
    ],
  };
}

const SNOWFLAKE = "123456789012345678";

describe("validateConfig — approvalKindChannels (fleet issue #687)", () => {
  it("accepts a well-formed kind -> snowflake channelId map", () => {
    const config = baseConfig();
    config.approvalKindChannels = { c1: { content_batch_approval: SNOWFLAKE } };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("accepts an absent approvalKindChannels field (backward compat — nothing configured yet)", () => {
    expect(() => validateConfig(baseConfig())).not.toThrow();
  });

  it("accepts an empty inner map for a company", () => {
    const config = baseConfig();
    config.approvalKindChannels = { c1: {} };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("rejects an uppercase kind", () => {
    const config = baseConfig();
    config.approvalKindChannels = { c1: { Content_Batch: SNOWFLAKE } };
    expect(() => validateConfig(config)).toThrow(/not a lowercase snake_case identifier/);
  });

  it("rejects a kind with spaces or punctuation", () => {
    const config = baseConfig();
    config.approvalKindChannels = { c1: { "content-batch": SNOWFLAKE } };
    expect(() => validateConfig(config)).toThrow(/not a lowercase snake_case identifier/);
  });

  it("rejects a channelId that is not a Discord snowflake", () => {
    const config = baseConfig();
    config.approvalKindChannels = { c1: { content_batch_approval: "not-a-channel-id" } };
    expect(() => validateConfig(config)).toThrow(/not a Discord snowflake/);
  });

  it("accepts a companyId key with no matching entry in config.companies (matches existing approvalExpiry/confirmationSweep precedent — dead config, not an error)", () => {
    const config = baseConfig();
    config.approvalKindChannels = { "no-such-company": { content_batch_approval: SNOWFLAKE } };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("validates every company independently — one bad entry doesn't skip others (both must throw)", () => {
    const config = baseConfig();
    config.companies.push({
      companyId: "c2",
      companyPrefix: "tc2",
      guildId: "g2",
      channels: { digest: "d2", errors: "e2", orphan: "o2" },
      projectRouting: {},
      digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
      stuckIssueThresholdHours: 6,
      paperclipApiKeySecretRef: "ref2",
      paperclipApiUrl: "http://localhost:3000",
    });
    config.approvalKindChannels = {
      c1: { good_kind: SNOWFLAKE },
      c2: { BAD_KIND: SNOWFLAKE },
    };
    expect(() => validateConfig(config)).toThrow(/not a lowercase snake_case identifier/);
  });
});
