export interface UserMapping {
  discordUserId: string;
  paperclipUserId: string;
  role: string;
  boardApiKeySecretRef?: string;
}

export interface CompanyChannels {
  digest: string;
  errors: string;
  orphan: string;
}

export interface DigestConfig {
  cronExpression: string;
  timezone: string;
}

export interface CompanyConfig {
  companyId: string;
  companyPrefix: string;
  guildId: string;
  channels: CompanyChannels;
  projectRouting: Record<string, string>;
  userMappings?: UserMapping[];
  digest: DigestConfig;
  stuckIssueThresholdHours: number;
  costEventThresholdCents?: number;
  paperclipApiKeySecretRef: string;
  paperclipApiUrl: string;
}

export interface DiscordFleetConfig {
  botTokenSecretRef: string;
  companies: CompanyConfig[];
}

export const DEFAULT_DIGEST: DigestConfig = {
  cronExpression: "0 7 * * *",
  timezone: "Asia/Taipei",
};
