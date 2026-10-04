import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { HelperConfig, PluginConfig } from "../config/schema.js";
import { PaperclipClient } from "../api/paperclip.js";
import { spawnHelper } from "../exec/spawn.js";
import { interpolate, interpolateArray, interpolateRecord } from "../exec/interpolate.js";
import { writeOutput, writeError, applyErrorPolicy } from "../exec/output.js";
import { SemaphorePool } from "../util/concurrency.js";
import { helperKey } from "../config/validate.js";

type Vars = { issueId: string; issueIdentifier: string; routineId: string; routineRunId: string; companyId: string };

export class RoutineFiredHandler {
  private semaphores = new SemaphorePool();

  constructor(
    // companyId given → that company's config; omitted → every company's helpers
    // (semaphore sizing only).
    private getConfig: (companyId?: string) => PluginConfig,
    private ctx: Pick<PluginContext, "logger" | "issues" | "secrets">
  ) {}


  async handle(event: PluginEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown> | undefined;
    this.ctx.logger.info("[debug] handle entered", {
      eventType: (event as { eventType?: string }).eventType,
      entityId: event.entityId,
      originKind: payload?.["originKind"],
      originId: payload?.["originId"],
    });
    if (payload?.["originKind"] !== "routine_execution") {
      this.ctx.logger.info("[debug] skipped: originKind not routine_execution", { got: payload?.["originKind"] });
      return;
    }

    const routineId = payload?.["originId"] as string | undefined;
    if (!routineId) { this.ctx.logger.info("[debug] skipped: no originId"); return; }

    const issueId = event.entityId;
    if (!issueId) { this.ctx.logger.info("[debug] skipped: no entityId"); return; }

    const issueIdentifier = (payload?.["identifier"] as string | undefined) ?? "";
    const routineRunId = (payload?.["originRunId"] as string | undefined) ?? "";
    const companyId = event.companyId ?? "";

    const config = this.getConfig(event.companyId);
    const matchingHelpers = config.helpers.filter(
      (h) => h.trigger.kind === "routine" && h.trigger.routineId === routineId
    );
    this.ctx.logger.info("[debug] matching helpers", {
      routineId,
      configRoutineIds: config.helpers.map((h) => (h.trigger.kind === "routine" ? h.trigger.routineId : null)),
      matchCount: matchingHelpers.length,
    });
    if (matchingHelpers.length === 0) {
      this.ctx.logger.info("[debug] no matching helpers", { routineId });
      return;
    }

    await Promise.all(
      matchingHelpers.map((helper) =>
        this.runHelper(helper, { issueId, issueIdentifier, routineId, routineRunId, companyId })
      )
    );
  }

  private async runHelper(helper: HelperConfig, vars: Vars): Promise<void> {
    const sem = this.semaphores.get(`${vars.companyId}|${helperKey(helper)}`, helper.maxConcurrent ?? 4);

    await sem.acquire();
    try {
      await this.execHelper(helper, vars);
    } finally {
      sem.release();
    }
  }

  private async execHelper(helper: HelperConfig, vars: Vars): Promise<void> {
    const { issueId, companyId } = vars;
    const documentKey = helper.output?.documentKey ?? "helper-output";
    const timeoutMs = (helper.exec.timeoutSec ?? 120) * 1000;

    const interpolatedArgs = await interpolateArray(helper.exec.args ?? [], vars, this.ctx);
    const interpolatedEnv = helper.exec.env
      ? await interpolateRecord(helper.exec.env, vars, this.ctx)
      : undefined;
    const interpolatedCwd = helper.exec.cwd
      ? await interpolate(helper.exec.cwd, vars, this.ctx)
      : undefined;

    this.ctx.logger.info("helper spawning", { helper: helper.name, command: helper.exec.command, issueId });

    const result = await spawnHelper(helper.exec.command, interpolatedArgs, {
      cwd: interpolatedCwd,
      env: interpolatedEnv,
      timeoutMs,
    });

    const client = new PaperclipClient(this.ctx, companyId);

    if (result.timedOut) {
      const onTimeout = helper.errorHandling?.onTimeout ?? "noop";
      await writeError(issueId, documentKey, `helper "${helper.name}" timed out after ${helper.exec.timeoutSec ?? 120}s`, client);
      if (helper.output?.comment) {
        await client.postComment(issueId, `⏱ helper "${helper.name}" timed out`).catch(() => {});
      }
      await applyErrorPolicy(issueId, onTimeout, client);
      this.ctx.logger.warn("helper timed out", { helper: helper.name, issueId });
      return;
    }

    if (result.exitCode !== 0) {
      const onFailure = helper.errorHandling?.onFailure ?? "noop";
      await writeError(issueId, documentKey, `helper "${helper.name}" exited with code ${result.exitCode}\n\nstderr:\n${result.stderr}`, client);
      if (helper.output?.comment) {
        await client.postComment(issueId, `❌ helper "${helper.name}" failed — exit ${result.exitCode}`).catch(() => {});
      }
      await applyErrorPolicy(issueId, onFailure, client);
      this.ctx.logger.warn("helper failed", { helper: helper.name, exitCode: result.exitCode, issueId });
      return;
    }

    await writeOutput(result, helper, issueId, client);
    this.ctx.logger.info("helper completed", { helper: helper.name, durationMs: result.durationMs, issueId });
  }
}

