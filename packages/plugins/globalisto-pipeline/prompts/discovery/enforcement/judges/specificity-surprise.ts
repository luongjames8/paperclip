/**
 * Specificity-Surprise Judge
 *
 * External pairwise judge that compares original vs refined beliefs.
 * Blocks refinements that collapse specificity or surprise.
 *
 * This module provides:
 * 1. Type definitions for judge input/output
 * 2. Prompt builder for invoking via mcp__openai-agent__openai2_agent
 * 3. Output parser/validator
 *
 * The actual LLM call is made by Claude via MCP, not by this code directly.
 */

import { JudgeOutputSchema, type CollapseFlagSchema } from '../schemas.js';
import type { z } from 'zod';

// =============================================================================
// TYPES
// =============================================================================

export type CollapseFlag = z.infer<typeof CollapseFlagSchema>;

export interface JudgeInput {
  original_belief: string;
  refined_belief: string;
  wound_summary?: string;
  invalidator_summary?: string;
}

export interface JudgeOutput {
  pass: boolean;
  specificity_delta: -2 | -1 | 0 | 1 | 2;
  surprise_delta: -2 | -1 | 0 | 1 | 2;
  collapse_flags: CollapseFlag[];
  rationale: string;
  required_fix?: string;
}

/**
 * Result from verifier indicating judge call is needed
 */
export interface JudgeRequest {
  needs_judge: true;
  judge_prompt: string;
  input: JudgeInput;
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const SYSTEM_PROMPT = `You are a strict pairwise judge comparing belief refinements for a content discovery pipeline.

Your job is to FAIL refinements that collapse specificity or surprise. The refined belief should NOT be vaguer, more generic, or less falsifiable than the original.

## Collapse Flags (use these codes in your response)

- NUMERIC_DROPPED: Specific numbers, percentages, or statistics were removed
- POPULATION_COMPARISON_DROPPED: A specific cohort comparison (e.g., "Gen Z vs Millennials") was removed or generalized
- MECHANISM_REMOVED: A specific causal mechanism or explanation was removed
- PARADOX_REMOVED: A tension, contradiction, or paradox structure was removed
- BLAMEFRAME_SUBSTITUTION: Belief was transformed into a blame-frame (e.g., "Leaders are to blame")
- VAGUE_ABSTRACTION: Specific claim collapsed into abstract/vague framing
- HEDGE_INJECTION: Hedges like "sometimes", "often", "it depends" were added
- SCOPE_BROADENED: Claim was broadened from specific scope to general
- UNFALSIFIABLE: Refined belief cannot be falsified with evidence

## Scoring

- specificity_delta: -2 (much less specific) to +2 (much more specific)
- surprise_delta: -2 (much less surprising) to +2 (much more surprising)

## Pass Criteria (ALL must be true for pass=true)

1. Refined is NOT broader than original
2. At least as falsifiable as original
3. Specific anchors preserved (numbers, cohorts, mechanisms) OR replaced with equally specific alternatives
4. Tension/paradox structure preserved if present in original
5. No vibe collapse into general framing
6. No hedge injection

## Output Format

Respond with ONLY valid JSON (no markdown, no explanation) matching this schema:
{
  "pass": boolean,
  "specificity_delta": integer -2 to 2,
  "surprise_delta": integer -2 to 2,
  "collapse_flags": string[],
  "rationale": string (max 500 chars),
  "required_fix": string (optional, only if pass=false)
}`;

// =============================================================================
// PROMPT BUILDER
// =============================================================================

/**
 * Build the full prompt for the judge.
 * This prompt should be sent to mcp__openai-agent__openai2_agent.
 */
export function buildJudgePrompt(input: JudgeInput): string {
  let userSection = `Compare these two beliefs and determine if the refinement preserves specificity and surprise.

## Original Belief
${input.original_belief}

## Refined Belief
${input.refined_belief}`;

  if (input.wound_summary) {
    userSection += `

## Wound Summary (why refinement was needed)
${input.wound_summary}`;
  }

  if (input.invalidator_summary) {
    userSection += `

## Strong Invalidators Found
${input.invalidator_summary}`;
  }

  // Combine system and user into single prompt for mcp__openai-agent__openai2_agent
  return `${SYSTEM_PROMPT}

---

${userSection}

Respond with JSON only.`;
}

/**
 * Create a judge request that signals the verifier needs an external judge call.
 * Claude will use this to invoke the mcp__openai-agent__openai2_agent.
 */
export function createJudgeRequest(input: JudgeInput): JudgeRequest {
  return {
    needs_judge: true,
    judge_prompt: buildJudgePrompt(input),
    input,
  };
}

// =============================================================================
// OUTPUT PARSER
// =============================================================================

/**
 * Parse and validate the raw output from the MCP agent.
 * Call this after receiving the response from mcp__openai-agent__openai2_agent.
 */
export function parseJudgeOutput(rawOutput: string): JudgeOutput {
  // Try to extract JSON from the response (may have markdown wrapper)
  let jsonStr = rawOutput.trim();

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  const validated = JudgeOutputSchema.parse(parsed);

  return {
    pass: validated.pass,
    specificity_delta: validated.specificity_delta as -2 | -1 | 0 | 1 | 2,
    surprise_delta: validated.surprise_delta as -2 | -1 | 0 | 1 | 2,
    collapse_flags: validated.collapse_flags as CollapseFlag[],
    rationale: validated.rationale,
    required_fix: validated.required_fix,
  };
}

// =============================================================================
// CONVENIENCE: Combined runner (for when called directly by Claude)
// =============================================================================

/**
 * Process a judge request and parse the response.
 * This is a helper for when Claude has already made the MCP call.
 *
 * @param mcpResponse The raw text response from mcp__openai-agent__openai2_agent
 * @returns Parsed and validated judge output
 */
export function processJudgeResponse(mcpResponse: string): JudgeOutput {
  return parseJudgeOutput(mcpResponse);
}

// =============================================================================
// CLI INTERFACE (for manual testing)
// =============================================================================

// Only run CLI when directly executed (not when imported for tests)
const isDirectExecution = process.argv[1]?.endsWith('specificity-surprise.ts') ||
  process.argv[1]?.endsWith('specificity-surprise.js');

if (isDirectExecution && !process.argv[1]?.includes('.test.')) {
  const [, , command, inputJson] = process.argv;

  if (command === 'prompt' && inputJson) {
    // Generate the prompt to send to MCP
    try {
      const input = JSON.parse(inputJson) as JudgeInput;
      const prompt = buildJudgePrompt(input);
      console.log(prompt);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else if (command === 'parse' && inputJson) {
    // Parse a response from MCP
    try {
      const output = parseJudgeOutput(inputJson);
      console.log(JSON.stringify(output, null, 2));
      process.exit(output.pass ? 0 : 1);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else {
    console.log('Usage:');
    console.log('  npx tsx judges/specificity-surprise.ts prompt \'<input-json>\'  - Generate prompt for MCP');
    console.log('  npx tsx judges/specificity-surprise.ts parse \'<response>\'     - Parse MCP response');
    console.log('');
    console.log('Input JSON format:');
    console.log('  {');
    console.log('    "original_belief": "...",');
    console.log('    "refined_belief": "...",');
    console.log('    "wound_summary": "..." (optional),');
    console.log('    "invalidator_summary": "..." (optional)');
    console.log('  }');
    process.exit(1);
  }
}
