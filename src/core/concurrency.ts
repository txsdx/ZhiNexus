/** FIFO provider request admission with live limit changes and cancellation of queued work. */
interface Waiter {
  signal: AbortSignal;
  start: () => void;
  reject: (error: unknown) => void;
  abort: () => void;
}
/** Limit active HTTP generation requests; review dialogs and queued workflows occupy no slot. */
export class AIConcurrency {
  private limit = 2;
  private active = 0;
  private waiting: Waiter[] = [];
  /** Apply a validated device preference without aborting already-running requests. */
  setLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 16)
      throw Error("AI 并发上限必须为 1–16 / AI concurrency must be 1–16");
    this.limit = limit;
    this.pump();
  }
  /** Observe request counts for the global queue UI and tests. */
  get counts() {
    return {
      active: this.active,
      waiting: this.waiting.length,
      limit: this.limit,
    };
  }
  /** Wait in submission order, then release the slot on success, error or cancellation. */
  async run<T>(
    signal: AbortSignal,
    start: () => void,
    work: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        reject,
        start: () => {
          signal.removeEventListener("abort", waiter.abort);
          this.active++;
          resolve();
        },
        abort: () => {
          this.waiting = this.waiting.filter((x) => x !== waiter);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          this.pump();
        },
      };
      signal.addEventListener("abort", waiter.abort, { once: true });
      this.waiting.push(waiter);
      this.pump();
    });
    try {
      signal.throwIfAborted();
      start();
      return await work();
    } finally {
      this.active--;
      this.pump();
    }
  }
  private pump() {
    while (this.active < this.limit && this.waiting.length) {
      const next = this.waiting.shift()!;
      if (next.signal.aborted) {
        next.reject(next.signal.reason);
        continue;
      }
      next.start();
    }
  }
}
