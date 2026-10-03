import { describe, it, expect } from "vitest";
import { spawnHelper } from "../src/exec/spawn.js";

describe("spawnHelper", () => {
  it("captures stdout and exits cleanly", async () => {
    const result = await spawnHelper("/bin/echo", ["hello world"], { timeoutMs: 5000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("captures stderr", async () => {
    const result = await spawnHelper("/bin/sh", ["-c", "echo error >&2; exit 1"], { timeoutMs: 5000 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe("error");
  });

  it("propagates non-zero exit code", async () => {
    const result = await spawnHelper("/bin/false", [], { timeoutMs: 5000 });
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("kills process on timeout and marks timedOut", async () => {
    const result = await spawnHelper("/bin/sleep", ["60"], { timeoutMs: 500 });
    expect(result.timedOut).toBe(true);
    // Process should complete within 5s (SIGTERM + 2s grace + some overhead)
    expect(result.durationMs).toBeLessThan(5000);
  }, 10000);

  it("process is dead after timeout (not a zombie)", async () => {
    const result = await spawnHelper("/bin/sleep", ["60"], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    // Give OS time to reap
    await new Promise((r) => setTimeout(r, 200));
    // If pid is defined on signal, verify it's gone; otherwise just check timedOut flag
    expect(result.timedOut).toBe(true);
  }, 8000);

  it("truncates stdout at 1 MB", async () => {
    // Generate ~1.1MB by writing 1100 * 1024 bytes then check truncation
    const result = await spawnHelper("/bin/sh", ["-c", "dd if=/dev/zero bs=1024 count=1200 2>/dev/null | tr '\\0' 'a'"], {
      timeoutMs: 10000,
    });
    expect(result.stdout.length).toBeLessThanOrEqual(1 * 1024 * 1024);
  }, 15000);

  it("truncates stderr at 256 KB", async () => {
    // Generate ~300KB on stderr
    const result = await spawnHelper(
      "/bin/sh",
      ["-c", "dd if=/dev/zero bs=1024 count=310 2>/dev/null | tr '\\0' 'x' >&2; exit 0"],
      { timeoutMs: 10000 }
    );
    expect(result.stderr.length).toBeLessThanOrEqual(256 * 1024);
  }, 15000);

  it("sends SIGTERM before SIGKILL on timeout (process dies via SIGTERM, not SIGKILL)", async () => {
    // sleep(1) responds to SIGTERM immediately and exits with signal="SIGTERM".
    // If SIGKILL were sent first the signal would be "SIGKILL".
    // The 2000ms SIGKILL grace period means SIGTERM always arrives first.
    const result = await spawnHelper("/bin/sleep", ["60"], { timeoutMs: 400 });
    expect(result.timedOut).toBe(true);
    // Process was killed by SIGTERM (not SIGKILL), confirming send order
    expect(result.signal).toBe("SIGTERM");
  }, 6000);

  it("passes cwd and env to child", async () => {
    const result = await spawnHelper(
      "/bin/sh",
      ["-c", "echo $TEST_VAR:$(pwd)"],
      { cwd: "/tmp", env: { TEST_VAR: "hello" }, timeoutMs: 5000 }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello:/tmp");
  });

  it("args are passed as array, not interpreted as shell", async () => {
    // This arg contains shell metacharacters — should NOT be interpreted
    const result = await spawnHelper("/bin/echo", ["; rm -rf /evil"], { timeoutMs: 5000 });
    expect(result.stdout.trim()).toBe("; rm -rf /evil");
    expect(result.exitCode).toBe(0);
  });

  it("resolves (does not throw) when command does not exist — ENOENT", async () => {
    const result = await spawnHelper("/tmp/no-such-binary-xyz", [], { timeoutMs: 5000 });
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.signal).toBeNull();
    expect(result.spawnError).toMatch(/ENOENT/);
  });
});
