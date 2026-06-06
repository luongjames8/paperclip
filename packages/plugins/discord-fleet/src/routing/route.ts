import type { CompanyConfig, DiscordFleetConfig } from "../config/schema.js";

export interface RouteResult {
  guildId: string;
  channelId: string;
  companyConfig: CompanyConfig;
}

export function routeIssue(
  config: DiscordFleetConfig,
  companyId: string,
  projectId?: string,
): RouteResult {
  const company = config.companies.find((c) => c.companyId === companyId);
  if (!company) {
    throw new Error(`unknown company: ${companyId}`);
  }

  const channelId =
    projectId !== undefined && projectId in company.projectRouting
      ? company.projectRouting[projectId]
      : company.channels.orphan;

  return {
    guildId: company.guildId,
    channelId,
    companyConfig: company,
  };
}
