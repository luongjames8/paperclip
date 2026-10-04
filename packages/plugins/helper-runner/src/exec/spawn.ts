import { spawn } from "node:child_process";

const STDOUT_MAX = 1 * 1024 * 1024; // 1 MB
const STDERR_MAX = 256 * 1024; // 256 KB
const SIGKILL_GRACE_MS = 2000;
const IS_WINDOWS = process.platform === "win32";

export interface SpawnResult {
  exitCode: number;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Set when the OS could not start the process (e.g. ENOENT, EACCES). */
  spawnError?: string;
}

export function spawnHelper(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so a timeout reaches grandchildren (e.g. a shell
      // script's subprocesses), not just the direct child. Windows has no
      // process groups addressable by negative pid.
      detached: !IS_WINDOWS,
    });

    // Mirrors adapter-utils' signalRunningProcess (not a helper-runner dep).
    const killGroup = (sig: NodeJS.Signals) => {
      if (!IS_WINDOWS && child.pid !== undefined) {
        try {
          process.kill(-child.pid, sig);
          return;
        } catch {
          // ESRCH (group already gone) or unsupported — fall back below.
        }
      }
      child.kill(sig);
    };

    let stdoutChunks: Buffer[] = [];
    let stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = STDOUT_MAX - stdoutLen;
      if (remaining > 0) {
        const slice = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
        stdoutChunks.push(slice);
        stdoutLen += slice.length;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = STDERR_MAX - stderrLen;
      if (remaining > 0) {
        const slice = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
        stderrChunks.push(slice);
        stderrLen += slice.length;
      }
    });

    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let sigkillTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      sigkillTimer = setTimeout(() => killGroup("SIGKILL"), SIGKILL_GRACE_MS);
    }, options.timeoutMs);

    // Handles ENOENT, EACCES, and other OS-level spawn failures.
    // Without this listener Node throws an uncaught exception and crashes the worker.
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      resolve({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - startedAt,
        spawnError: err.message,
      });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      // After a timeout, let the KILL still fire: the direct child exiting on
      // TERM does not mean a TERM-ignoring grandchild has.
      if (sigkillTimer && !timedOut) clearTimeout(sigkillTimer);

      resolve({
        exitCode: code ?? 1,
        signal: signal ?? null,
        timedOut,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
