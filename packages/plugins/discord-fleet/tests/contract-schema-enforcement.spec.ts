/**
 * Layer: contract + invariant
 * Assertion type: semantic invariant — companyPrefix must be enforced at two layers:
 *   (1) JSON Schema in manifest.ts — rejects at install time via validateInstanceConfig
 *   (2) validateConfig() at runtime startup — rejects empty/whitespace/undefined
 * Mutation result: remove companyPrefix from manifest required[] OR remove validateConfig check → tests RED
 *
 * AC coverage: AC5, AC6, AC9 (Smell 5 — legacy cohort fail-closed)
 *
 * Defense-in-depth rationale: P0-4 showed that an existing install row can arrive at
 * approval-created.ts:65 with companyPrefix=undefined, producing /undefined/approvals/<id>
 * silently. These two layers are the gate — both must hold independently.
 */

import { describe, it, expect } from "vitest";
import manifest from "../src/manifest.js";
import { validateConfig, COMPANY_PREFIX_PATTERN } from "../src/config/validate.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFullConfig(companyPrefixOverride?: unknown): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        companyPrefix: companyPrefixOverride as string,
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://100.98.95.12:3100",
      },
    ],
  };
}

function makeConfigMissingPrefix(): DiscordFleetConfig {
  // Simulates a DB row from before companyPrefix existed — field entirely absent
  const company = {
    companyId: "c-legacy",
    guildId: "g-legacy",
    channels: { digest: "d1", errors: "e1", orphan: "o1" },
    projectRouting: {},
    digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
    stuckIssueThresholdHours: 6,
    paperclipApiKeySecretRef: "ref",
    paperclipApiUrl: "http://100.98.95.12:3100",
  };
  return { botTokenSecretRef: "bot-ref", companies: [company] } as unknown as DiscordFleetConfig;
}

// ── manifest JSON Schema enforcement (AC5) ───────────────────────────────────

describe("manifest JSON Schema — companyPrefix must be required with minLength 1 (AC5)", () => {
  it("company items schema has companyPrefix in required array", () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant — JSON Schema must gate install-time config
     * Call site pinned: src/manifest.ts:43 (required array for company items)
     * Mutation result: remove companyPrefix from required[] → test RED (validateInstanceConfig accepts missing field)
     */
    expect(manifest.instanceConfigSchema, "manifest must define instanceConfigSchema").toBeDefined();
    const schema = manifest.instanceConfigSchema!;
    const companiesSchema = (schema.properties as Record<string, unknown>)
      ?.companies as { items?: { required?: string[] } } | undefined;

    expect(
      companiesSchema?.items?.required,
      "companies[].required must exist in manifest instanceConfigSchema",
    ).toBeDefined();
    expect(
      companiesSchema?.items?.required,
      "companyPrefix must appear in manifest companies[].required — absent field means install proceeds without it",
    ).toContain("companyPrefix");
  });

  it("company items schema has companyPrefix property with type string and minLength 1", () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant — JSON Schema must also have the property defined
     * Call site pinned: src/manifest.ts:43 (properties for company items)
     * Mutation result: omit companyPrefix from properties → test RED
     */
    expect(manifest.instanceConfigSchema, "manifest must define instanceConfigSchema").toBeDefined();
    const schema = manifest.instanceConfigSchema!;
    const companiesSchema = (schema.properties as Record<string, unknown>)
      ?.companies as {
      items?: { properties?: Record<string, { type?: string; minLength?: number }> };
    };

    const prefixSchema = companiesSchema?.items?.properties?.companyPrefix;
    expect(
      prefixSchema,
      "companies[].properties.companyPrefix must be defined in manifest",
    ).toBeDefined();
    expect(prefixSchema?.type).toBe("string");
    expect(
      (prefixSchema?.minLength ?? 0) >= 1,
      `companyPrefix schema must have minLength >= 1 (got ${prefixSchema?.minLength}) — empty string must be rejected at install`,
    ).toBe(true);
  });

  it("company items schema has companyPrefix property with pattern rejecting path-unsafe chars (P1-4)", () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant — manifest must reject path-unsafe companyPrefix at install time
     * Call site pinned: src/manifest.ts:46 (companyPrefix property definition)
     * Mutation result: omit pattern from manifest → test RED; space/slash/?/# chars accepted at install
     *
     * Aligns with validateConfig regex — both layers must enforce the same character constraint.
     */
    expect(manifest.instanceConfigSchema, "manifest must define instanceConfigSchema").toBeDefined();
    const schema = manifest.instanceConfigSchema!;
    const companiesSchema = (schema.properties as Record<string, unknown>)
      ?.companies as {
      items?: { properties?: Record<string, { type?: string; minLength?: number; pattern?: string }> };
    };

    const prefixSchema = companiesSchema?.items?.properties?.companyPrefix;
    expect(
      prefixSchema,
      "companies[].properties.companyPrefix must be defined in manifest",
    ).toBeDefined();
    expect(
      prefixSchema?.pattern,
      "companyPrefix must have a pattern constraint to reject path-unsafe chars",
    ).toBeDefined();

    // Full-equality check: pattern must be the source-of-truth value including both ^ and $ anchors.
    // A missing $ allows JSON Schema to accept "HIN/foo" (^[A-Za-z0-9_-]+ matches "HIN" prefix only).
    // Mutation result: remove $ from COMPANY_PREFIX_PATTERN → toBe fails → RED
    expect(
      prefixSchema?.pattern,
      `manifest pattern must equal COMPANY_PREFIX_PATTERN exactly — missing $ anchor lets "HIN/foo" pass JSON Schema`,
    ).toBe(COMPANY_PREFIX_PATTERN);

    // Functional verification: the pattern must reject known path-unsafe values in all JS regex engines.
    // Mutation result: pattern without $ → re.test("HIN/foo") returns true → toBe(false) fails → RED
    const re = new RegExp(prefixSchema!.pattern!);
    expect(re.test("HIN"), "valid prefix must match pattern").toBe(true);
    expect(re.test("HIN/foo"), "slash injection: pattern must not match entire string").toBe(false);
    expect(re.test("HIN?bar"), "query injection: pattern must not match entire string").toBe(false);
    expect(re.test("h i n"), "space: pattern must not match entire string").toBe(false);
  });
});

