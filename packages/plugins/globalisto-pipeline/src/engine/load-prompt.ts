// IO helper: read a step's prompt CONTENT from the vendored prompts dir, so the
// conductor can FEED the full prompt to the worker (Option A) rather than passing
// a path the worker must resolve itself.
//
// Returns null when the file is absent — notably the 2 script-only steps
// (`scripts/*.js`: music-duration calc + final package assembly) whose canonical
// implementation is a deterministic node script, not an LLM prompt. Those need a
// node-exec path (not yet implemented in v1); the conductor logs + defers them
// loudly rather than feeding JS to an LLM.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Read prompt content under promptsDir; null if the file does not exist. */
export function readStepPrompt(promptsDir: string, relPath: string): string | null {
  const full = join(promptsDir, relPath);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}
