import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "openclaw.plugin-helper-runner",
  apiVersion: 1,
  version: "0.4.0",
  displayName: "Helper Runner",
  description: "Runs deterministic helper scripts on Routine fires, Approval lifecycle events (created/decided), or Issue updates (status change). Three trigger kinds.",
  author: "openclaw",
  categories: ["connector"],
  capabilities: [
    "events.subscribe",
    "issue.documents.write",
    "issue.comments.create",
    "issues.update",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "metrics.write",
  ],
  instanceConfigSchema: {
    type: "object",
    required: ["helpers"],
    properties: {
      helpers: {
        type: "array",
        title: "Helpers",
        items: {
          type: "object",
          required: ["name", "trigger", "exec"],
          properties: {
            name: { type: "string", title: "Helper Name" },
            trigger: {
              type: "object",
              required: ["kind"],
              properties: {
                kind: { type: "string", enum: ["routine", "approval", "issue"] },
                statusFilter: {
                  type: "string",
                  title: "Issue status filter",
                  description: "When kind=issue: only fire when the issue's status equals this. e.g. 'done'. Omit to fire on any status change.",
                },
                assigneeAgentId: {
                  type: "string",
                  title: "Assignee agent UUID filter",
                  description: "When kind=issue: only fire when the issue is assigned to this agent.",
                },
                titleContains: {
                  type: "string",
                  title: "Title substring filter",
                  description: "When kind=issue: only fire when the issue title (case-insensitive) contains this substring.",
                },
                routineId: {
                  type: "string",
                  title: "Routine UUID",
                  description: "Required when kind=routine. The routine whose fired event should trigger this helper.",
                },
                event: {
                  type: "string",
                  enum: ["created", "decided"],
                  default: "decided",
                  title: "Approval lifecycle event",
                  description: "When kind=approval: 'created' fires at request time (use for Discord cards/notifications); 'decided' fires when status flips (use for downstream actions).",
                },
                approvalType: {
                  type: "string",
                  title: "Approval type filter",
                  description: "Optional. When kind=approval, fire only on approvals of this type (e.g. request_board_approval). Omit to fire on any approval type.",
                },
                requireStatus: {
                  type: "string",
                  enum: ["approved", "rejected", "any"],
                  default: "approved",
                  title: "Required approval status",
                  description: "When kind=approval AND event=decided: fire only when approval transitions to this status. Ignored for event=created.",
                },
              },
            },
            exec: {
              type: "object",
              required: ["command"],
              properties: {
                command: { type: "string", title: "Absolute path to executable" },
                args: { type: "array", items: { type: "string" } },
                cwd: { type: "string" },
                env: { type: "object", additionalProperties: { type: "string" } },
                timeoutSec: { type: "number", default: 120, minimum: 1 },
              },
            },
            output: {
              type: "object",
              properties: {
                documentKey: { type: "string", default: "helper-output" },
                format: { type: "string", enum: ["json", "markdown", "raw"], default: "raw" },
                comment: { type: "boolean", default: false },
              },
            },
            errorHandling: {
              type: "object",
              properties: {
                onFailure: { type: "string", enum: ["block_issue", "cancel_issue", "noop"], default: "noop" },
                onTimeout: { type: "string", enum: ["block_issue", "cancel_issue", "noop"], default: "noop" },
              },
            },
            maxConcurrent: { type: "number", default: 4, minimum: 1 },
          },
        },
      },
    },
  },
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
