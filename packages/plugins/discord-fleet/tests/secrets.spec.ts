import { describe, it, expect } from "vitest";
import { stripSecrets } from "../src/render/secrets.js";

describe("stripSecrets", () => {
  it("masks Paperclip API key", () => {
    const secret = "pcp_e9461c385d1efd69a4a76ec23ef5eecd955f86531f232b24";
    const result = stripSecrets(`token=${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("PAPERCLIP_KEY_***");
  });

  it("masks GitHub PAT classic", () => {
    const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const result = stripSecrets(`Authorization: Bearer ${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("GITHUB_PAT_***");
  });

  it("masks GitHub PAT new format", () => {
    const secret = "github_pat_FAKE_GITHUB_NEW_TOKEN_FORMAT_AT_LEAST_eighty_chars_longpadding";
    const result = stripSecrets(`token=${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("GITHUB_PAT_NEW_***");
  });

  it("masks Discord bot token", () => {
    // Pattern-matching fake (NOT a real Discord token) — see GitHub
    // secret-scanning push protection. The masker regex requires
    // 20+ . 6 . 27+ chars; this string fits the pattern without
    // resembling a real bot token.
    const secret = "FAKE_FAKE_FAKE_FAKE_FAKE.FAKE12.PLACEHOLDER_PLACEHOLDER_PLACEHOLDER";
    const result = stripSecrets(`bot token: ${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("DISCORD_BOT_TOKEN_***");
  });

  it("masks AWS access key ID", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const result = stripSecrets(`AWS_ACCESS_KEY_ID=${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("AWS_ACCESS_KEY_***");
  });

  it("masks Slack bot token", () => {
    const secret = "xoxb-FAKE-SLACK-BOT-token-1234567890123456789012345678901234567890";
    const result = stripSecrets(`slack_token=${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("SLACK_BOT_TOKEN_***");
  });

  it("masks Bailian sk-cp- key", () => {
    const secret = "sk-cp-FAKE_BAILIAN_KEY_at_least_thirty_chars_long_to_match";
    const result = stripSecrets(`api_key=${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("BAILIAN_KEY_***");
  });

  it("masks Bailian sk-sp- key", () => {
    const secret = "sk-sp-FAKE_BAILIAN_KEY_at_least_thirty_chars_long_to_match";
    const result = stripSecrets(`api_key=${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("BAILIAN_KEY_***");
  });
});
