import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { HelperConfig, PluginConfig } from "../config/schema.js";
import { PaperclipClient } from "../api/paperclip.js";
import { spawnHelper } from "../exec/spawn.js";
import { interpolate, interpolateArray, interpolateRecord } from "../exec/interpolate.js";
import { writeOutput, writeError, applyErrorPolicy } from "../exec/output.js";
import { Semaphore } from "../util/concurrency.js";
import { helperKey } from "./routine-fired.js";

type Vars = {
  approvalId: string;
  approvalType: string;
  approvalStatus: string;
  issueId: string;
  issueIdentifier: string;
  routineId: string;
  routineRunId: string;
  companyId: string;
  approvalIssueIds: string;
};

/**
 * ApprovalCreatedHandler — fires when an approval is first created.
 *
 * Subscribes to `approval.created`. Filters helpers with trigger.kind=approval AND event="created".
 * Use this to post Discord cards / send notifications at approval-request time.
 * (Use ApprovalDecidedHandler for post-decision actions like Metricool push.)
 */
export class ApprovalCreatedHandler {
  private semaphores = new Map<string, Semaphore>();
  private semaphoreMax = new Map<string, number>();

  constructor(
    private getConfig: () => PluginConfig,
    private ctx: Pick<PluginContext, "logger" | "issues" | "secrets">
  ) {}

  rebuildSemaphores(): void {
    const config = this.getConfig();
    const newMap = new Map<string, Semaphore>();
    const newMax = new Map<string, number>();
    for (const helper of config.helpers) {
      if (helper.trigger.kind !== "approval") continue;
      if ((helper.trigger.event ?? "decided") !== "created") continue;
      const key = helperKey(helper);
      const max = helper.maxConcurrent ?? 4;
      const existingMax = this.semaphoreMax.get(key);
      if (this.semaphores.has(key) && existingMax === max) {
        newMap.set(key, this.semaphores.get(key)!);
      } else {
        newMap.set(key, new Semaphore(max));
      }
      newMax.set(key, max);
    }
    this.semaphores = newMap;
    this.semaphoreMax = newMax;
  }

  async handle(event: PluginEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown> | undefined;
    this.ctx.logger.info("[approval-created] handle entered", {
      eventType: (event as { eventType?: string }).eventType,
      entityId: event.entityId,
      type: payload?.["type"],
    });

    const approvalType = (payload?.["type"] as string | undefined) ?? "";
    const approvalId = (payload?.["approvalId"] as string | undefined) ?? event.entityId ?? "";
    if (!approvalId) {
      this.ctx.logger.info("[approval-created] skipped: no approvalId");
      return;
    }

    const issueIds = Array.isArray(payload?.["issueIds"]) ? (payload!["issueIds"] as string[]) : [];
    const linkedIssues = Array.isArray(payload?.["linkedIssues"])
      ? (payload!["linkedIssues"] as Array<{ id?: string; identifier?: string }>)
      : [];
    const firstIssueId = issueIds[0] ?? linkedIssues[0]?.id ?? "";
    const firstIssueIdentifier = linkedIssues[0]?.identifier ?? "";

    const config = this.getConfig();
    const matching = config.helpers.filter((h) => {
      if (h.trigger.kind !== "approval") return false;
      if ((h.trigger.event ?? "decided") !== "created") return false;
      if (h.trigger.approvalType && h.trigger.approvalType !== approvalType) return false;
      return true;
    });

    this.ctx.logger.info("[approval-created] matching helpers", {
      approvalId,
      type: approvalType,
      matchCount: matching.length,
    });
    if (matching.length === 0) return;

    const vars: Vars = {
      approvalId,
      approvalType,
      approvalStatus: "pending",
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
    const key = helperKey(helper);
    if (!this.semaphores.has(key)) {
      const max = helper.maxConcurrent ?? 4;
      this.semaphores.set(key, new Semaphore(max));
      this.semaphoreMax.set(key, max);
    }
    const sem = this.semaphores.get(key)!;
    await sem.acquire();
    try {
      const command = await interpolate(helper.exec.command, vars as unknown as Record<string, string>, this.ctx);
      const args = await interpolateArray(helper.exec.args ?? [], vars as unknown as Record<string, string>, this.ctx);
      const cwd = helper.exec.cwd
        ? await interpolate(helper.exec.cwd, vars as unknown as Record<string, string>, this.ctx)
        : undefined;
      const env = helper.exec.env
        ? await interpolateRecord(helper.exec.env, vars as unknown as Record<string, string>, this.ctx)
        : undefined;

      this.ctx.logger.info("helper spawning (approval.created)", {
        helper: helper.name,
        command,
        approvalId: vars.approvalId,
      });
      const result = await spawnHelper(command, args, {
        cwd,
        env,
        timeoutMs: (helper.exec.timeoutSec ?? 120) * 1000,
      });

      const client = new PaperclipClient(this.ctx as unknown as PluginContext, vars.companyId);
      // For approval.created we don't always have an issue to attach to. Output documents only when an issue is in vars.
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
        this.ctx.logger.info("helper completed (no linked issue, output not attached)", {
          helper: helper.name,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
      }
      this.ctx.logger.info("helper completed (approval.created)", {
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
