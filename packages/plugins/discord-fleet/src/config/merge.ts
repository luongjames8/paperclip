import type { CompanyConfig, DiscordFleetConfig, SecretRef } from "./schema.js";
import { isSecretRef } from "./secrets.js";
import { validateConfig } from "./validate.js";

// Per-company map keys in the plugin config (each keyed by companyId).
const PER_COMPANY_KEYS = [
  "issuesChannelsByType",
  "approvalsChannelsByType",
  "approvalKindChannels",
  "executionStageChannelsByType",
  "approvalExpiry",
  "confirmationSweep",
] as const;

function stampRef(value: unknown, companyId: string, configPath: string): SecretRef {
  if (!isSecretRef(value)) {
    throw new Error(
      `${configPath}: expected {"type":"secret_ref","secretId":"<uuid>"} — legacy string secret refs are rejected by paperclip >= v2026.720.0`,
    );
  }
  return { type: "secret_ref", secretId: value.secretId, version: value.version, companyId, configPath };
}

// Plugin config is company-scoped (paperclip >= v2026.720.0): each company's
// row is delivered separately, and migration 0164 clones a legacy instance-wide
// config into EVERY company. A row therefore contributes ONLY its own
// company's entry and per-company map slices — a cloned multi-company map can
// never open a second bot connection or route another company's events.
// Secret refs are stamped with the row's company + their config path.
export function sliceCompanyConfig(raw: Record<string, unknown> | null | undefined, companyId: string): DiscordFleetConfig {
  const cfg = (raw ?? {}) as Partial<DiscordFleetConfig> & Record<string, unknown>;
  const companies: CompanyConfig[] = [];
  (Array.isArray(cfg.companies) ? cfg.companies : []).forEach((company, i) => {
    if (company?.companyId !== companyId) return;
    const ownToken = company.botTokenSecretRef;
    if (!ownToken && !cfg.botTokenSecretRef) {
      throw new Error(`companies.${i}: no botTokenSecretRef (company or root)`);
    }
    companies.push({
      ...company,
      paperclipApiKeySecretRef: stampRef(company.paperclipApiKeySecretRef, companyId, `companies.${i}.paperclipApiKeySecretRef`),
      botTokenSecretRef: ownToken
        ? stampRef(ownToken, companyId, `companies.${i}.botTokenSecretRef`)
        : stampRef(cfg.botTokenSecretRef, companyId, "botTokenSecretRef"),
      userMappings: company.userMappings?.map((mapping, j) => ({
        ...mapping,
        boardApiKeySecretRef: mapping.boardApiKeySecretRef
          ? stampRef(mapping.boardApiKeySecretRef, companyId, `companies.${i}.userMappings.${j}.boardApiKeySecretRef`)
          : undefined,
      })),
    });
  });
  const slice: DiscordFleetConfig = { companies };
  for (const key of PER_COMPANY_KEYS) {
    const value = (cfg[key] as Record<string, unknown> | undefined)?.[companyId];
    if (value !== undefined) (slice as unknown as Record<string, unknown>)[key] = { [companyId]: value };
  }
  validateConfig(slice);
  return slice;
}

// Effective config across every company's slice. Throws on a cross-company
// guild collision (validateConfig) so a misconfig is loud, not a silent mix.
export function mergeCompanySlices(slices: Iterable<DiscordFleetConfig>): DiscordFleetConfig {
  const merged: DiscordFleetConfig = { companies: [] };
  for (const slice of slices) {
    merged.companies.push(...slice.companies);
    for (const key of PER_COMPANY_KEYS) {
      const value = slice[key];
      if (value) {
        (merged as unknown as Record<string, unknown>)[key] = {
          ...((merged as unknown as Record<string, Record<string, unknown>>)[key] ?? {}),
          ...value,
        };
      }
    }
  }
  validateConfig(merged);
  return merged;
}
