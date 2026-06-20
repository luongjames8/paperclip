// 200ms per-channel outbound queue — serialises Discord posts per channel to avoid burst floods.
// discord.js REST manager handles 429 backoff; this queue prevents unnecessary rate-limit hits.

export class ChannelRateLimit {
  private queues = new Map<string, Promise<void>>();
  private readonly gapMs: number;

  constructor(gapMs = 200) {
    this.gapMs = gapMs;
  }

  enqueue<T>(channelId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(channelId) ?? Promise.resolve();
    const resultPromise = prev.then(() => task());
    // Queue slot includes the inter-call delay for serialization
    const queueSlot = resultPromise
      .then(() => this._delay())
      .catch(() => undefined);
    this.queues.set(channelId, queueSlot);
    return resultPromise;
  }

  private _delay(): Promise<void> {
    return new Promise((res) => setTimeout(res, this.gapMs));
  }
}
