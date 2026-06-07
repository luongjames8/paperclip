/**
 * Discovery Module Enforcement - Independent Verifier
 *
 * Runs at checkpoints to verify pipeline integrity.
 * Operates on STRUCTURED ARTIFACTS ONLY - no prose, no LLM reasoning.
 *
 * Checkpoints:
 *   - after_2b: Sufficiency verification
 *   - after_4d: Bonafide decision verification
 *   - after_5c: Survival verdict verification
 *   - before_6a: Shape/reversal verification
 *
 * Usage via CLI:
 *   npx ts-node verifier.ts <checkpoint> '<json-artifacts>'
 */

import type {
  CheckpointId,
  VerifierResult,
  ArtifactBundle,
  DiscourseItem,
  BonafideScore,
  InterestScore,
  ValidationDecision,
  SurvivalResult,
  CandidateBelief,
  JudgeOutput,
} from './types.js';
import { gateSufficiency, gateBonafide, gateSurvival, gateShape } from './gates.js';
import { createJudgeRequest, type JudgeRequest } from './judges/specificity-surprise.js';

// =============================================================================
// CHECKPOINT: AFTER 2b (Sufficiency)
// =============================================================================

interface After2bArtifacts {
  discourse_items: DiscourseItem[];
  iteration: number;
}

function verifyAfter2b(artifacts: After2bArtifacts): VerifierResult {
  const reasons: string[] = [];

  // Run sufficiency gate
  const gateResult = gateSufficiency({
    discourse_items: artifacts.discourse_items,
    iteration: artifacts.iteration,
  });

  reasons.push(...gateResult.reasons);

  // Additional verification: check for duplicate items
  const itemIds = new Set<string>();
  const duplicates: string[] = [];
  for (const item of artifacts.discourse_items) {
    if (itemIds.has(item.id)) {
      duplicates.push(item.id);
    }
    itemIds.add(item.id);
  }

  if (duplicates.length > 0) {
    reasons.push(`WARNING: Duplicate item IDs: ${duplicates.join(', ')}`);
  }

  // Check for suspiciously similar content (potential LLM hallucination)
  const contentHashes = new Map<string, string>();
  for (const item of artifacts.discourse_items) {
    const normalizedContent = item.content.toLowerCase().slice(0, 100);
    if (contentHashes.has(normalizedContent)) {
      reasons.push(`WARNING: Similar content between ${contentHashes.get(normalizedContent)} and ${item.id}`);
    }
    contentHashes.set(normalizedContent, item.id);
  }

  return {
    checkpoint: 'after_2b',
    passed: gateResult.pass,
    reasons,
    terminal: !gateResult.pass && artifacts.iteration >= 3,
  };
}

// =============================================================================
// CHECKPOINT: AFTER 4d (Bonafide Decision)
// =============================================================================

interface After4dArtifacts {
  candidate: CandidateBelief;
  bonafide: BonafideScore;
  interest: InterestScore;
  decision: ValidationDecision;
  all_candidates: CandidateBelief[];
}

function verifyAfter4d(artifacts: After4dArtifacts): VerifierResult {
  const reasons: string[] = [];
  let override: VerifierResult['override'];

  // Run bonafide gate
  const gateResult = gateBonafide({
    bonafide: artifacts.bonafide,
    interest: artifacts.interest,
    llm_decision: artifacts.decision,
  });

  reasons.push(...gateResult.reasons);

  // Apply override if needed
  if (gateResult.override) {
    override = gateResult.override;
    reasons.push(`Verifier override: ${gateResult.override.field} changed from ${gateResult.override.original_value} to ${gateResult.override.new_value}`);
  }

  // Cross-check: verify decision consistency
  const { bonafide, interest, decision } = artifacts;

  // Additional verification: check for rationalization patterns
  if (bonafide.level === 'LOW' && decision === 'GO') {
    reasons.push('CRITICAL: LLM rationalized LOW bonafide to GO - this is forbidden');
    override = {
      field: 'decision',
      original_value: decision,
      new_value: 'NO-GO',
    };
  }

  if (interest.level === 'LOW' && decision === 'GO') {
    reasons.push('CRITICAL: LLM rationalized LOW interest to GO - this is forbidden');
    override = {
      field: 'decision',
      original_value: decision,
      new_value: 'NO-GO',
    };
  }

  // Check for INTERESTING veto if applicable
  const otherInteresting = artifacts.all_candidates.filter(
    (c) => c.id !== artifacts.candidate.id && c.novelty === 'INTERESTING'
  );

  if (artifacts.candidate.novelty === 'PREDICTABLE' && otherInteresting.length > 0 && decision !== 'NO-GO') {
    reasons.push('WARNING: PREDICTABLE candidate approved while INTERESTING candidates exist');
  }

  return {
    checkpoint: 'after_4d',
    passed: gateResult.pass && !override,
    reasons,
    override,
  };
}

