import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { COMPANY_PREFIX_PATTERN } from "./config/validate.js";

const JOB_KEYS = {
  digest: "discord-fleet.digest",
  stuckDetector: "discord-fleet.stuck-detector",
  routineHealth: "discord-fleet.routine-health",
  approvalsReminder: "discord-fleet.approvals-reminder",
  confirmationSweep: "discord-fleet.confirmation-sweep",
} as const;

export { JOB_KEYS };

const manifest: PaperclipPluginManifestV1 = {
  id: "openclaw.discord-fleet",
  apiVersion: 1,
  version: "0.2.0",
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
      issuesChannelsByType: {
        type: "object",
        title: "Issues Channels By Type",
        description: "Per-companyId map of [regex, channelId] pairs. Matches seed-issue routine_slug / identifier / title; first match wins. Bypasses projectRouting.",
        additionalProperties: {
          type: "array",
          items: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "string" },
          },
        },
      },
      approvalsChannelsByType: {
        type: "object",
        title: "Approvals Channels By Type (deprecated)",
        description: "DEPRECATED — superseded by approvalKindChannels. Per-companyId map of [regex, channelId] pairs matched against the legacy payload.approvalType/title. Tried only after approvalKindChannels finds no match; kept for backward compat until every company's routines carry approvalKind.",
        additionalProperties: {
          type: "array",
          items: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "string" },
          },
        },
      },
      approvalKindChannels: {
        type: "object",
        title: "Approval Kind Channels",
        description: "Per-companyId exact map of approvalKind -> channelId. approvalKind is engine-typed and config-inherited (declared once on the routine, stamped down the issue chain) — this is a plain lookup, not a regex. Tried first, ahead of approvalsChannelsByType and work-thread co-location.",
        additionalProperties: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      executionStageChannelsByType: {
        type: "object",
        title: "Execution Stage Channels By Type",
        description: "Per-companyId map of [regex, channelId] pairs. Matches executionPolicy review/approval stage cards against issue identifier/title; first match wins. Falls back to projectRouting / channels.orphan.",
        additionalProperties: {
          type: "array",
          items: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "string" },
          },
        },
      },
      approvalExpiry: {
        type: "object",
        title: "Approval Expiry Rules",
        description: "Per-companyId list of auto-expiry rules. In the approvals-reminder sweep, pending approvals whose title matches a rule's titleRegex and whose age exceeds maxAgeHours are auto-rejected. Requires paperclipApiKeySecretRef to be a board key (403 otherwise — logged).",
        additionalProperties: {
          type: "array",
          items: {
            type: "object",
            required: ["titleRegex", "maxAgeHours"],
            properties: {
              titleRegex: { type: "string", title: "Title Regex", description: "Regex matched against the approval's title." },
              maxAgeHours: { type: "number", title: "Max Age Hours", description: "Age in hours after which the approval is auto-rejected." },
            },
          },
        },
      },
      confirmationSweep: {
        type: "object",
        title: "Confirmation Sweep",
        description: "Per-companyId list of rules. Sweeps backlog/todo issues for pending request_confirmation interactions and posts them to Discord. Re-posts at most every 24h per interaction.",
        additionalProperties: {
          type: "array",
          items: {
            type: "object",
            required: ["titleRegex", "channelId"],
            properties: {
              titleRegex: { type: "string", title: "Title Regex", description: "Regex matched against the issue title." },
              channelId: { type: "string", title: "Channel ID", description: "Discord channel ID to post the confirmation card into." },
              carouselBatch: {
                type: "boolean",
                title: "Carousel Batch",
                description: "Marks this rule as gating a carousel-batch publish decision, so an interaction matching neither the structured payload contract nor the legacy section-heading shape still degrades to an images-included render instead of falling through to the generic image-stripping path. Default false.",
                default: false,
              },
            },
          },
        },
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
            botTokenSecretRef: {
              type: "string",
              title: "Discord Bot Token Secret Ref (per-company)",
              description: "Optional. Secret ref for THIS company's own Discord bot. When set, this company uses its own bot instead of the root botTokenSecretRef (companies sharing a token share one connection). Leave empty to use the root bot.",
            },
            paperclipApiKeySecretRef: { type: "string", title: "Paperclip API Key Secret Ref" },
            paperclipApiUrl: { type: "string", title: "Paperclip API Base URL", default: "http://localhost:3000" },
            approvalFallbackChannelId: {
              type: "string",
              title: "Approval Fallback Channel ID",
              description: "Per-company destination for approvals with no approvalsChannelsByType match and no co-locatable work-thread. Defaults to channels.orphan when absent.",
            },
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
    {
      jobKey: JOB_KEYS.approvalsReminder,
      displayName: "Pending Approvals Reminder",
      description: "Re-posts actionable cards for pending approvals (from the Paperclip API) until they are decided.",
      schedule: "*/30 * * * *",
    },
    {
      jobKey: JOB_KEYS.confirmationSweep,
      displayName: "Confirmation Sweep",
      description: "Sweeps backlog/todo issues for pending request_confirmation interactions and posts them to Discord for visibility. Re-posts at most every 24h per interaction.",
      schedule: "*/30 * * * *",
    },
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
