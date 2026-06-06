import type { DiscordFleetConfig } from "./schema.js";

export const COMPANY_PREFIX_PATTERN = "^[A-Za-z0-9_-]+$";
const COMPANY_PREFIX_RE = new RegExp(COMPANY_PREFIX_PATTERN);

export function validateConfig(config: DiscordFleetConfig): void {
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
