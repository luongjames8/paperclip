import { describe, it, expect } from "vitest";
import { Semaphore, SemaphorePool } from "../src/util/concurrency.js";

describe("Semaphore", () => {
  it("allows up to max concurrent acquisitions", async () => {
    const sem = new Semaphore(2);
    const log: string[] = [];

    const work = async (id: string, ms: number) => {
      await sem.acquire();
      log.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end:${id}`);
      sem.release();
    };

    // Start 4 tasks with maxConcurrent=2
    await Promise.all([work("a", 30), work("b", 30), work("c", 30), work("d", 30)]);

    // All 4 should complete
    expect(log.filter((e) => e.startsWith("start:")).length).toBe(4);
    expect(log.filter((e) => e.startsWith("end:")).length).toBe(4);
  });

  it("queues tasks exceeding max and runs them as slots free (6 tasks, max 2)", async () => {
    const sem = new Semaphore(2);
    const running: number[] = [];
    let maxConcurrent = 0;

    const work = async (id: number) => {
      await sem.acquire();
      running.push(id);
      maxConcurrent = Math.max(maxConcurrent, running.length);
      await new Promise((r) => setTimeout(r, 20));
      running.splice(running.indexOf(id), 1);
      sem.release();
    };

    await Promise.all([work(1), work(2), work(3), work(4), work(5), work(6)]);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    // Verify at least 2 ran concurrently (proves semaphore allows full quota)
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
  });

  it("tasks don't cross-contaminate (each completes independently)", async () => {
    const sem = new Semaphore(2);
    const results: number[] = [];

    const work = async (n: number) => {
      await sem.acquire();
      await new Promise((r) => setTimeout(r, 5));
      results.push(n);
      sem.release();
    };

    await Promise.all([1, 2, 3, 4, 5, 6].map(work));
    expect(results.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("SemaphorePool", () => {
  it("keys per company and resizes in place", () => {
    const pool = new SemaphorePool();
    const a = pool.get("co-a|h", 1);
    expect(pool.get("co-a|h", 1)).toBe(a);
    expect(pool.get("co-b|h", 1)).not.toBe(a);
    expect(pool.get("co-a|h", 2)).toBe(a);
  });

  it("keeps in-flight permits across a resize", async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const pool = new SemaphorePool();
    const sem = pool.get("k", 1);
    await sem.acquire();
    let second = false;
    void sem.acquire().then(() => (second = true));
    await flush();
    expect(second).toBe(false);
    pool.get("k", 1); // same max: still bounded by the held permit
    await flush();
    expect(second).toBe(false);
    pool.get("k", 2); // raised: the waiter is admitted alongside the holder
    await flush();
    expect(second).toBe(true);
    sem.release();
    sem.release();
    pool.get("k", 1);
    await sem.acquire(); // capacity back to exactly one
    let third = false;
    void sem.acquire().then(() => (third = true));
    await flush();
    expect(third).toBe(false);
  });
});
