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
import { assembleGateInput } from "./engine/gate-input.js";
import { readStepPrompt } from "./engine/load-prompt.js";
import { PaperclipRestClient } from "./engine/paperclip-rest.js";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";

// Steps are constant — load once at module scope rather than per conductor tick.
const THEMATIC_STEPS = loadThematicSpec();
// Vendored canonical prompts ship beside the built worker (../prompts from dist/
// and from src/). The conductor FEEDS the full prompt content to the worker.
const PROMPTS_DIR = fileURLToPath(new URL("../prompts", import.meta.url));

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

// Artifacts are keyed by basename. Producer steps declare BARE output names
// (e.g. "BEAT_GRAPH.yaml") while consumer steps reference them with a
// numbered-directory prefix (e.g. "../03_structure/BEAT_GRAPH.yaml"). The two
// forms are the SAME logical artifact (verified: every prefixed/bare pair shares
// a unique basename, no collisions). Normalize every read/write to the basename
// so cross-step inputs actually resolve instead of silently returning null.
export function artifactDocKey(name: string): string {
  return `artifact:${basename(name)}`;
}

// Terminal worker-run failure handling (halt + surface). The host emits
// agent.run.failed (failed/timed_out) and agent.run.cancelled — distinct from
// agent.run.finished (succeeded). Without these handlers a failed worker run
// leaves the pipeline stalled forever. Policy: mark the run failed and record
// the worker error so the operator sees the break (no auto-retry in v1).
async function haltPipelineForWorkerRun(
  ctx: Parameters<typeof plugin.definition.setup>[0],
  workerRunId: string | undefined,
  kind: string,
  workerError: string | null,
): Promise<void> {
  if (!workerRunId) return;
  const message = workerError ? `worker run ${kind}: ${workerError}` : `worker run ${kind}`;
  await ctx.db.execute(
    `UPDATE ${TABLE}
     SET status='failed', error=$1, updated_at=now()
     WHERE active_worker_run_id = $2 AND status='running'`,
    [message, workerRunId],
  );
  ctx.logger.warn(`Pipeline run halted: ${message}`, { workerRunId });
}

