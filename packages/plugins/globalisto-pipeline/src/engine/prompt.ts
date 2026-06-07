// Pure prompt assembly — ported from the canonical pipeline-runner/executor.js
// assemblePrompt function. No filesystem, no ctx.

/**
 * Assemble a final prompt string from its constituent parts.
 *
 * Each input is prepended as:
 *   ## Input: <name>\n\n<content>\n\n---\n\n
 *
 * Then the prompt content is appended, with {pre_fetched_data} substituted if
 * `preFetchedSection` is provided and the placeholder is present.
 * If `preFetchedSection` is provided but the placeholder is absent, the
 * pre-fetched section is prepended before the prompt content.
 */
export function assemblePrompt(
  promptContent: string,
  inputs: Record<string, string>,
  preFetchedSection?: string,
): string {
  let prompt = "";

  for (const [filename, content] of Object.entries(inputs)) {
    prompt += `## Input: ${filename}\n\n${content}\n\n---\n\n`;
  }

  if (preFetchedSection && promptContent.includes("{pre_fetched_data}")) {
    prompt += promptContent.replace("{pre_fetched_data}", preFetchedSection);
  } else if (preFetchedSection) {
    prompt += preFetchedSection + "\n\n" + promptContent;
  } else {
    prompt += promptContent;
  }

  return prompt;
}