// ── validateConfig() runtime enforcement (AC6) ───────────────────────────────

describe("validateConfig — rejects empty, whitespace, and missing companyPrefix (AC6)", () => {
  it("throws when companyPrefix is empty string", () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant
     * Call site pinned: src/config/validate.ts (validateConfig body — no current check)
     * Mutation result: remove companyPrefix check from validateConfig → test RED (no throw)
     */
    expect(() => validateConfig(makeFullConfig(""))).toThrow(/companyPrefix/);
  });

  it("throws when companyPrefix is whitespace only", () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant
     * Call site pinned: src/config/validate.ts
     * Mutation result: remove check → test RED
     */
    expect(() => validateConfig(makeFullConfig("   "))).toThrow(/companyPrefix/);
  });

  it("throws when companyPrefix is undefined (legacy DB row cast)", () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant — legacy cohort (Smell 5)
     * Call site pinned: src/config/validate.ts
     * Mutation result: remove check → test RED; URL becomes /undefined/approvals/<id> silently
     */
    expect(() => validateConfig(makeFullConfig(undefined))).toThrow(/companyPrefix/);
  });

  it("throws when companyPrefix key is entirely absent from company entry (AC9 — legacy cohort)", () => {
    /**
     * Layer: invariant (tripwire-tier)
     * Assertion type: semantic invariant — DB row predating this field must not load silently
     * Call site pinned: src/config/validate.ts
     * Mutation result: remove check → test RED; plugin loads and emits /undefined/ URLs
     */
    expect(() => validateConfig(makeConfigMissingPrefix())).toThrow(/companyPrefix/);
  });

  it("accepts valid companyPrefix — does not throw for a well-formed value", () => {
    /**
     * Layer: contract
     * Assertion type: positive guard — ensures we do not over-validate
     * Call site pinned: src/config/validate.ts
     * Mutation result: over-strict check → test RED
     */
    expect(() => validateConfig(makeFullConfig("HIN"))).not.toThrow();
  });

  it("accepts lowercase companyPrefix (board normalizes to uppercase on comparison)", () => {
    /**
     * Layer: contract
     * Assertion type: positive guard
     * Note: App.tsx:205 does companyPrefix.toUpperCase() on board side — plugin need not enforce case.
     * Call site pinned: src/config/validate.ts
     * Mutation result: over-strict uppercase check → test RED for legitimate lowercase prefix
     */
    expect(() => validateConfig(makeFullConfig("hin"))).not.toThrow();
  });
});

// ── validateConfig() — path-unsafe companyPrefix rejection (P1-2) ─────────────

describe("validateConfig — rejects path-unsafe companyPrefix values (P1-2)", () => {
  it.each([
    { value: "h i n", label: "space in middle" },
    { value: "HIN EXTRA", label: "space — two words" },
    { value: "HIN/EXTRA", label: "forward slash (extra path segment injected)" },
    { value: "../foo", label: "path traversal (../)" },
    { value: "HIN?foo=bar", label: "query string injection (?)" },
    { value: "HIN#section", label: "fragment injection (#)" },
    { value: "HIN ", label: "trailing space" },
  ])("throws for path-unsafe value: $label ($value)", ({ value }) => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant — each of these chars produces a broken/dangerous URL
     * Call site pinned: src/config/validate.ts (validateConfig body — needs regex, currently only .trim())
     * Mutation result: remove regex check → test RED (path-unsafe values pass current .trim() guard)
     *
     * Impact examples:
     *   "h i n"     → /h i n/issues/id      invalid URL path; browser won't navigate
     *   "HIN/EXTRA" → /HIN/EXTRA/issues/id   extra path segment; router sees wrong prefix
     *   "HIN?foo"   → /HIN?foo=/issues/id    query param injection; issue ID lost
     *   "HIN#x"     → /HIN#x/issues/id       fragment injection; issue ID never sent to server
     */
    expect(() => validateConfig(makeFullConfig(value))).toThrow(/companyPrefix/);
  });

  it("accepts companyPrefix with hyphen (HIN-99) — hyphen is valid in URL paths", () => {
    /**
     * Layer: contract
     * Assertion type: positive guard — hyphen must not be over-rejected
     * Call site pinned: src/config/validate.ts
     * Mutation result: over-strict regex rejects hyphen → test RED for valid use case
     */
    expect(() => validateConfig(makeFullConfig("HIN-99"))).not.toThrow();
  });

  it("accepts companyPrefix with underscore (my_prefix) — underscore is valid in URL paths", () => {
    /**
     * Layer: contract
     * Assertion type: positive guard — underscore must not be over-rejected
     * Call site pinned: src/config/validate.ts
     * Mutation result: over-strict regex rejects underscore → test RED for valid use case
     */
    expect(() => validateConfig(makeFullConfig("my_prefix"))).not.toThrow();
  });
});
