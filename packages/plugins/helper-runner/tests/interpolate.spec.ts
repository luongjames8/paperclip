import { describe, it, expect, vi } from "vitest";
import { interpolate, interpolateArray, interpolateRecord } from "../src/exec/interpolate.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";

const vars = {
  issueId: "issue-uuid-123",
  issueIdentifier: "HIN-CA-15",
  routineId: "routine-uuid-456",
  routineRunId: "run-uuid-789",
};

function makeCtx(resolveMap: Record<string, string> = {}): Pick<PluginContext, "secrets"> {
  return {
    secrets: {
      resolve: vi.fn(async (ref: string) => {
        if (ref in resolveMap) return resolveMap[ref];
        throw new Error(`Secret not found: ${ref}`);
      }),
    },
  };
}

describe("interpolate", () => {
  it("substitutes ${issue.id}", async () => {
    expect(await interpolate("id=${issue.id}", vars, makeCtx())).toBe("id=issue-uuid-123");
  });

  it("substitutes ${issue.identifier}", async () => {
    expect(await interpolate("${issue.identifier}", vars, makeCtx())).toBe("HIN-CA-15");
  });

  it("substitutes ${routine.id}", async () => {
    expect(await interpolate("routine=${routine.id}", vars, makeCtx())).toBe("routine=routine-uuid-456");
  });

  it("substitutes ${routine.run.id}", async () => {
    expect(await interpolate("run=${routine.run.id}", vars, makeCtx())).toBe("run=run-uuid-789");
  });

  it("resolves ${secret:UUID} via ctx.secrets.resolve", async () => {
    const ctx = makeCtx({ "abc-123-uuid": "super-secret" });
    expect(await interpolate("key=${secret:abc-123-uuid}", vars, ctx)).toBe("key=super-secret");
    expect(ctx.secrets.resolve).toHaveBeenCalledWith("abc-123-uuid");
  });

  it("throws on unknown variable", async () => {
    await expect(interpolate("${unknown.var}", vars, makeCtx())).rejects.toThrow(
      'Unknown interpolation variable: "${unknown.var}"'
    );
  });

  it("throws when secret ref resolution fails, wrapping ref name in error", async () => {
    const ctx = makeCtx({}); // no entries → resolve throws
    await expect(interpolate("${secret:missing-uuid}", vars, ctx)).rejects.toThrow(
      'Failed to resolve secret ref "missing-uuid"'
    );
  });

  it("handles plain string with no substitutions", async () => {
    expect(await interpolate("/opt/script.py", vars, makeCtx())).toBe("/opt/script.py");
  });

  it("handles multiple substitutions in one string", async () => {
    const result = await interpolate("${issue.id}/${issue.identifier}", vars, makeCtx());
    expect(result).toBe("issue-uuid-123/HIN-CA-15");
  });
});

describe("interpolateArray", () => {
  it("interpolates all elements", async () => {
    const result = await interpolateArray(["--issue", "${issue.id}", "--id", "${issue.identifier}"], vars, makeCtx());
    expect(result).toEqual(["--issue", "issue-uuid-123", "--id", "HIN-CA-15"]);
  });
});

describe("interpolateRecord", () => {
  it("interpolates all values", async () => {
    const result = await interpolateRecord(
      { ISSUE_ID: "${issue.id}", ROUTINE: "${routine.id}" },
      vars,
      makeCtx()
    );
    expect(result).toEqual({ ISSUE_ID: "issue-uuid-123", ROUTINE: "routine-uuid-456" });
  });
});
