import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { COMPANY_PREFIX_PATTERN } from "./config/validate.js";

const JOB_KEYS = {
  digest: "discord-fleet.digest",
  stuckDetector: "discord-fleet.stuck-detector",
  routineHealth: "discord-fleet.routine-health",
} as const;

export { JOB_KEYS };

const manifest: PaperclipPluginManifestV1 = {
  id: "openclaw.discord-fleet",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Discord Fleet",
  description: "Routes Paperclip issue and approval events to per-company Discord channels.",
  author: "openclaw",
  categories: ["connector"],
  capabilities: [
    "events.subscribe",
    "jobs.schedule",
    "plugin.state.read",
    "plugin.state.write",
    "http.outbound",
    "secrets.read-ref",
    "metrics.write",
  ],
  instanceConfigSchema: {
    type: "object",
    required: ["botTokenSecretRef", "companies"],
    properties: {
      botTokenSecretRef: {
        type: "string",
        title: "Bot Token Secret Ref",
        description: "Paperclip secret reference for the Discord bot token (e.g. paperclip-discord/bot-token)",
        default: "paperclip-discord/bot-token",
      },
      companies: {
        type: "array",
        title: "Companies",
        items: {
          type: "object",
          required: ["companyId", "companyPrefix", "guildId", "channels", "projectRouting", "digest", "stuckIssueThresholdHours", "paperclipApiKeySecretRef", "paperclipApiUrl"],
          properties: {
            companyId: { type: "string", title: "Company ID" },
            companyPrefix: { type: "string", title: "Company Prefix", minLength: 1, pattern: COMPANY_PREFIX_PATTERN },
            guildId: { type: "string", title: "Discord Guild ID" },
            channels: {
              type: "object",
              required: ["digest", "errors", "orphan"],
              properties: {
                digest: { type: "string", title: "Digest Channel ID" },
                errors: { type: "string", title: "Errors Channel ID" },
                orphan: { type: "string", title: "Orphan Channel ID" },
              },
            },
            projectRouting: {
              type: "object",
              title: "Project Routing",
              description: "Map of projectId → channelId for per-project monitor channels",
              additionalProperties: { type: "string" },
            },
            userMappings: {
              type: "array",
              title: "User Mappings",
              items: {
                type: "object",
                properties: {
                  discordUserId: { type: "string" },
                  paperclipUserId: { type: "string" },
                  role: { type: "string" },
                  boardApiKeySecretRef: { type: "string" },
                },
              },
            },
            digest: {
              type: "object",
              properties: {
                cronExpression: { type: "string", default: "0 7 * * *" },
                timezone: { type: "string", default: "Asia/Taipei" },
              },
            },
            stuckIssueThresholdHours: { type: "number", default: 6, minimum: 1 },
            costEventThresholdCents: { type: "number" },
            paperclipApiKeySecretRef: { type: "string", title: "Paperclip API Key Secret Ref" },
            paperclipApiUrl: { type: "string", title: "Paperclip API Base URL", default: "http://localhost:3000" },
          },
        },
      },
    },
  },
  jobs: [
    {
      jobKey: JOB_KEYS.digest,
      displayName: "Daily Digest",
      // Fires every 15 min (UTC). The handler checks company timezone to decide if it should post.
      description: "Posts daily pending-approvals and error summary per company at configured timezone hour.",
      schedule: "*/15 * * * *",
    },
    {
      jobKey: JOB_KEYS.stuckDetector,
      displayName: "Stuck Issue Detector",
      description: "Flags in-progress issues exceeding stuckIssueThresholdHours.",
      schedule: "*/30 * * * *",
    },
    {
      jobKey: JOB_KEYS.routineHealth,
      displayName: "Routine Health Monitor",
      description: "Flags routines that have not fired within their expected window.",
      schedule: "*/30 * * * *",
    },
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
