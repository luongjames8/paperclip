import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChannelRateLimit } from "../src/util/ratelimit.js";

describe("ChannelRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("second task waits for first to complete plus 200ms gap", async () => {
    const rateLimit = new ChannelRateLimit(200);
    let task1Done = false;
    let task2Started = false;

    const p1 = rateLimit.enqueue("chan-1", async () => { task1Done = true; });
    const p2 = rateLimit.enqueue("chan-1", async () => { task2Started = true; });

    // Drain microtasks — task1 runs immediately (no prior queue)
    await vi.advanceTimersByTimeAsync(1);
    expect(task1Done).toBe(true);
    expect(task2Started).toBe(false); // still waiting for 200ms gap

    // Advance past the 200ms gap
    await vi.advanceTimersByTimeAsync(200);
    expect(task2Started).toBe(true);

    await Promise.all([p1, p2]);
  });

  it("serializes 5 tasks with ≥200ms gap between each (queue depth 5)", async () => {
    const rateLimit = new ChannelRateLimit(200);
    const resolved: number[] = [];

    const promises = [0, 1, 2, 3, 4].map(i =>
      rateLimit.enqueue("chan-1", async () => { resolved.push(i); })
    );

    // task 0 runs immediately (microtask)
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toEqual([0]);

    // each subsequent task fires after a 200ms gap
    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toEqual([0, 1]);

    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toEqual([0, 1, 2]);

    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toEqual([0, 1, 2, 3]);

    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toEqual([0, 1, 2, 3, 4]);

    await Promise.all(promises);
  });

  it("tasks on different channels complete within 1ms — no cross-channel gap", async () => {
    const rateLimit = new ChannelRateLimit(200);
    const completedChannels: string[] = [];

    const pA = rateLimit.enqueue("chan-a", async () => { completedChannels.push("a"); });
    const pB = rateLimit.enqueue("chan-b", async () => { completedChannels.push("b"); });

    // Advance only 1ms — far less than the 200ms gap. If chan-b serialized behind
    // chan-a, it would not complete until 200ms. Both completing within 1ms proves
    // cross-channel independence.
    await vi.advanceTimersByTimeAsync(1);
    expect(completedChannels).toContain("a");
    expect(completedChannels).toContain("b");

    await Promise.all([pA, pB]);
  });

  it("returns the resolved value of the task", async () => {
    const rateLimit = new ChannelRateLimit(200);
    const p = rateLimit.enqueue("chan-1", () => Promise.resolve("result-42"));

    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("result-42");
  });
});
