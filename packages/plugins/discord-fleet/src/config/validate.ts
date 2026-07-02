import type { DiscordFleetConfig } from "./schema.js";

export const COMPANY_PREFIX_PATTERN = "^[A-Za-z0-9_-]+$";
const COMPANY_PREFIX_RE = new RegExp(COMPANY_PREFIX_PATTERN);

// Nested-quantifier heuristic: rejects the classic catastrophic-backtracking
// shapes ((a+)+, (a*)+, (a|aa)+ style groups followed by a quantifier) at
// config-load time, where the operator gets immediate feedback — instead of a
// pathological pattern synchronously pinning the event loop mid-sweep.
const NESTED_QUANTIFIER_RE = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/;
const SNOWFLAKE_RE = /^\d{17,20}$/;

function validateOperatorRegex(pattern: string, where: string): void {
  try {
    new RegExp(pattern);
  } catch (err) {
    throw new Error(`${where}: invalid titleRegex "${pattern}" — ${String(err)}`);
  }
  if (NESTED_QUANTIFIER_RE.test(pattern)) {
    throw new Error(`${where}: titleRegex "${pattern}" contains a nested quantifier (catastrophic-backtracking risk) — rewrite it without a quantified group under a quantifier`);
  }
}

export function validateConfig(config: DiscordFleetConfig): void {
  // Validate the sweep-rule config keys (approvalExpiry, confirmationSweep) at
  // load time: compile every operator regex, screen for ReDoS shapes, and
  // bound-check the numeric/channel fields, so misconfiguration fails fast and
  // visibly instead of at the first sweep run.
  for (const [companyId, rules] of Object.entries(config.approvalExpiry ?? {})) {
    for (const rule of rules) {
      validateOperatorRegex(rule.titleRegex, `approvalExpiry[${companyId}]`);
      if (!(rule.maxAgeHours >= 1)) {
        throw new Error(`approvalExpiry[${companyId}]: maxAgeHours must be >= 1 (got ${rule.maxAgeHours}) — 0 would auto-reject every matching approval instantly`);
      }
    }
  }
  for (const [companyId, rules] of Object.entries(config.confirmationSweep ?? {})) {
    for (const rule of rules) {
      validateOperatorRegex(rule.titleRegex, `confirmationSweep[${companyId}]`);
      if (!SNOWFLAKE_RE.test(rule.channelId)) {
        throw new Error(`confirmationSweep[${companyId}]: channelId "${rule.channelId}" is not a Discord snowflake`);
      }
    }
  }

  const seenGuilds = new Map<string, string>();
  for (const company of config.companies) {
    if (!company.companyPrefix || !company.companyPrefix.trim()) {
      throw new Error(`companyPrefix must be a non-empty string for company ${company.companyId}`);
    }
    if (!COMPANY_PREFIX_RE.test(company.companyPrefix)) {
      throw new Error(`companyPrefix must match ${COMPANY_PREFIX_PATTERN} for company ${company.companyId} (got "${company.companyPrefix}")`);
    }
    if (company.stuckIssueThresholdHours < 1) {
      throw new Error(`stuckIssueThresholdHours must be ≥ 1 for company ${company.companyId} (got ${company.stuckIssueThresholdHours})`);
    }
    const existing = seenGuilds.get(company.guildId);
    if (existing) {
      throw new Error(
        `guild collision: companies ${existing} and ${company.companyId} both reference guild ${company.guildId} — each guildId must be unique across companies`,
      );
    }
    seenGuilds.set(company.guildId, company.companyId);
  }
}
