import { randomUUID } from "node:crypto";
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { nextAction } from "./engine/conductor.js";
import type { RunState } from "./engine/conductor.js";
import { loadThematicSpec } from "./engine/spec.js";
import { resolveWorker } from "./engine/engine.js";
import { GATE_DEFS } from "./engine/spec-data.js";
import { runLocalGate } from "./engine/gate-runner.js";
import { assemblePrompt } from "./engine/prompt.js";
import { PROFILES } from "./engine/profiles.js";

// The hardcoded schema name for this plugin's DB namespace (pre-computed).
const SCHEMA = "plugin_globalisto_pipeline_46b22ea2d1";
const TABLE = `${SCHEMA}.pipeline_runs`;

// Shape of a row from pipeline_runs as returned by ctx.db.query
interface PipelineRow {
  id: string;
  company_id: string;
  topic: string;
  profile: string;
  status: string;
  completed_step_ids: string; // JSON string or already-parsed (harness returns string)
  active_step_id: string | null;
  active_worker_run_id: string | null;
  active_issue_id: string | null;
  step_complete: boolean;
  error: string | null;
}

function parseCompletedStepIds(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    // ── action: start ────────────────────────────────────────────────────────
    ctx.actions.register("start", async (params) => {
      const topic = String(params.topic ?? "");
      const profile = String(params.profile ?? "");
      const companyId = String(params.companyId ?? "");

      if (!PROFILES[profile]) {
        throw new Error(`Unknown profile: "${profile}". Valid profiles: ${Object.keys(PROFILES).join(", ")}`);
      }

      // Create a tracking issue
      const issue = await ctx.issues.create({
        companyId,
        title: `pipeline: ${topic}`,
        originKind: `plugin:${ctx.manifest.id}:globalisto-pipeline`,
      });

      const runId = randomUUID();
      const now = new Date().toISOString();

      await ctx.db.execute(
        `INSERT INTO ${TABLE}
           (id, company_id, topic, profile, status, completed_step_ids, active_step_id,
            active_worker_run_id, active_issue_id, step_complete, error, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL, NULL, $7, false, NULL, $8, $8)`,
        [runId, companyId, topic, profile, "running", "[]", issue.id, now],
      );

      ctx.logger.info("Pipeline run started", { runId, topic, profile, issueId: issue.id });
      return { runId, issueId: issue.id };
    });

    // ── event: agent.run.finished ────────────────────────────────────────────
    ctx.events.on("agent.run.finished", async (event) => {
      const workerRunId = event.entityId;
      if (!workerRunId) return;

      await ctx.db.execute(
        `UPDATE ${TABLE}
         SET step_complete=true, updated_at=now()
         WHERE active_worker_run_id = $1`,
        [workerRunId],
      );

      ctx.logger.info("Marked step complete via agent.run.finished", { workerRunId });
    });

    // ── job: conductor ───────────────────────────────────────────────────────
    ctx.jobs.register("conductor", async (_job) => {
      const steps = loadThematicSpec();

      // Load all running pipeline rows
      const rows = await ctx.db.query<PipelineRow>(
        `SELECT * FROM ${TABLE} WHERE status='running'`,
      );

      ctx.logger.info("Conductor tick", { runCount: rows.length });

      for (const row of rows) {
        try {
          await processPipelineRun(ctx, row, steps);
        } catch (err) {
          ctx.logger.error("Conductor error for run", {
            runId: row.id,
            error: String(err),
          });
          await ctx.db.execute(
            `UPDATE ${TABLE} SET status='failed', error=$1, updated_at=now() WHERE id=$2`,
            [String(err), row.id],
          );
        }
      }
    });
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  },
});

