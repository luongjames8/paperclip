import { describe, expect, it } from "vitest";
import { mergeCompanySlices, sliceCompanyConfig } from "../src/config/merge.js";

const ref = (secretId: string) => ({ type: "secret_ref", secretId });

function company(companyId: string, guildId: string, extra: Record<string, unknown> = {}) {
  return {
    companyId,
    companyPrefix: companyId.toUpperCase(),
    guildId,
    channels: { digest: "1", errors: "2", orphan: "3" },
    projectRouting: {},
    digest: { cronExpression: "0 7 * * *", timezone: "UTC" },
    stuckIssueThresholdHours: 6,
    paperclipApiKeySecretRef: ref("api-key"),
    paperclipApiUrl: "http://paperclip:3100",
    ...extra,
  };
}

// The live hinomaru-shaped row, as migration 0164 clones it into every company.
const legacyMultiCompanyRow = {
  botTokenSecretRef: ref("root-bot"),
  companies: [
    company("hin", "111", { userMappings: [{ discordUserId: "9", paperclipUserId: "u", role: "board", boardApiKeySecretRef: ref("board-key") }] }),
    company("glo", "222", { botTokenSecretRef: ref("glo-bot") }),
  ],
  approvalKindChannels: { hin: { posts_batch: "1483486604478644354" }, glo: { posts_batch: "1483486604478644355" } },
  confirmationSweep: { hin: [{ titleRegex: "^Publisher", channelId: "1487826985630568629" }] },
};

describe("sliceCompanyConfig", () => {
  it("keeps only the row company's entry and per-company map keys", () => {
    const slice = sliceCompanyConfig(legacyMultiCompanyRow, "hin");
    expect(slice.companies.map((c) => c.companyId)).toEqual(["hin"]);
    expect(Object.keys(slice.approvalKindChannels ?? {})).toEqual(["hin"]);
    expect(Object.keys(slice.confirmationSweep ?? {})).toEqual(["hin"]);
  });

  it("a clone row for a company with no entry contributes nothing (no extra bot connection)", () => {
    const slice = sliceCompanyConfig(legacyMultiCompanyRow, "plutus");
    expect(slice.companies).toEqual([]);
    expect(slice.approvalKindChannels).toBeUndefined();
  });

  it("stamps every secret ref with the row company and the binding's config path", () => {
    const [hin] = sliceCompanyConfig(legacyMultiCompanyRow, "hin").companies;
    expect(hin!.paperclipApiKeySecretRef).toMatchObject({ companyId: "hin", configPath: "companies.0.paperclipApiKeySecretRef" });
    // No own token → the row's root token, bound at the root path.
    expect(hin!.botTokenSecretRef).toMatchObject({ secretId: "root-bot", companyId: "hin", configPath: "botTokenSecretRef" });
    expect(hin!.userMappings![0]!.boardApiKeySecretRef).toMatchObject({
      secretId: "board-key",
      configPath: "companies.0.userMappings.0.boardApiKeySecretRef",
    });
    const [glo] = sliceCompanyConfig(legacyMultiCompanyRow, "glo").companies;
    expect(glo!.botTokenSecretRef).toMatchObject({ secretId: "glo-bot", companyId: "glo", configPath: "companies.1.botTokenSecretRef" });
  });

  it("rejects legacy UUID-string secret refs (fail closed until the config is re-saved)", () => {
    const legacy = { ...legacyMultiCompanyRow, botTokenSecretRef: "fb527840-74ef-40fb-8ed5-71600056d975" };
    expect(() => sliceCompanyConfig(legacy, "hin")).toThrow(/botTokenSecretRef: expected/);
  });
});

describe("mergeCompanySlices", () => {
  it("merges slices and rejects two companies claiming one guild", () => {
    const hin = sliceCompanyConfig(legacyMultiCompanyRow, "hin");
    const glo = sliceCompanyConfig(legacyMultiCompanyRow, "glo");
    expect(mergeCompanySlices([hin, glo]).companies).toHaveLength(2);
    const clash = sliceCompanyConfig({ ...legacyMultiCompanyRow, companies: [company("glo", "111")] }, "glo");
    expect(() => mergeCompanySlices([hin, clash])).toThrow(/guild collision/);
  });
});
