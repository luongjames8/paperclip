/**
 * Discovery Module Enforcement - Pipeline Runner
 *
 * Orchestrates the discovery pipeline with gate enforcement.
 * This module is called by Claude Code to coordinate LLM execution
 * with deterministic gate checks.
 *
 * Architecture:
 * - Claude Code reads step prompts and executes LLM calls
 * - After each step, Claude Code calls the appropriate gate
 * - Gate results are authoritative - Claude MUST respect them
 * - Artifacts are stored for audit trail
 *
 * Usage via CLI:
 *   npx ts-node runner.ts init '<discovery-input-json>'
 *   npx ts-node runner.ts step <step-id> '<output-json>'
 *   npx ts-node runner.ts status
 *   npx ts-node runner.ts finalize
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import type {
  DiscoveryInput,
  DiscoveryOutput,
  DiscoveryConfig,
  DiscoveryResult,
  DiscoveryDebug,
  PipelineState,
  GateResult,
  VerifierResult,
  CandidateBelief,
  DiscourseItem,
  SurvivalResult,
  ValidationResult,
} from './types.js';
import { DiscoveryInputSchema, DiscoveryConfigSchema, StepSchemas, validateStepOutput } from './schemas.js';
import { ArtifactStore, createArtifactStore } from './artifact-store.js';
import {
  gateSufficiency,
  gateBonafide,
  gateNovelty,
  gateSurvival,
  gateRefinementSharpness,
  gateShape,
  gateAllKilled,
  gateInterestingVeto,
} from './gates.js';
import { runVerifier } from './verifier.js';

// =============================================================================
// PIPELINE STATE
// =============================================================================

interface PipelineContext {
  input: DiscoveryInput;
  config: DiscoveryConfig;
  state: PipelineState;
  iteration: number;
  retryCount: number;

  // Phase artifacts
  discourse_items: DiscourseItem[];
  candidates: CandidateBelief[];
  validation_results: ValidationResult[];
  survival_results: SurvivalResult[];
  surviving_belief?: CandidateBelief;
  final_result?: DiscoveryResult;

  // Logs
  gate_log: GateResult[];
  verifier_log: VerifierResult[];

  // Store reference
  artifactStore: ArtifactStore;
}

const DEFAULT_CONFIG: DiscoveryConfig = {
  min_sincere_items: 3,
  min_sources: 2,
  max_candidates: 10,
  hot_threshold_months: 6,
  concurrency: {
    max_parallel_searches: 3,
    max_parallel_fetches: 2,
    max_parallel_candidates: 2,
    max_parallel_items: 3,
  },
};

// =============================================================================
// PIPELINE MANAGEMENT
// =============================================================================

let currentContext: PipelineContext | null = null;
let contextFilePath: string | null = null;

function getContextPath(workDir: string): string {
  return join(workDir, '.discovery_context.yaml');
}

function getArtifactPath(workDir: string): string {
  return join(workDir, '.discovery_artifacts.yaml');
}

/**
 * Initialize a new discovery pipeline
 */
export function initPipeline(input: DiscoveryInput, workDir: string = '.'): PipelineContext {
  // Validate input
  const validatedInput = DiscoveryInputSchema.parse(input);
  const config = validatedInput.config
    ? { ...DEFAULT_CONFIG, ...validatedInput.config }
    : DEFAULT_CONFIG;

  // Create artifact store
  const artifactPath = getArtifactPath(workDir);
  const artifactStore = createArtifactStore(artifactPath);

  const context: PipelineContext = {
    input: validatedInput,
    config,
    state: 'INIT',
    iteration: 0,
    retryCount: 0,
    discourse_items: [],
    candidates: [],
    validation_results: [],
    survival_results: [],
    gate_log: [],
    verifier_log: [],
    artifactStore,
  };

  // Store initial input as artifact
  artifactStore.write('init', {
    input: validatedInput,
    config,
    timestamp: new Date().toISOString(),
  });

  currentContext = context;
  contextFilePath = getContextPath(workDir);
  saveContext(context);

  return context;
}

/**
 * Load existing pipeline context
 */
