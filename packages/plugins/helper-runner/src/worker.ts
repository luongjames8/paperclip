import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginConfig } from "./config/schema.js";
import { validateConfig } from "./config/validate.js";
import { RoutineFiredHandler } from "./handlers/routine-fired.js";
import { ApprovalDecidedHandler } from "./handlers/approval-decided.js";
import { ApprovalCreatedHandler } from "./handlers/approval-created.js";
import { IssueUpdatedHandler } from "./handlers/issue-updated.js";

let currentConfig: PluginConfig = { helpers: [] };
let routineHandler: RoutineFiredHandler | null = null;
let approvalDecidedHandler: ApprovalDecidedHandler | null = null;
let approvalCreatedHandler: ApprovalCreatedHandler | null = null;
let issueUpdatedHandler: IssueUpdatedHandler | null = null;

const plugin = definePlugin({
  async setup(ctx) {
    const raw = await ctx.config.get();
    const config = { helpers: [], ...(raw ?? {}) } as unknown as PluginConfig;
    validateConfig(config);
    currentConfig = config;

    routineHandler = new RoutineFiredHandler(() => currentConfig, ctx);
    routineHandler.rebuildSemaphores();

    approvalDecidedHandler = new ApprovalDecidedHandler(() => currentConfig, ctx);
    approvalDecidedHandler.rebuildSemaphores();

    approvalCreatedHandler = new ApprovalCreatedHandler(() => currentConfig, ctx);
    approvalCreatedHandler.rebuildSemaphores();

    issueUpdatedHandler = new IssueUpdatedHandler(() => currentConfig, ctx);
    issueUpdatedHandler.rebuildSemaphores();

    ctx.events.on("issue.created", async (event) => {
      await routineHandler!.handle(event);
    });
    ctx.events.on("approval.created", async (event) => {
      await approvalCreatedHandler!.handle(event);
    });
    ctx.events.on("approval.decided", async (event) => {
      await approvalDecidedHandler!.handle(event);
    });
    ctx.events.on("issue.updated", async (event) => {
      await issueUpdatedHandler!.handle(event);
    });

    const routineCount = config.helpers.filter((h) => h.trigger.kind === "routine").length;
    const apprCreatedCount = config.helpers.filter(
      (h) => h.trigger.kind === "approval" && (h.trigger.event ?? "decided") === "created"
    ).length;
    const apprDecidedCount = config.helpers.filter(
      (h) => h.trigger.kind === "approval" && (h.trigger.event ?? "decided") === "decided"
    ).length;
    const issueUpdatedCount = config.helpers.filter((h) => h.trigger.kind === "issue").length;
    ctx.logger.info("helper-runner ready", {
      helperCount: config.helpers.length,
      routineHelpers: routineCount,
      approvalCreatedHelpers: apprCreatedCount,
      approvalDecidedHelpers: apprDecidedCount,
      issueUpdatedHelpers: issueUpdatedCount,
    });
  },

  async onConfigChanged(newConfig) {
    const config = { helpers: [], ...(newConfig ?? {}) } as unknown as PluginConfig;
    validateConfig(config);
    currentConfig = config;
    if (routineHandler) routineHandler.rebuildSemaphores();
    if (approvalDecidedHandler) approvalDecidedHandler.rebuildSemaphores();
    if (approvalCreatedHandler) approvalCreatedHandler.rebuildSemaphores();
    if (issueUpdatedHandler) issueUpdatedHandler.rebuildSemaphores();
  },

  async onHealth() {
    return { status: "ok", message: "helper-runner worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
