import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import type { PluginConfig } from "./config/schema.js";
import { normalizeConfig } from "./config/validate.js";
import { RoutineFiredHandler } from "./handlers/routine-fired.js";
import { ApprovalDecidedHandler } from "./handlers/approval-decided.js";
import { ApprovalCreatedHandler } from "./handlers/approval-created.js";
import { IssueUpdatedHandler } from "./handlers/issue-updated.js";

// Plugin config is company-scoped (paperclip >= v2026.720.0): the host delivers
// each company's row through onConfigChanged (startup replay + saves). A
// company's helpers only ever fire for that company's own events, so the
// clones migration 0164 fans out to every company can never cross-fire.
const EMPTY_CONFIG: PluginConfig = { helpers: [] };
const configByCompany = new Map<string, PluginConfig>();
let routineHandler: RoutineFiredHandler | null = null;
let approvalDecidedHandler: ApprovalDecidedHandler | null = null;
let approvalCreatedHandler: ApprovalCreatedHandler | null = null;
let issueUpdatedHandler: IssueUpdatedHandler | null = null;
let savedLogger: PluginContext["logger"] | null = null;

function getConfig(companyId?: string): PluginConfig {
  if (companyId) return configByCompany.get(companyId) ?? EMPTY_CONFIG;
  return { helpers: [...configByCompany.values()].flatMap((config) => config.helpers) };
}

function rebuildAllSemaphores(): void {
  routineHandler?.rebuildSemaphores();
  approvalDecidedHandler?.rebuildSemaphores();
  approvalCreatedHandler?.rebuildSemaphores();
  issueUpdatedHandler?.rebuildSemaphores();
}

const plugin = definePlugin({
  multiCompanyConfig: true,

  async setup(ctx) {
    savedLogger = ctx.logger;

    routineHandler = new RoutineFiredHandler(getConfig, ctx);
    routineHandler.rebuildSemaphores();

    approvalDecidedHandler = new ApprovalDecidedHandler(getConfig, ctx);
    approvalDecidedHandler.rebuildSemaphores();

    approvalCreatedHandler = new ApprovalCreatedHandler(getConfig, ctx);
    approvalCreatedHandler.rebuildSemaphores();

    issueUpdatedHandler = new IssueUpdatedHandler(getConfig, ctx);
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

    ctx.logger.info("helper-runner ready; awaiting company configs");
  },

  async onConfigChanged(newConfig, context) {
    const companyId = context?.companyId;
    if (!companyId) return;
    try {
      configByCompany.set(companyId, normalizeConfig(newConfig));
    } catch (err) {
      // Fail closed: an invalid (e.g. legacy ${secret:UUID}) config makes this
      // company inert instead of running helpers with unresolved secrets.
      configByCompany.set(companyId, EMPTY_CONFIG);
      savedLogger?.error("helper-runner: invalid company config; company disabled", {
        companyId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    rebuildAllSemaphores();
    const helpers = configByCompany.get(companyId)!.helpers;
    savedLogger?.info("helper-runner company config applied", {
      companyId,
      helperCount: helpers.length,
      routineHelpers: helpers.filter((h) => h.trigger.kind === "routine").length,
      approvalHelpers: helpers.filter((h) => h.trigger.kind === "approval").length,
      issueHelpers: helpers.filter((h) => h.trigger.kind === "issue").length,
    });
  },

  async onHealth() {
    return { status: "ok", message: "helper-runner worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
