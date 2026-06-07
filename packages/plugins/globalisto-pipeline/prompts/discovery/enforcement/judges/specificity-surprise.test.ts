/**
 * Unit Tests for Specificity-Surprise Judge
 *
 * Tests the prompt builder and output parser.
 * The actual LLM call is made via MCP openai2_agent, not tested here.
 *
 * Run with: npx tsx --test judges/specificity-surprise.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildJudgePrompt,
  parseJudgeOutput,
  createJudgeRequest,
  type JudgeInput,
  type JudgeOutput,
} from './specificity-surprise.js';

describe('Specificity-Surprise Judge', () => {
  describe('buildJudgePrompt', () => {
    it('should include original and refined beliefs', () => {
      const input: JudgeInput = {
        original_belief: '65% of Gen Z prefer remote work',
        refined_belief: 'Younger workers prefer remote work',
      };

      const prompt = buildJudgePrompt(input);

      assert.ok(prompt.includes('65% of Gen Z prefer remote work'));
      assert.ok(prompt.includes('Younger workers prefer remote work'));
      assert.ok(prompt.includes('## Original Belief'));
      assert.ok(prompt.includes('## Refined Belief'));
    });

    it('should include wound_summary when provided', () => {
      const input: JudgeInput = {
        original_belief: 'Original belief here',
        refined_belief: 'Refined belief here',
        wound_summary: 'Data was outdated',
      };

      const prompt = buildJudgePrompt(input);

      assert.ok(prompt.includes('Data was outdated'));
      assert.ok(prompt.includes('## Wound Summary'));
    });

    it('should include invalidator_summary when provided', () => {
      const input: JudgeInput = {
        original_belief: 'Original belief here',
        refined_belief: 'Refined belief here',
        invalidator_summary: 'Study was retracted',
      };

      const prompt = buildJudgePrompt(input);

      assert.ok(prompt.includes('Study was retracted'));
      assert.ok(prompt.includes('## Strong Invalidators Found'));
    });

    it('should include collapse flag definitions', () => {
      const input: JudgeInput = {
        original_belief: 'Test',
        refined_belief: 'Test refined',
      };

      const prompt = buildJudgePrompt(input);

      assert.ok(prompt.includes('NUMERIC_DROPPED'));
      assert.ok(prompt.includes('POPULATION_COMPARISON_DROPPED'));
      assert.ok(prompt.includes('MECHANISM_REMOVED'));
      assert.ok(prompt.includes('PARADOX_REMOVED'));
      assert.ok(prompt.includes('BLAMEFRAME_SUBSTITUTION'));
      assert.ok(prompt.includes('VAGUE_ABSTRACTION'));
      assert.ok(prompt.includes('HEDGE_INJECTION'));
      assert.ok(prompt.includes('SCOPE_BROADENED'));
      assert.ok(prompt.includes('UNFALSIFIABLE'));
    });

    it('should include pass criteria', () => {
      const input: JudgeInput = {
        original_belief: 'Test',
        refined_belief: 'Test refined',
      };

      const prompt = buildJudgePrompt(input);

      assert.ok(prompt.includes('Pass Criteria'));
      assert.ok(prompt.includes('falsifiable'));
    });

    it('should request JSON output format', () => {
      const input: JudgeInput = {
        original_belief: 'Test',
        refined_belief: 'Test refined',
      };

      const prompt = buildJudgePrompt(input);

      assert.ok(prompt.includes('JSON'));
      assert.ok(prompt.includes('"pass"'));
      assert.ok(prompt.includes('"specificity_delta"'));
    });
  });

  describe('parseJudgeOutput', () => {
    it('should parse valid JSON output', () => {
      const rawOutput = JSON.stringify({
        pass: false,
        specificity_delta: -2,
        surprise_delta: -1,
        collapse_flags: ['NUMERIC_DROPPED', 'VAGUE_ABSTRACTION'],
        rationale: 'Numbers were removed and claim became vague',
        required_fix: 'Restore the percentage comparison',
      });

      const result = parseJudgeOutput(rawOutput);

      assert.strictEqual(result.pass, false);
      assert.strictEqual(result.specificity_delta, -2);
      assert.strictEqual(result.surprise_delta, -1);
      assert.deepStrictEqual(result.collapse_flags, ['NUMERIC_DROPPED', 'VAGUE_ABSTRACTION']);
      assert.strictEqual(result.rationale, 'Numbers were removed and claim became vague');
      assert.strictEqual(result.required_fix, 'Restore the percentage comparison');
    });

    it('should parse passing judge output', () => {
      const rawOutput = JSON.stringify({
        pass: true,
        specificity_delta: 1,
        surprise_delta: 0,
        collapse_flags: [],
        rationale: 'Refinement added specificity without losing surprise',
      });

      const result = parseJudgeOutput(rawOutput);

      assert.strictEqual(result.pass, true);
      assert.strictEqual(result.specificity_delta, 1);
      assert.strictEqual(result.collapse_flags.length, 0);
      assert.strictEqual(result.required_fix, undefined);
    });

    it('should handle JSON wrapped in markdown code blocks', () => {
      const rawOutput = '```json\n{"pass": true, "specificity_delta": 0, "surprise_delta": 0, "collapse_flags": [], "rationale": "Good"}\n```';

      const result = parseJudgeOutput(rawOutput);

      assert.strictEqual(result.pass, true);
    });

    it('should handle JSON in plain code blocks', () => {
      const rawOutput = '```\n{"pass": false, "specificity_delta": -1, "surprise_delta": -1, "collapse_flags": ["HEDGE_INJECTION"], "rationale": "Hedges added"}\n```';

      const result = parseJudgeOutput(rawOutput);

      assert.strictEqual(result.pass, false);
      assert.deepStrictEqual(result.collapse_flags, ['HEDGE_INJECTION']);
    });

    it('should throw on invalid JSON', () => {
      assert.throws(() => {
        parseJudgeOutput('not valid json');
      });
    });

    it('should throw on missing required fields', () => {
      const rawOutput = JSON.stringify({
        pass: true,
        // missing other required fields
      });

      assert.throws(() => {
        parseJudgeOutput(rawOutput);
      });
    });

    it('should throw on invalid collapse flag', () => {
      const rawOutput = JSON.stringify({
        pass: false,
        specificity_delta: -1,
        surprise_delta: -1,
        collapse_flags: ['INVALID_FLAG'],
        rationale: 'Test',
      });

      assert.throws(() => {
        parseJudgeOutput(rawOutput);
      });
    });

    it('should throw on out-of-range delta', () => {
      const rawOutput = JSON.stringify({
        pass: false,
        specificity_delta: -5, // out of range
        surprise_delta: 0,
        collapse_flags: [],
        rationale: 'Test',
      });

      assert.throws(() => {
        parseJudgeOutput(rawOutput);
      });
    });
  });

  describe('createJudgeRequest', () => {
    it('should create a valid judge request', () => {
      const input: JudgeInput = {
        original_belief: 'Test original',
        refined_belief: 'Test refined',
        wound_summary: 'Some wound',
      };

      const request = createJudgeRequest(input);

      assert.strictEqual(request.needs_judge, true);
      assert.ok(request.judge_prompt.length > 0);
      assert.deepStrictEqual(request.input, input);
    });

    it('should include the prompt in the request', () => {
      const input: JudgeInput = {
        original_belief: 'Specific belief',
        refined_belief: 'Vague belief',
      };

      const request = createJudgeRequest(input);

      assert.ok(request.judge_prompt.includes('Specific belief'));
      assert.ok(request.judge_prompt.includes('Vague belief'));
    });
  });
});

describe('Integration Scenarios', () => {
  describe('Numeric Collapse Detection Prompt', () => {
    it('should produce prompt that covers numeric collapse', () => {
      const input: JudgeInput = {
        original_belief: '65% of Gen Z vs 86% of Millennials prefer remote work for flexibility reasons',
        refined_belief: 'Younger workers prefer remote work differently than older workers',
      };

      const prompt = buildJudgePrompt(input);

      // Prompt should contain context for the judge to detect numeric collapse
      assert.ok(prompt.includes('65%'));
      assert.ok(prompt.includes('86%'));
      assert.ok(prompt.includes('NUMERIC_DROPPED'));
    });
  });

  describe('Paradox Collapse Detection Prompt', () => {
    it('should produce prompt that covers paradox collapse', () => {
      const input: JudgeInput = {
        original_belief: 'Confession culture + burnout paradox: employees who openly discuss burnout get promoted faster',
        refined_belief: 'Leaders are to blame for burnout',
      };

      const prompt = buildJudgePrompt(input);

      assert.ok(prompt.includes('paradox'));
      assert.ok(prompt.includes('PARADOX_REMOVED'));
      assert.ok(prompt.includes('BLAMEFRAME_SUBSTITUTION'));
    });
  });

  describe('Legitimate Refinement Prompt', () => {
    it('should produce prompt for evaluating narrowing refinement', () => {
      const input: JudgeInput = {
        original_belief: 'All remote workers experience isolation',
        refined_belief: 'Remote workers in tech experience isolation during their first 6 months',
        wound_summary: 'Original claim too broad; data only from tech industry',
      };

      const prompt = buildJudgePrompt(input);

      assert.ok(prompt.includes('All remote workers'));
      assert.ok(prompt.includes('first 6 months'));
      assert.ok(prompt.includes('too broad'));
    });
  });
});
