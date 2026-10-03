import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { HelperConfig, PluginConfig } from "../config/schema.js";
import { PaperclipClient } from "../api/paperclip.js";
import { spawnHelper } from "../exec/spawn.js";
import { interpolate, interpolateArray, interpolateRecord, type InterpolationVars } from "../exec/interpolate.js";
import { writeOutput, writeError, applyErrorPolicy } from "../exec/output.js";
import { SemaphorePool } from "../util/concurrency.js";
import { helperKey } from "../config/validate.js";

type Vars = {
  approvalId: string;
  approvalType: string;
  approvalStatus: string;
  // First linked issue, if any (used as the issueId for output document attachment + status patches).
  issueId: string;
  issueIdentifier: string;
  // routineId/routineRunId left empty for approval-triggered helpers — kept in shape so
  // interpolation templates that reference them don't crash; users should not reference these.
  routineId: string;
  routineRunId: string;
  companyId: string;
  // All linked issue IDs joined as comma-separated string for ${approval.issueIds}.
  approvalIssueIds: string;
};

/**
 * ApprovalDecidedHandler — fires when an approval changes status (typically `approved`).
 *
 * Subscribes to the `approval.decided` event. The event payload is expected to include:
 *   - payload.status: "approved" | "rejected" | "cancelled" | "revision_requested"
 *   - payload.type: approval enum (e.g. "request_board_approval")
 *   - payload.issueIds: string[] (linked issues, may be empty)
 *
 * For each helper with `trigger.kind === "approval"`:
 *   - if helper.trigger.approvalType set, filter to matching type
 *   - filter on requireStatus (default "approved")
 *
 * On match: spawn the configured exec, attach stdout to the FIRST linked issue
 * (or skip the document attachment if no linked issues).
 */
export class ApprovalDecidedHandler {
  private semaphores = new SemaphorePool();

  constructor(
    // companyId given → that company's config; omitted → every company's helpers
    // (semaphore sizing only).
    private getConfig: (companyId?: string) => PluginConfig,
    private ctx: Pick<PluginContext, "logger" | "issues" | "secrets">
  ) {}


  async handle(event: PluginEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown> | undefined;
    this.ctx.logger.info("[approval-decided] handle entered", {
      eventType: (event as { eventType?: string }).eventType,
      entityId: event.entityId,
      status: payload?.["status"],
      type: payload?.["type"],
    });

    // The server's approval.decided payload carries the activity action
    // (approval.approved / approval.rejected / approval.revision_requested), not a status.
    const action = (payload?.["action"] as string | undefined) ?? "";
    const status =
      (payload?.["status"] as string | undefined) ??
      (action.startsWith("approval.") ? action.slice("approval.".length) : "");
    const approvalType = (payload?.["type"] as string | undefined) ?? "";
    const approvalId = (payload?.["approvalId"] as string | undefined) ?? event.entityId ?? "";
    if (!approvalId) {
      this.ctx.logger.info("[approval-decided] skipped: no approvalId");
      return;
    }

    const rawIssueIds = payload?.["issueIds"] ?? payload?.["linkedIssueIds"];
    const issueIds = Array.isArray(rawIssueIds) ? (rawIssueIds as string[]) : [];
    const linkedIssues = Array.isArray(payload?.["linkedIssues"])
      ? (payload!["linkedIssues"] as Array<{ id?: string; identifier?: string }>)
      : [];
    const firstIssueId = issueIds[0] ?? linkedIssues[0]?.id ?? "";
    const firstIssueIdentifier = linkedIssues[0]?.identifier ?? "";

    const config = this.getConfig(event.companyId);
    const matching = config.helpers.filter((h) => {
      if (h.trigger.kind !== "approval") return false;
      const event = h.trigger.event ?? "decided";
      if (event !== "decided") return false;
      const requireStatus = h.trigger.requireStatus ?? "approved";
      if (requireStatus !== "any" && requireStatus !== status) return false;
      if (h.trigger.approvalType && h.trigger.approvalType !== approvalType) return false;
      return true;
    });

    this.ctx.logger.info("[approval-decided] matching helpers", {
      approvalId,
      status,
      type: approvalType,
      matchCount: matching.length,
    });
    if (matching.length === 0) return;

    const vars: Vars = {
      approvalId,
      approvalType,
      approvalStatus: status,
      issueId: firstIssueId,
      issueIdentifier: firstIssueIdentifier,
      routineId: "",
      routineRunId: "",
      companyId: event.companyId ?? "",
      approvalIssueIds: issueIds.join(","),
    };

    await Promise.all(matching.map((helper) => this.runHelper(helper, vars)));
  }

  private async runHelper(helper: HelperConfig, vars: Vars): Promise<void> {
    const sem = this.semaphores.get(`${vars.companyId}|${helperKey(helper)}`, helper.maxConcurrent ?? 4);
    await sem.acquire();
    try {
      const command = await interpolate(helper.exec.command, vars as unknown as InterpolationVars, this.ctx);
      const args = await interpolateArray(helper.exec.args ?? [], vars as unknown as InterpolationVars, this.ctx);
      const cwd = helper.exec.cwd
        ? await interpolate(helper.exec.cwd, vars as unknown as InterpolationVars, this.ctx)
        : undefined;
      const env = helper.exec.env
        ? await interpolateRecord(helper.exec.env, vars as unknown as InterpolationVars, this.ctx)
        : undefined;

      this.ctx.logger.info("helper spawning (approval)", {
        helper: helper.name,
        command,
        approvalId: vars.approvalId,
        issueId: vars.issueId,
      });
      const result = await spawnHelper(command, args, {
        cwd,
        env,
        timeoutMs: (helper.exec.timeoutSec ?? 120) * 1000,
      });

      const client = new PaperclipClient(this.ctx as unknown as PluginContext, vars.companyId);

      // Attach output document to the first linked issue if there is one.
      if (vars.issueId) {
        if (result.exitCode === 0 && !result.timedOut) {
          await writeOutput(result, helper, vars.issueId, client);
        } else {
          await writeError(
            vars.issueId,
            helper.output?.documentKey ?? "helper-output",
            `helper "${helper.name}" failed: exitCode=${result.exitCode} timedOut=${result.timedOut}\nstderr:\n${result.stderr.slice(0, 2000)}`,
            client
          );
          const policy = result.timedOut
            ? (helper.errorHandling?.onTimeout ?? "noop")
            : (helper.errorHandling?.onFailure ?? "noop");
          await applyErrorPolicy(vars.issueId, policy, client);
        }
      } else {
        // No linked issue — log to plugin log only.
        this.ctx.logger.info("helper completed (no linked issue, no document attached)", {
          helper: helper.name,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
      }
      this.ctx.logger.info("helper completed (approval)", {
        helper: helper.name,
        approvalId: vars.approvalId,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
      });
    } finally {
      sem.release();
    }
  }
}
