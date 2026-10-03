export class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.running--;
    }
  }
}

// One semaphore per (company, helper) key, recreated when a config save changes its max.
// ponytail: keys of removed helpers are never evicted — a few tiny objects per config edit.
export class SemaphorePool {
  private pool = new Map<string, { max: number; sem: Semaphore }>();

  get(key: string, max: number): Semaphore {
    let entry = this.pool.get(key);
    if (!entry || entry.max !== max) {
      entry = { max, sem: new Semaphore(max) };
      this.pool.set(key, entry);
    }
    return entry.sem;
  }
}
