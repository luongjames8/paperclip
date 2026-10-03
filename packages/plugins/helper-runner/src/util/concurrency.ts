export class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private max: number) {}

  // Resize in place: holders keep their permits; a raised max admits queued waiters now,
  // a lowered one takes effect as permits are released.
  setMax(max: number): void {
    this.max = max;
    while (this.running < this.max && this.queue.length > 0) {
      this.running++;
      this.queue.shift()!();
    }
  }

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.running <= this.max ? this.queue.shift() : undefined;
    if (next) {
      next();
    } else {
      this.running--;
    }
  }
}

// One semaphore per (company, helper) key, resized in place when a config save changes
// its max (so in-flight permits are never forgotten).
// ponytail: keys of removed helpers are never evicted — a few tiny objects per config edit.
export class SemaphorePool {
  private pool = new Map<string, Semaphore>();

  get(key: string, max: number): Semaphore {
    let sem = this.pool.get(key);
    if (!sem) {
      sem = new Semaphore(max);
      this.pool.set(key, sem);
    } else {
      sem.setMax(max);
    }
    return sem;
  }
}
