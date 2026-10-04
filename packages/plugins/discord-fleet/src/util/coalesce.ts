// 2-second coalescing window: deduplicate rapid consecutive events on the same (channelId, issueId).
// Only the last update in the window fires; earlier ones are dropped.

export type CoalescedFn = () => Promise<void>;

export class CoalesceBuffer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly windowMs: number;

  constructor(windowMs = 2000) {
    this.windowMs = windowMs;
  }

  schedule(key: string, fn: CoalescedFn): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      fn().catch(() => undefined);
    }, this.windowMs);
    this.timers.set(key, timer);
  }

  flush(): void {
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}

export function coalesceKey(channelId: string, issueId: string): string {
  return `${channelId}:${issueId}`;
}