async function processPipelineRun(
  ctx: Parameters<typeof plugin.definition.setup>[0],
  row: PipelineRow,
  steps: ReturnType<typeof loadThematicSpec>,
): Promise<void> {
  const runState: RunState = {
    completedStepIds: parseCompletedStepIds(row.completed_step_ids),
    activeStepId: row.active_step_id ?? null,
    stepComplete: Boolean(row.step_complete),
  };

  const action = nextAction(runState, steps);

  ctx.logger.info("Conductor action", {
    runId: row.id,
    action: action.kind,
    activeStepId: row.active_step_id,
  });

  switch (action.kind) {
    case "wait":
      // Worker still running — nothing to do
      return;

    case "complete":
      await ctx.db.execute(
        `UPDATE ${TABLE} SET status='completed', updated_at=now() WHERE id=$1`,
        [row.id],
      );
      ctx.logger.info("Pipeline run completed", { runId: row.id });
      return;

    case "invoke": {
      const step = action.step;

      // Human steps: auto-pass for v1
      if (step.requiredModel === "human") {
        const completed = [...parseCompletedStepIds(row.completed_step_ids), step.id];
        await ctx.db.execute(
          `UPDATE ${TABLE}
           SET completed_step_ids=$1::jsonb, active_step_id=NULL,
               active_worker_run_id=NULL, step_complete=false, updated_at=now()
           WHERE id=$2`,
          [JSON.stringify(completed), row.id],
        );
        ctx.logger.info("Human gate auto-passed", { runId: row.id, stepId: step.id });
        return;
      }

      // Resolve the worker agent by name
      const profile = PROFILES[row.profile];
      if (!profile) {
        throw new Error(`Unknown profile: ${row.profile}`);
      }
      const agentName = resolveWorker(step.requiredModel, profile);

      const agentList = await ctx.agents.list({ companyId: row.company_id });
      const agent = agentList.find((a) => a.name === agentName);
      if (!agent) {
        throw new Error(`Worker agent not found: "${agentName}" in company ${row.company_id}`);
      }

      // Read input artifacts from issue documents
      const inputsMap: Record<string, string> = {};
      if (row.active_issue_id) {
        for (const inputName of step.inputs) {
          const doc = await ctx.issues.documents.get(
            row.active_issue_id,
            `artifact:${inputName}`,
            row.company_id,
          );
          if (doc) inputsMap[inputName] = doc.body;
        }
      }

      const promptContent = `Execute pipeline step ${step.id}. Prompt: ${step.prompt}. Write your output artifact(s) ${JSON.stringify(step.outputs)} as issue documents keyed "artifact:<name>".`;
      const prompt = assemblePrompt(promptContent, inputsMap);

      const { runId: workerRunId } = await ctx.agents.invoke(agent.id, row.company_id, {
        prompt,
        reason: `globalisto-pipeline:${step.id}`,
      });

      await ctx.db.execute(
        `UPDATE ${TABLE}
         SET active_step_id=$1, active_worker_run_id=$2, step_complete=false, updated_at=now()
         WHERE id=$3`,
        [step.id, workerRunId, row.id],
      );

      ctx.logger.info("Invoked worker for step", {
        runId: row.id,
        stepId: step.id,
        agentName,
        workerRunId,
      });
      return;
    }

    case "advance": {
      const step = action.step;
      const issueId = row.active_issue_id;

      // Read output artifacts
      const artifacts: Record<string, string> = {};
      if (issueId) {
        for (const outName of step.outputs) {
          const doc = await ctx.issues.documents.get(
            issueId,
            `artifact:${outName}`,
            row.company_id,
          );
          if (doc) artifacts[outName] = doc.body;
        }
      }

      // Run gates
      for (const gateId of step.gatesAfter) {
        const gateDef = GATE_DEFS[gateId];
        if (!gateDef) {
          ctx.logger.warn(`Gate ${gateId} not found in GATE_DEFS — skipping`, { runId: row.id, stepId: step.id });
          continue;
        }

        if (gateDef.type === "delegated") {
          ctx.logger.info(`Delegated gate ${gateId} deferred (v1 auto-pass)`, {
            runId: row.id,
            stepId: step.id,
          });
          continue;
        }

        // Local gate: assemble best-effort input from artifacts
        const firstArtifactBody = Object.values(artifacts)[0] ?? "";
        const gateInput: Record<string, unknown> = { content: firstArtifactBody, ...artifacts };

        let gateResult;
        try {
          gateResult = runLocalGate(gateId, gateInput, gateDef.params as Record<string, unknown> | undefined);
        } catch (err) {
          ctx.logger.info(`Gate ${gateId} not evaluated (v1 input assembly): ${String(err)}`, {
            runId: row.id,
            stepId: step.id,
          });
          continue;
        }

        if ("deferred" in gateResult) {
          ctx.logger.info(`Gate ${gateId} not evaluated (v1 input assembly): ${gateResult.reason}`, {
            runId: row.id,
            stepId: step.id,
          });
          continue;
        }

        ctx.logger.info(`Gate ${gateId} evaluated`, {
          runId: row.id,
          stepId: step.id,
          pass: gateResult.pass,
          action: gateResult.action,
          reasons: gateResult.reasons,
        });

        if (!gateResult.pass) {
          throw new Error(`Gate ${gateId} blocked: ${gateResult.reasons.join("; ")}`);
        }
      }

      // Advance: mark step complete
      const completed = [...parseCompletedStepIds(row.completed_step_ids), step.id];
      await ctx.db.execute(
        `UPDATE ${TABLE}
         SET completed_step_ids=$1::jsonb, active_step_id=NULL,
             active_worker_run_id=NULL, step_complete=false, updated_at=now()
         WHERE id=$2`,
        [JSON.stringify(completed), row.id],
      );

      ctx.logger.info("Step advanced", { runId: row.id, stepId: step.id, completedCount: completed.length });
      return;
    }
  }
}

export default plugin;
runWorker(plugin, import.meta.url);