// =============================================================================
// CHECKPOINT: AFTER 5c (Survival Verdict)
// =============================================================================

interface After5cArtifacts {
  survival_result: SurvivalResult;
  original_belief: string;
}

function verifyAfter5c(artifacts: After5cArtifacts): VerifierResult {
  const reasons: string[] = [];
  let override: VerifierResult['override'];
  let judgeRequest: JudgeRequest | undefined;

  const { survival_result } = artifacts;

  // Run survival gate
  const gateResult = gateSurvival({ survival_result });
  reasons.push(...gateResult.reasons);

  if (gateResult.override) {
    override = gateResult.override;
  }

  // If WOUNDED, verify refinement quality
  if (survival_result.verdict === 'WOUNDED' && survival_result.refined_belief) {
    // Check that refined belief is different
    if (survival_result.refined_belief === artifacts.original_belief) {
      reasons.push('CRITICAL: WOUNDED verdict but belief unchanged');
      override = {
        field: 'verdict',
        original_value: 'WOUNDED',
        new_value: 'KILLED',
      };
    }

    // Check refinement didn't just add hedges
    const hedgePatterns = [
      /sometimes/i,
      /often/i,
      /in some cases/i,
      /depending on/i,
    ];

    const originalHedges = hedgePatterns.filter((p) => p.test(artifacts.original_belief)).length;
    const refinedHedges = hedgePatterns.filter((p) => p.test(survival_result.refined_belief!)).length;

    if (refinedHedges > originalHedges) {
      reasons.push('WARNING: Refined belief added hedge language');
      reasons.push(`Hedge count: original=${originalHedges}, refined=${refinedHedges}`);
    }

    // Check refinement preserved core claim
    const originalWords = new Set(artifacts.original_belief.toLowerCase().split(/\s+/));
    const refinedWords = new Set(survival_result.refined_belief.toLowerCase().split(/\s+/));
    const overlap = [...originalWords].filter((w) => refinedWords.has(w)).length;
    const overlapRatio = overlap / originalWords.size;

    if (overlapRatio < 0.3) {
      reasons.push('WARNING: Refined belief may have changed meaning entirely');
      reasons.push(`Word overlap: ${Math.round(overlapRatio * 100)}%`);
    }

    // Request external specificity-surprise judge (only if not already killed by above checks)
    // Claude will make the MCP call and feed the result back
    if (!override || override.new_value !== 'KILLED') {
      judgeRequest = createJudgeRequest({
        original_belief: artifacts.original_belief,
        refined_belief: survival_result.refined_belief,
        wound_summary: survival_result.reasons.join('; '),
        invalidator_summary: survival_result.invalidators
          .filter((i) => i.strength === 'STRONG')
          .map((i) => i.claim)
          .slice(0, 3)
          .join('; '),
      });
      reasons.push('PENDING: Specificity judge call required via mcp__openai-agent__openai2_agent');
    }
  }

  // Check SURVIVES isn't used inappropriately
  if (survival_result.verdict === 'SURVIVES' && survival_result.strong_invalidator_count > 0) {
    reasons.push(`WARNING: SURVIVES with ${survival_result.strong_invalidator_count} STRONG invalidators`);
    if (survival_result.strong_invalidator_count >= 2) {
      reasons.push('CRITICAL: SURVIVES with 2+ STRONG invalidators is forbidden');
      override = {
        field: 'verdict',
        original_value: 'SURVIVES',
        new_value: 'WOUNDED',
      };
    }
  }

  const finalVerdict = override?.new_value ?? survival_result.verdict;
  const terminal = finalVerdict === 'KILLED';

  return {
    checkpoint: 'after_5c',
    passed: !terminal,
    reasons,
    override,
    terminal,
    judge_request: judgeRequest,
  };
}

