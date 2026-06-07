// Pure engine types for the globalisto content-pipeline conductor.
//
// State lives in ctx.db at runtime; these types are the in-memory shape the
// pure conductor functions in ./engine.ts operate on. Keeping them free of any
// SDK/ctx dependency is what makes the conductor unit-testable in isolation —
// see docs/superpowers/specs/2026-06-07-globalisto-content-pipeline-architecture.md §5.

/** Abstract model "role" a step requires; resolved to a worker agent via a profile. */
export type ModelRole = "opus" | "sonnet" | "deepseek";

/** A single pipeline step from the canonical pipeline-mcp spec. */
export interface StepSpec {
  id: string;
  /** Prompt file path, relative to the vendored prompts dir. */
  prompt: string;
  /** Declared input artifact filenames this step reads. */
  inputs: string[];
  /** Declared output artifact filenames this step writes. */
  outputs: string[];
  /** Abstract model role; mapped to a worker agent id via the active profile. */
  requiredModel: ModelRole;
  /** Gate ids to run after this step completes. */
  gatesAfter: string[];
}

/** Result of executing a step (a worker-agent run). */
export interface StepResult {
  stepId: string;
  /** Output artifact filenames the worker produced. */
  artifacts: string[];
}

/** Resumable conductor state (persisted to ctx.db at runtime). */
export interface PipelineState {
  topic: string;
  /** Active profile name selecting the role -> worker-agent routing. */
  profile: string;
  /** Step ids completed so far (drives resume + nextStep). */
  completedStepIds: string[];
}

/** Maps an abstract model role to the worker-agent id that carries that model. */
export type ModelProfile = Record<ModelRole, string>;

/** Gate verdict action, mirroring the canonical pipeline-mcp gate results. */
export type GateAction = "CONTINUE" | "WARN" | "BLOCK";

/** Result of evaluating a gate. Pure — no IO. */
export interface GateResult {
  pass: boolean;
  action: GateAction;
  reasons: string[];
  metrics?: Record<string, unknown>;
}
