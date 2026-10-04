import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoalesceBuffer, coalesceKey } from "../src/util/coalesce.js";

describe("CoalesceBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a single scheduled call after the window elapses", async () => {
    const buf = new CoalesceBuffer(2000);
    const fn = vi.fn().mockResolvedValue(undefined);

    buf.schedule("key-a", fn);
    await vi.advanceTimersByTimeAsync(2001); // strictly past 2000ms window

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("coalesces two rapid calls — only the last fires", async () => {
    const buf = new CoalesceBuffer(2000);
    const fnA = vi.fn().mockResolvedValue(undefined);
    const fnB = vi.fn().mockResolvedValue(undefined);
    const key = coalesceKey("chan-1", "iss-1");

    buf.schedule(key, fnA);
    await vi.advanceTimersByTimeAsync(500); // well before window; fnA timer replaced
    buf.schedule(key, fnB);
    await vi.advanceTimersByTimeAsync(2001); // strictly past fnB's 2000ms window

    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("different keys fire independently", async () => {
    const buf = new CoalesceBuffer(2000);
    const fnX = vi.fn().mockResolvedValue(undefined);
    const fnY = vi.fn().mockResolvedValue(undefined);

    buf.schedule("key-x", fnX);
    buf.schedule("key-y", fnY);
    await vi.advanceTimersByTimeAsync(2001); // strictly past 2000ms window

    expect(fnX).toHaveBeenCalledTimes(1);
    expect(fnY).toHaveBeenCalledTimes(1);
  });

  it("flush cancels all pending calls", async () => {
    const buf = new CoalesceBuffer(2000);
    const fn = vi.fn().mockResolvedValue(undefined);

    buf.schedule("key-flush", fn);
    buf.flush();
    await vi.advanceTimersByTimeAsync(2001);

    expect(fn).not.toHaveBeenCalled();
  });
});