// =============================================================================
// CHECKPOINT: BEFORE 6a (Shape/Reversal)
// =============================================================================

interface Before6aArtifacts {
  belief: string;
  survival_verdict: 'SURVIVES' | 'WOUNDED';
  refined_belief?: string;
}

function verifyBefore6a(artifacts: Before6aArtifacts): VerifierResult {
  const reasons: string[] = [];

  const belief = artifacts.refined_belief ?? artifacts.belief;

  // Run shape gate
  const gateResult = gateShape({ belief });
  reasons.push(...gateResult.reasons);

  // Additional checks for belief quality
  // Check belief length (too short = vague, too long = hedged)
  if (belief.length < 20) {
    reasons.push('WARNING: Belief too short - may be vague');
  }
  if (belief.length > 200) {
    reasons.push('WARNING: Belief too long - may contain hedges');
  }

  // Check for reversal patterns (LLM trying to flip the belief)
  const reversalPatterns = [
    /actually (not|isn't|doesn't)/i,
    /the opposite/i,
    /contrary to/i,
    /in fact,? (not|no)/i,
  ];

  for (const pattern of reversalPatterns) {
    if (pattern.test(belief)) {
      reasons.push(`WARNING: Belief contains reversal pattern: ${pattern.source}`);
    }
  }

  // Check for meta-commentary (LLM talking about beliefs instead of stating one)
  const metaPatterns = [
    /people (think|believe|say)/i,
    /it is (thought|believed|said)/i,
    /the belief that/i,
    /this belief/i,
  ];

  for (const pattern of metaPatterns) {
    if (pattern.test(belief)) {
      reasons.push(`WARNING: Belief contains meta-commentary: ${pattern.source}`);
    }
  }

  return {
    checkpoint: 'before_6a',
    passed: gateResult.pass,
    reasons,
    terminal: !gateResult.pass,
  };
}

// =============================================================================
// MAIN VERIFIER
// =============================================================================

type CheckpointArtifacts =
  | { checkpoint: 'after_2b'; data: After2bArtifacts }
  | { checkpoint: 'after_4d'; data: After4dArtifacts }
  | { checkpoint: 'after_5c'; data: After5cArtifacts }
  | { checkpoint: 'before_6a'; data: Before6aArtifacts };

/**
 * Run verifier at a checkpoint
 */
export function runVerifier(input: CheckpointArtifacts): VerifierResult {
  switch (input.checkpoint) {
    case 'after_2b':
      return verifyAfter2b(input.data);
    case 'after_4d':
      return verifyAfter4d(input.data);
    case 'after_5c':
      return verifyAfter5c(input.data);
    case 'before_6a':
      return verifyBefore6a(input.data);
    default:
      throw new Error(`Unknown checkpoint: ${(input as { checkpoint: string }).checkpoint}`);
  }
}

/**
 * Run verifier with artifact bundle (for integration with artifact store)
 */
export function runVerifierFromBundle(
  checkpoint: CheckpointId,
  bundle: ArtifactBundle
): VerifierResult {
  // Extract relevant artifacts based on checkpoint
  // This is a stub - actual implementation would parse the bundle

  throw new Error('Not implemented: runVerifierFromBundle');
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (process.argv[1]?.includes('verifier')) {
  const [, , checkpoint, inputJson] = process.argv;

  if (!checkpoint || !inputJson) {
    console.log('Usage: npx ts-node verifier.ts <checkpoint> \'<json-artifacts>\'');
    console.log('');
    console.log('Checkpoints:');
    console.log('  - after_2b: Sufficiency verification');
    console.log('  - after_4d: Bonafide decision verification');
    console.log('  - after_5c: Survival verdict verification');
    console.log('  - before_6a: Shape/reversal verification');
    process.exit(1);
  }

  try {
    const data = JSON.parse(inputJson);
    const result = runVerifier({ checkpoint: checkpoint as CheckpointId, data });
    console.log(JSON.stringify(result, null, 2));

    // Exit with error if terminal
    if (result.terminal) {
      process.exit(2);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
