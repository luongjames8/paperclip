import { describe, it, expect } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import {
  getThreadForIssue,
  setThreadForIssue,
  getThreadForAncestors,
} from "../src/routing/thread-state.js";
import type { ThreadEntry } from "../src/routing/thread-state.js";

function makeEntry(overrides?: Partial<ThreadEntry>): ThreadEntry {
  return {
    channelId: "channel-123",
    threadId: "thread-456",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("thread-state", () => {
  it("set then get returns the stored entry", async () => {
    const harness = createTestHarness({ manifest });
    const entry = makeEntry();

    await setThreadForIssue(harness.ctx, "c1", "iss-1", entry);
    const result = await getThreadForIssue(harness.ctx, "c1", "iss-1");

    expect(result).toEqual(entry);
  });

  it("get for unknown issueId returns null", async () => {
    const harness = createTestHarness({ manifest });

    const result = await getThreadForIssue(harness.ctx, "c1", "unknown");

    expect(result).toBeNull();
  });

  it("getThreadForAncestors finds the nearest matching ancestor", async () => {
    const harness = createTestHarness({ manifest });
    const entry = makeEntry({ threadId: "thread-parent" });

    await setThreadForIssue(harness.ctx, "c1", "iss-parent", entry);
    const result = await getThreadForAncestors(harness.ctx, "c1", ["iss-child", "iss-parent", "iss-root"]);

    expect(result).toEqual(entry);
  });

  it("getThreadForAncestors returns null when no ancestor matches", async () => {
    const harness = createTestHarness({ manifest });

    const result = await getThreadForAncestors(harness.ctx, "c1", ["x", "y"]);

    expect(result).toBeNull();
  });
});
