import type { PaperclipClient } from "../api/paperclip.js";
import type { HelperConfig } from "../config/schema.js";
import type { SpawnResult } from "./spawn.js";

const OUTPUT_SIZE_LIMIT = 1 * 1024 * 1024;

export async function writeOutput(
  result: SpawnResult,
  helper: HelperConfig,
  issueId: string,
  client: PaperclipClient
): Promise<void> {
  const output = helper.output ?? {};
  const key = output.documentKey ?? "helper-output";
  const format = output.format ?? "raw";

  let content = result.stdout;
  if (content.length > OUTPUT_SIZE_LIMIT) {
    content = content.slice(0, OUTPUT_SIZE_LIMIT);
  }

  if (format === "json") {
    try {
      JSON.parse(content);
    } catch {
      await writeError(
        issueId,
        key,
        `helper-error: stdout is not valid JSON\n\nstdout (first 1024 bytes):\n${content.slice(0, 1024)}`,
        client
      );
      if (output.comment) {
        await client.postComment(issueId, `❌ helper "${helper.name}" output was not valid JSON`);
      }
      throw new Error("stdout is not valid JSON");
    }
  }

  await client.upsertDocument(issueId, key, content);

  if (output.comment) {
    await client.postComment(
      issueId,
      `✅ helper "${helper.name}" completed — exit 0, ${result.stdout.length} bytes, ${result.durationMs}ms`
    );
  }
}

export async function writeError(
  issueId: string,
  documentKey: string,
  message: string,
  client: PaperclipClient
): Promise<void> {
  await client.upsertDocument(issueId, `${documentKey}-error`, message);
}

export async function applyErrorPolicy(
  issueId: string,
  policy: "block_issue" | "cancel_issue" | "noop",
  client: PaperclipClient
): Promise<void> {
  if (policy === "block_issue") {
    await client.patchIssueStatus(issueId, "blocked");
  } else if (policy === "cancel_issue") {
    await client.patchIssueStatus(issueId, "cancelled");
  }
  // noop: do nothing
}
