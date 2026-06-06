import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeOutput, writeError, applyErrorPolicy } from "../src/exec/output.js";
import type { PaperclipClient } from "../src/api/paperclip.js";
import type { HelperConfig } from "../src/config/schema.js";
import type { SpawnResult } from "../src/exec/spawn.js";

function makeMockClient(): PaperclipClient {
  return {
    upsertDocument: vi.fn().mockResolvedValue(undefined),
    postComment: vi.fn().mockResolvedValue(undefined),
    patchIssueStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as PaperclipClient;
}

function makeResult(overrides: Partial<SpawnResult> = {}): SpawnResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "hello output",
    stderr: "",
    durationMs: 100,
    ...overrides,
  };
}

function makeHelper(overrides: Partial<HelperConfig> = {}): HelperConfig {
  return {
    name: "test-helper",
    trigger: { kind: "routine", routineId: "r-uuid" },
    exec: { command: "/bin/test" },
    output: { documentKey: "my-doc", format: "raw", comment: false },
    ...overrides,
  };
}

describe("writeOutput", () => {
  it("writes stdout to document with raw format", async () => {
    const client = makeMockClient();
    const helper = makeHelper({ output: { documentKey: "out", format: "raw" } });
    await writeOutput(makeResult({ stdout: "raw content" }), helper, "iss-1", client);
    expect(client.upsertDocument).toHaveBeenCalledWith("iss-1", "out", "raw content");
    expect(client.postComment).not.toHaveBeenCalled();
  });

  it("writes stdout to document with markdown format", async () => {
    const client = makeMockClient();
    const helper = makeHelper({ output: { documentKey: "md", format: "markdown" } });
    await writeOutput(makeResult({ stdout: "# Heading" }), helper, "iss-1", client);
    expect(client.upsertDocument).toHaveBeenCalledWith("iss-1", "md", "# Heading");
  });

  it("validates JSON and writes when valid", async () => {
    const client = makeMockClient();
    const helper = makeHelper({ output: { documentKey: "j", format: "json" } });
    await writeOutput(makeResult({ stdout: '{"key":"val"}' }), helper, "iss-1", client);
    expect(client.upsertDocument).toHaveBeenCalledWith("iss-1", "j", '{"key":"val"}');
  });

  it("throws and writes error doc when JSON is invalid", async () => {
    const client = makeMockClient();
    const helper = makeHelper({ output: { documentKey: "j", format: "json" } });
    await expect(writeOutput(makeResult({ stdout: "not json" }), helper, "iss-1", client)).rejects.toThrow(
      "not valid JSON"
    );
    expect(client.upsertDocument).toHaveBeenCalledWith("iss-1", "j-error", expect.stringContaining("not valid JSON"));
  });

  it("posts comment when output.comment=true", async () => {
    const client = makeMockClient();
    const helper = makeHelper({ output: { documentKey: "out", format: "raw", comment: true } });
    await writeOutput(makeResult({ stdout: "data", durationMs: 50 }), helper, "iss-1", client);
    expect(client.postComment).toHaveBeenCalledWith("iss-1", expect.stringContaining("exit 0"));
  });

  it("truncates stdout larger than 1 MB", async () => {
    const client = makeMockClient();
    const helper = makeHelper({ output: { documentKey: "out", format: "raw" } });
    const big = "x".repeat(2 * 1024 * 1024);
    await writeOutput(makeResult({ stdout: big }), helper, "iss-1", client);
    const [, , written] = (client.upsertDocument as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    expect(written.length).toBeLessThanOrEqual(1 * 1024 * 1024);
  });
});

describe("applyErrorPolicy", () => {
  it("patches status to blocked for block_issue", async () => {
    const client = makeMockClient();
    await applyErrorPolicy("iss-1", "block_issue", client);
    expect(client.patchIssueStatus).toHaveBeenCalledWith("iss-1", "blocked");
  });

  it("patches status to cancelled for cancel_issue", async () => {
    const client = makeMockClient();
    await applyErrorPolicy("iss-1", "cancel_issue", client);
    expect(client.patchIssueStatus).toHaveBeenCalledWith("iss-1", "cancelled");
  });

  it("does not patch for noop", async () => {
    const client = makeMockClient();
    await applyErrorPolicy("iss-1", "noop", client);
    expect(client.patchIssueStatus).not.toHaveBeenCalled();
  });
});