async function markStepAdvanced(
  ctx: Parameters<typeof plugin.definition.setup>[0],
  runId: string,
  completedStepIds: string[],
): Promise<void> {
  await ctx.db.execute(
    `UPDATE ${TABLE}
     SET completed_step_ids=$1::jsonb, active_step_id=NULL,
         active_worker_run_id=NULL, step_complete=false, updated_at=now()
     WHERE id=$2`,
    [JSON.stringify(completedStepIds), runId],
  );
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

    // ── event: agent.run.failed / cancelled ──────────────────────────────────
    // A worker run that does NOT succeed emits one of these (server heartbeat.ts).
    // Halt the pipeline run and surface the error rather than stalling forever.
    ctx.events.on("agent.run.failed", async (event) => {
      const payload = (event.payload ?? {}) as { error?: string | null };
      await haltPipelineForWorkerRun(ctx, event.entityId, "failed", payload.error ?? null);
    });
    ctx.events.on("agent.run.cancelled", async (event) => {
      const payload = (event.payload ?? {}) as { error?: string | null };
      await haltPipelineForWorkerRun(ctx, event.entityId, "cancelled", payload.error ?? null);
    });

    // ── job: conductor ───────────────────────────────────────────────────────
    ctx.jobs.register("conductor", async (_job) => {
      // Load all running pipeline rows
      const rows = await ctx.db.query<PipelineRow>(
        `SELECT * FROM ${TABLE} WHERE status='running'`,
      );

      ctx.logger.info("Conductor tick", { runCount: rows.length });

      // Per-tick agent list cache: keyed by company_id to avoid N identical list calls.
      const agentListCache = new Map<string, Array<{ id: string; name: string }>>();

      const rest = await buildRestClient(ctx);

      for (const row of rows) {
        try {
          await processPipelineRun(ctx, row, agentListCache, rest);
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

async function buildRestClient(ctx: Parameters<typeof plugin.definition.setup>[0]): Promise<PaperclipRestClient> {
  const cfg = await ctx.config.get();
  const apiKey = await ctx.secrets.resolve((cfg as { paperclipApiKeySecretRef?: string }).paperclipApiKeySecretRef ?? "");
  return new PaperclipRestClient(ctx, (cfg as { paperclipApiUrl?: string }).paperclipApiUrl ?? "http://paperclip:3100", apiKey);
}

async function processPipelineRun(
  ctx: Parameters<typeof plugin.definition.setup>[0],
  row: PipelineRow,
  agentListCache: Map<string, Array<{ id: string; name: string }>>,
  rest: PaperclipRestClient,
): Promise<void> {
  const runState: RunState = {
    completedStepIds: parseCompletedStepIds(row.completed_step_ids),
    activeStepId: row.active_step_id ?? null,
    stepComplete: Boolean(row.step_complete),
  };

  const action = nextAction(runState, THEMATIC_STEPS);

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
        const completed = [...runState.completedStepIds, step.id];
        await markStepAdvanced(ctx, row.id, completed);
        ctx.logger.info("Human gate auto-passed", { runId: row.id, stepId: step.id });
        return;
      }

      // Script-only steps (e.g. final assembly, music durations) carry a .js
      // "prompt" with no LLM prompt file — node-exec is NOT implemented in v1.
      // Log loudly and advance; do NOT feed JS to an LLM or silently succeed.
      const promptBody = readStepPrompt(PROMPTS_DIR, step.prompt);
      if (promptBody === null) {
        ctx.logger.warn(
          `Step ${step.id} is script-only (${step.prompt}) — node-exec NOT implemented in v1; advancing WITHOUT producing its output. Final package assembly needs this wired.`,
          { runId: row.id, stepId: step.id },
        );
        await markStepAdvanced(ctx, row.id, [...runState.completedStepIds, step.id]);
        return;
      }

      // Resolve the worker agent by name
      const profile = PROFILES[row.profile];
      if (!profile) {
        throw new Error(`Unknown profile: ${row.profile}`);
      }
      const agentName = resolveWorker(step.requiredModel, profile);

      // Use per-tick cache to avoid N identical list calls per tick.
      if (!agentListCache.has(row.company_id)) {
        agentListCache.set(row.company_id, await rest.listAgents(row.company_id));
      }
      const agentList = agentListCache.get(row.company_id)!;
      const agent = agentList.find((a) => a.name === agentName);
      if (!agent) {
        throw new Error(`Worker agent not found: "${agentName}" in company ${row.company_id}`);
      }

      // Read input artifacts from issue documents in parallel
      const inputsMap: Record<string, string> = {};
      if (row.active_issue_id) {
        const issueId = row.active_issue_id;
        const docs = await Promise.all(
          step.inputs.map((n) => rest.getDocument(issueId, artifactDocKey(n))),
        );
        step.inputs.forEach((n, i) => {
          if (docs[i]) inputsMap[n] = docs[i]!.body;
        });
      }

      // Feed the FULL prompt content (not a path) + the output-artifact contract.
      const outputKeys = step.outputs.map((o) => basename(o));
      const promptContent = `${promptBody}\n\n---\n\nWrite your output artifact(s) ${JSON.stringify(outputKeys)} as issue documents keyed "artifact:<name>".`;
      const prompt = assemblePrompt(promptContent, inputsMap);

      const { runId: workerRunId } = await rest.invokeAgent(agent.id, prompt, `globalisto-pipeline:${step.id}`);

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

      // Read output artifacts in parallel
      const artifacts: Record<string, string> = {};
      if (issueId) {
        const docs = await Promise.all(
          step.outputs.map((n) => rest.getDocument(issueId, artifactDocKey(n))),
        );
        step.outputs.forEach((n, i) => {
          if (docs[i]) artifacts[n] = docs[i]!.body;
        });
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

        // Local gate: assemble input via declared gateInputMap, then evaluate.
        // Full per-gate gateInputMap fidelity is validated at the live golden run;
        // gates whose declared artifacts are present now actually evaluate.
        const gateInput = assembleGateInput(
          gateDef.gateInputMap as Record<string, unknown> | undefined,
          artifacts,
        );

        if (Object.keys(gateInput).length === 0) {
          ctx.logger.info(`Gate ${gateId} input unavailable — skipped`, {
            runId: row.id,
            stepId: step.id,
          });
          continue;
        }

        let gateResult;
        try {
          gateResult = runLocalGate(gateId, gateInput, gateDef.params as Record<string, unknown> | undefined);
        } catch (err) {
          ctx.logger.info(`Gate ${gateId} not evaluated: ${String(err)}`, {
            runId: row.id,
            stepId: step.id,
          });
          continue;
        }

        if ("deferred" in gateResult) {
          ctx.logger.info(`Gate ${gateId} not evaluated: ${gateResult.reason}`, {
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
      const completed = [...runState.completedStepIds, step.id];
      await markStepAdvanced(ctx, row.id, completed);

      ctx.logger.info("Step advanced", { runId: row.id, stepId: step.id, completedCount: completed.length });
      return;
    }
  }
}

export default plugin;
runWorker(plugin, import.meta.url);
