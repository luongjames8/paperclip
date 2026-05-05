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
 * IssueUpdatedHandler — fires when an Issue's status (or other field) changes.
 *
 * Subscribes to `issue.updated`. Filters helpers with trigger.kind=issue + trigger.event=updated
 * AND any combination of statusFilter / assigneeAgentId / titleContains.
 *
 * Use this for "after agent X marks Issue done" patterns — replaces the LLM-skill-following
 * gap where downstream API plumbing keeps getting skipped.
 */
export class IssueUpdatedHandler {
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
      if (helper.trigger.kind !== "issue") continue;
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
    const issueId = event.entityId ?? "";
    if (!issueId) return;

    const status = (payload?.["status"] as string | undefined) ?? "";
    const assigneeAgentId = (payload?.["assigneeAgentId"] as string | undefined) ?? "";
    const title = (payload?.["title"] as string | undefined) ?? "";
    const identifier = (payload?.["identifier"] as string | undefined) ?? "";

    this.ctx.logger.info("[issue-updated] handle entered", {
      issueId,
      status,
      assigneeAgentId,
      titleSnippet: title.slice(0, 60),
    });

    const config = this.getConfig();
    const matching = config.helpers.filter((h) => {
      if (h.trigger.kind !== "issue") return false;
      const event = h.trigger.event ?? "updated";
      if (event !== "updated") return false;
      if (h.trigger.statusFilter && h.trigger.statusFilter !== status) return false;
      if (h.trigger.assigneeAgentId && h.trigger.assigneeAgentId !== assigneeAgentId) return false;
      if (h.trigger.titleContains && !title.toLowerCase().includes(h.trigger.titleContains.toLowerCase())) return false;
      return true;
    });

    this.ctx.logger.info("[issue-updated] matching helpers", {
      issueId,
      matchCount: matching.length,
    });
    if (matching.length === 0) return;

    const vars: Vars = {
      approvalId: "",
      approvalType: "",
      approvalStatus: "",
      issueId,
      issueIdentifier: identifier,
      routineId: "",
      routineRunId: "",
      companyId: event.companyId ?? "",
      approvalIssueIds: "",
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

      this.ctx.logger.info("helper spawning (issue.updated)", {
        helper: helper.name,
        command,
        issueId: vars.issueId,
      });
      const result = await spawnHelper(command, args, {
        cwd,
        env,
        timeoutMs: (helper.exec.timeoutSec ?? 120) * 1000,
      });

      const client = new PaperclipClient(this.ctx as unknown as PluginContext, vars.companyId);
      if (result.exitCode === 0 && !result.timedOut) {
        await writeOutput(result, helper, vars.issueId, client);
      } else {
        await writeError(
          vars.issueId,
          helper.output?.documentKey ?? "helper-output",
          `helper "${helper.name}" failed: exitCode=${result.exitCode} timedOut=${result.timedOut}\nstderr:\n${result.stderr.slice(0, 2000)}`,
          client
        );
        await applyErrorPolicy(helper, vars.issueId, result, client);
      }
      this.ctx.logger.info("helper completed (issue.updated)", {
        helper: helper.name,
        issueId: vars.issueId,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
      });
    } finally {
      sem.release();
    }
  }
}
