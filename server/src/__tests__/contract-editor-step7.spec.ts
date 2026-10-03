// Contract: content-editor skill "Create Scheduler + Approval" step must invoke editor-create-approval.js
// and must not provide any path for the LLM to call POST /api/issues or POST /approvals directly.
//
// Regression: LLM created Issues titled "Approval" instead of running the deterministic script.
// Filed 3× in 24h before this contract was added (2026-04-28).
//
// FIXTURE: locked from production DB 2026-04-28. To update: re-run the psql dump command at the top of
// helpers/content-editor-skill-fixture.md and re-verify these invariants still hold.
//
// MUTATION PINS (confirm RED before merging any skill body change):
//   Pin 1: remove the `editor-create-approval.js` line from the fixture → "exactly one script invocation" fails
//   Pin 2: add a line `POST /api/issues` inside the STEP 5 section → "zero direct POST /api/issues" fails

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "helpers", "content-editor-skill-fixture.md");

const APPROVAL_STEP_HEADING = "## STEP 5 — Create Scheduler + Approval (deterministic)";
const NEXT_STEP_HEADING = "## STEP 6 —";

async function loadSkill(): Promise<string> {
  return fs.readFile(FIXTURE_PATH, "utf8");
}

function extractStep5(markdown: string): string {
  const start = markdown.indexOf(APPROVAL_STEP_HEADING);
  if (start === -1) throw new Error("STEP 5 heading not found in skill fixture");
  const end = markdown.indexOf(NEXT_STEP_HEADING, start);
  if (end === -1) throw new Error("STEP 6 heading not found after STEP 5 in skill fixture");
  return markdown.slice(start, end);
}

describe("content-editor skill — STEP 5 (Create Scheduler + Approval) contract", () => {
  it("fixture loads and contains both STEP 5 and STEP 6 headings", async () => {
    const markdown = await loadSkill();
    expect(markdown).toContain(APPROVAL_STEP_HEADING);
    expect(markdown).toContain(NEXT_STEP_HEADING);
  });

  it("contains exactly one editor-create-approval.js script invocation (mutation pin 1: remove invocation → RED)", async () => {
    const step = extractStep5(await loadSkill());
    const matches = [...step.matchAll(/editor-create-approval\.js/g)];
    expect(matches).toHaveLength(1);
  });

  it("contains zero direct POST /api/issues instructions (mutation pin 2: add POST /api/issues → RED)", async () => {
    const step = extractStep5(await loadSkill());
    expect(step).not.toMatch(/POST\s+\/api\/issues/);
  });

  it("any POST /approvals mention in STEP 5 must be a prohibition, not an instruction", async () => {
    const step = extractStep5(await loadSkill());
    const lines = step.split("\n");
    const approvalPostLines = lines.filter((l) => /POST\s+\/approvals\b/.test(l));
    for (const line of approvalPostLines) {
      const isProhibition = /DO NOT|do not|⚠️|not.*call/i.test(line);
      expect(isProhibition, `"${line.trim()}" must be a prohibition, not an instruction`).toBe(true);
    }
  });

  it("contains no fallback language permitting manual API calls", async () => {
    const step = extractStep5(await loadSkill());
    const forbidden: RegExp[] = [
      /alternatively.*call/i,
      /if the script fails.*you can/i,
      /you can also.*POST/i,
      /manually.*create.*approv/i,
      /fall.*back.*POST/i,
      /as a fallback/i,
    ];
    for (const pattern of forbidden) {
      expect(step, `step must not contain fallback phrase: ${pattern}`).not.toMatch(pattern);
    }
  });

  it("hard rules section prohibits direct POST /approvals and POST /issues calls", async () => {
    const markdown = await loadSkill();
    const idx = markdown.indexOf("## Hard rules");
    expect(idx, "Hard rules section must exist in skill").toBeGreaterThan(-1);
    const hardRules = markdown.slice(idx);
    expect(hardRules).toMatch(/STEP 5 script is the ONLY way/);
    expect(hardRules).toMatch(/[Dd][Oo] NOT call POST \/approvals or POST \/issues directly/);
  });
});