export function loadContext(workDir: string = '.'): PipelineContext | null {
  const path = getContextPath(workDir);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    const data = yaml.load(content) as Omit<PipelineContext, 'artifactStore'>;

    // Reconnect artifact store
    const artifactPath = getArtifactPath(workDir);
    const artifactStore = createArtifactStore(artifactPath);

    currentContext = { ...data, artifactStore };
    contextFilePath = path;

    return currentContext;
  } catch (error) {
    console.error('Failed to load context:', error);
    return null;
  }
}

/**
 * Save pipeline context
 */
function saveContext(context: PipelineContext): void {
  if (!contextFilePath) return;

  const dir = dirname(contextFilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Don't serialize the artifact store
  const { artifactStore, ...contextToSave } = context;
  writeFileSync(contextFilePath, yaml.dump(contextToSave, { lineWidth: -1 }));
}

/**
 * Get current pipeline status
 */
export function getStatus(): {
  state: PipelineState;
  iteration: number;
  candidates: number;
  survivors: number;
  gates_passed: number;
  gates_failed: number;
} {
  if (!currentContext) {
    throw new Error('No active pipeline. Run init first.');
  }

  const gatesPassed = currentContext.gate_log.filter((g) => g.pass).length;
  const gatesFailed = currentContext.gate_log.filter((g) => !g.pass).length;
  const survivors = currentContext.survival_results.filter((s) => s.verdict !== 'KILLED').length;

  return {
    state: currentContext.state,
    iteration: currentContext.iteration,
    candidates: currentContext.candidates.length,
    survivors,
    gates_passed: gatesPassed,
    gates_failed: gatesFailed,
  };
}

// =============================================================================
// STEP PROCESSING
// =============================================================================

/**
 * Process step output and run appropriate gate
 */
export function processStepOutput(stepId: string, output: unknown): {
  valid: boolean;
  gate_result?: GateResult;
  verifier_result?: VerifierResult;
  errors?: string[];
  next_action?: 'CONTINUE' | 'LOOP' | 'STOP' | 'BLOCK';
  next_target?: string;
} {
  if (!currentContext) {
    throw new Error('No active pipeline. Run init first.');
  }

  // Check dependency: previous step's gate must have been called
  const requiredPrev = STEP_DEPENDENCIES[stepId];
  if (requiredPrev) {
    const prevArtifactExists = currentContext.artifactStore.getByStep(requiredPrev).length > 0;
    if (!prevArtifactExists) {
      return {
        valid: false,
        errors: [
          `Gate artifact missing for step ${requiredPrev}. Did you skip a gate call?`,
          `You MUST call the gate for step ${requiredPrev} before proceeding to step ${stepId}.`,
          `If the gate call failed technically, STOP and report the error to the user.`,
        ],
      };
    }
  }

  // Validate output against schema
  const schema = StepSchemas[stepId];
  if (schema) {
    const validation = validateStepOutput(stepId, output, schema);
    if (!validation.success) {
      return { valid: false, errors: validation.errors };
    }
  }

  // Store artifact
  currentContext.artifactStore.write(stepId, output);

  // Process based on step
  let gateResult: GateResult | undefined;
  let verifierResult: VerifierResult | undefined;

  switch (stepId) {
    case '2b':
      gateResult = handleStep2b(output);
      verifierResult = runVerifier({
        checkpoint: 'after_2b',
        data: {
          discourse_items: currentContext.discourse_items,
          iteration: currentContext.iteration,
        },
      });
      break;

    case '2d':
      gateResult = handleStep2d(output);
      break;

    case '4d':
      gateResult = handleStep4d(output);
      break;

    case '5c':
      gateResult = handleStep5c(output);
      verifierResult = runVerifier({
        checkpoint: 'after_5c',
        data: {
          survival_result: output as SurvivalResult,
          original_belief: currentContext.surviving_belief?.belief ?? '',
        },
      });
      break;

    case '6a':
      // Pre-6a shape gate
      const shapeGate = gateShape({ belief: currentContext.surviving_belief?.belief ?? '' });
      if (!shapeGate.pass) {
        gateResult = shapeGate;
      }
      break;
  }

  // Log results
  if (gateResult) {
    currentContext.gate_log.push(gateResult);
  }
  if (verifierResult) {
    currentContext.verifier_log.push(verifierResult);
  }

  // Determine next action
  let nextAction: 'CONTINUE' | 'LOOP' | 'STOP' | 'BLOCK' = 'CONTINUE';
  let nextTarget: string | undefined;

  if (gateResult?.action) {
    switch (gateResult.action.type) {
      case 'CONTINUE':
        nextAction = 'CONTINUE';
        break;
      case 'LOOP':
        nextAction = 'LOOP';
        nextTarget = gateResult.action.target;
        break;
      case 'STOP':
        nextAction = 'STOP';
        break;
      case 'BLOCK':
        nextAction = 'BLOCK';
        currentContext.state = 'BLOCKED';
        break;
    }
  }

  if (verifierResult?.terminal) {
    nextAction = 'BLOCK';
    currentContext.state = 'BLOCKED';
  }

  saveContext(currentContext);

  return {
    valid: true,
    gate_result: gateResult,
    verifier_result: verifierResult,
    next_action: nextAction,
    next_target: nextTarget,
  };
}

// =============================================================================
// STEP HANDLERS
// =============================================================================

function handleStep2b(output: unknown): GateResult {
  const data = output as { status: string; discourse_items?: DiscourseItem[] };

  if (data.status === 'SUFFICIENT' && data.discourse_items) {
    currentContext!.discourse_items = data.discourse_items;
  }

  currentContext!.iteration++;

  return gateSufficiency({
    discourse_items: currentContext!.discourse_items,
    iteration: currentContext!.iteration,
    config: {
      min_items: 25,           // Up from 15 - feeds belief funnel
      min_reddit_forum: 8,     // Up from 5 - first-person voices
      min_fetched: 5,          // Up from 3 - depth
      min_source_types: 4,     // Up from 3 - diversity
      max_iterations: 3,
    },
  });
}

function handleStep2d(output: unknown): GateResult {
  const data = output as {
    has_interesting: boolean;
    novelty_ratings: Array<{ belief_id: string; novelty: 'PREDICTABLE' | 'INTERESTING' }>;
    recommendation: 'CONTINUE' | 'STOP';
  };

  return gateNovelty({
    novelty_ratings: data.novelty_ratings,
    iteration: currentContext!.iteration,
    max_iterations: 3,
  });
}

function handleStep4d(output: unknown): GateResult {
  const data = output as ValidationResult;

  // Run bonafide gate
  const bonafideGate = gateBonafide({
    bonafide: data.bonafide,
    interest: data.interest,
    llm_decision: data.decision,
  });

  // If passed, also check interesting veto
  if (bonafideGate.pass && currentContext!.candidates.length > 0) {
    const currentCandidate = currentContext!.candidates.find((c) => c.id === data.belief_id);
    if (currentCandidate) {
      const vetoGate = gateInterestingVeto({
        all_candidates: currentContext!.candidates,
        current_candidate_id: data.belief_id,
        current_novelty: currentCandidate.novelty,
      });

      if (!vetoGate.pass) {
        return vetoGate;
      }
    }
  }

  return bonafideGate;
}

function handleStep5c(output: unknown): GateResult {
  const data = output as SurvivalResult;

  // Add to survival results
  currentContext!.survival_results.push(data);

  // Run survival gate
  const survivalGate = gateSurvival({ survival_result: data });

  // If WOUNDED, check refinement sharpness
  if (data.verdict === 'WOUNDED' && data.refined_belief) {
    const sharpnessGate = gateRefinementSharpness({
      original_belief: data.original_belief,
      refined_belief: data.refined_belief,
    });

    if (!sharpnessGate.pass) {
      // Override verdict to KILLED
      data.verdict = 'KILLED';
      return sharpnessGate;
    }
  }

  // Check if all are killed after this result
  const allResults = currentContext!.survival_results;
  if (allResults.every((r) => r.verdict === 'KILLED')) {
    return gateAllKilled({
      survival_results: allResults,
      coverage_changed: false, // Would need to track this
      retry_count: currentContext!.retryCount,
      max_retries: 2,
    });
  }

  return survivalGate;
}

// =============================================================================
// FINALIZATION
// =============================================================================

/**
 * Finalize the pipeline and generate outputs
 */
export function finalize(): DiscoveryOutput {
  if (!currentContext) {
    throw new Error('No active pipeline. Run init first.');
  }

  // Freeze all artifacts
  currentContext.artifactStore.freezeAll();

  // Build debug output
  const debug: DiscoveryDebug = {
    mode: currentContext.input.mode,
    input_topic: currentContext.input.topic,
    input_belief: currentContext.input.candidate_belief,
    phase_4_validation: currentContext.validation_results,
    phase_5_invalidation: currentContext.survival_results,
    final_belief: currentContext.surviving_belief?.belief,
    selection_reason: `Selected via ${currentContext.surviving_belief?.source_path} path with ${currentContext.surviving_belief?.novelty} novelty`,
    artifacts: currentContext.artifactStore.exportForDebug(),
    gate_log: currentContext.gate_log,
    verifier_log: currentContext.verifier_log,
  };

  // Determine final status
  if (currentContext.state === 'BLOCKED') {
    return {
      status: 'FAILED',
      debug,
      error: 'Pipeline blocked by gate',
    };
  }

  if (!currentContext.final_result) {
    return {
      status: 'FAILED',
      debug,
      error: 'No final result generated',
    };
  }

  currentContext.state = 'SUCCESS';
  saveContext(currentContext);

  return {
    status: 'SUCCESS',
    result: currentContext.final_result,
    debug,
  };
}

/**
 * Set the final result (after Phase 6)
 */
export function setFinalResult(result: DiscoveryResult): void {
  if (!currentContext) {
    throw new Error('No active pipeline. Run init first.');
  }

  currentContext.final_result = result;
  currentContext.artifactStore.write('final_result', result);
  saveContext(currentContext);
}

/**
 * Set surviving belief (after Phase 5)
 */
export function setSurvivingBelief(candidate: CandidateBelief): void {
  if (!currentContext) {
    throw new Error('No active pipeline. Run init first.');
  }

  currentContext.surviving_belief = candidate;
  saveContext(currentContext);
}

/**
 * Set candidates (after Phase 3)
 */
export function setCandidates(candidates: CandidateBelief[]): void {
  if (!currentContext) {
    throw new Error('No active pipeline. Run init first.');
  }

  currentContext.candidates = candidates;
  currentContext.artifactStore.write('candidates', candidates);
  saveContext(currentContext);
}

// =============================================================================
// STEP DEPENDENCIES (for artifact verification)
// =============================================================================

const STEP_DEPENDENCIES: Record<string, string> = {
  '2d': '2b', // 2d requires 2b gate to have run
  '4d': '2d', // 4d requires 2d gate
  '5c': '4d', // 5c requires 4d gate
  '6a': '5c', // 6a requires 5c gate
};

// =============================================================================
// CLI INTERFACE
// =============================================================================

/**
 * Resolve argument - supports @filepath convention for reading from files
 * This avoids Windows command-line JSON escaping issues
 */
function resolveArg(arg: string): string {
  if (arg && arg.startsWith('@')) {
    const filepath = arg.slice(1);
    return readFileSync(filepath, 'utf-8');
  }
  return arg;
}

if (process.argv[1]?.includes('runner')) {
  const [, , command, ...args] = process.argv;

  try {
    switch (command) {
      case 'init': {
        const input = JSON.parse(resolveArg(args[0]));
        const workDir = args[1] || '.';
        const context = initPipeline(input, workDir);
        console.log(JSON.stringify({ status: 'initialized', state: context.state }, null, 2));
        break;
      }

      case 'step': {
        const workDir = '.';
        if (!loadContext(workDir)) {
          console.error('No active pipeline. Run init first.');
          process.exit(1);
        }
        const stepId = args[0];
        const output = JSON.parse(resolveArg(args[1]));
        const result = processStepOutput(stepId, output);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'status': {
        const workDir = '.';
        if (!loadContext(workDir)) {
          console.error('No active pipeline. Run init first.');
          process.exit(1);
        }
        const status = getStatus();
        console.log(JSON.stringify(status, null, 2));
        break;
      }

      case 'finalize': {
        const workDir = '.';
        if (!loadContext(workDir)) {
          console.error('No active pipeline. Run init first.');
          process.exit(1);
        }
        const output = finalize();
        console.log(JSON.stringify(output, null, 2));
        break;
      }

      default:
        console.log('Usage:');
        console.log('  npx ts-node runner.ts init \'<discovery-input-json>\' [workDir]');
        console.log('  npx ts-node runner.ts step <step-id> \'<output-json>\'');
        console.log('  npx ts-node runner.ts status');
        console.log('  npx ts-node runner.ts finalize');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
