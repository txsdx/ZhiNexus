/** Wall-clock sync scheduling: startup deadlines, suspend/resume, retry backoff and one in-flight exchange. */
/** Device configuration and shared activity needed for one scheduling decision. */
export interface SyncClockState {
  key: string;
  minutes: number;
  lastSuccess: number;
  online: boolean;
  busy: boolean;
}
/** Effects are injected so elapsed time and network failures can be verified without real servers. */
export interface SyncClockDependencies {
  read(): SyncClockState;
  run(): Promise<number | false>;
  failed(error: unknown): void;
}
/** Schedule against the last successful sync rather than restarting a blind interval after every mount. */
export class AutoSyncClock {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private active = false;
  private key = "";
  private completed = 0;
  private retryAt = 0;
  private failures = 0;
  private observedSuccess = 0;
  constructor(private dependencies: SyncClockDependencies) {}
  /** Start one clock; repeated startup does not create another interval. */
  start() {
    this.stopped = false;
    this.wake();
  }
  /** Re-evaluate on configuration, online or visibility changes; online recovery may bypass an old error backoff. */
  wake(reconnected = false) {
    if (reconnected) this.retryAt = 0;
    clearTimeout(this.timer);
    this.plan();
  }
  /** Cancel future work without interfering with an already durable exchange. */
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  private plan() {
    if (this.stopped || this.active) return;
    const state = this.dependencies.read();
    if (state.key !== this.key) {
      this.key = state.key;
      this.completed = 0;
      this.observedSuccess = 0;
      this.retryAt = 0;
      this.failures = 0;
    }
    if (!state.key || !Number.isFinite(state.minutes) || state.minutes <= 0)
      return;
    if (state.lastSuccess > this.observedSuccess) {
      this.observedSuccess = state.lastSuccess;
      this.retryAt = 0;
      this.failures = 0;
    }
    const now = Date.now(),
      last = Math.max(
        Number.isFinite(state.lastSuccess) && state.lastSuccess <= now + 5000
          ? state.lastSuccess
          : 0,
        this.completed <= now + 5000 ? this.completed : 0,
      );
    const deadline = Math.max(
      last ? last + Math.max(1, state.minutes) * 60000 : now,
      this.retryAt,
    );
    const delay =
      !state.online || state.busy
        ? 30000
        : Math.max(1, Math.min(30000, deadline - now));
    this.timer = setTimeout(() => void this.tick(), delay);
  }
  private async tick() {
    if (this.stopped || this.active) return;
    const state = this.dependencies.read(),
      now = Date.now();
    const last = Math.max(
      Number.isFinite(state.lastSuccess) && state.lastSuccess <= now + 5000
        ? state.lastSuccess
        : 0,
      this.completed <= now + 5000 ? this.completed : 0,
    );
    if (!state.key || !Number.isFinite(state.minutes) || state.minutes <= 0)
      return;
    if (
      !state.online ||
      state.busy ||
      now < this.retryAt ||
      (last && now < last + Math.max(1, state.minutes) * 60000)
    ) {
      this.plan();
      return;
    }
    this.active = true;
    const identity = state.key;
    try {
      const completed = await this.dependencies.run();
      if (completed === false) this.retryAt = Date.now() + 5000;
      else if (identity === this.dependencies.read().key) {
        this.completed = completed;
        this.failures = 0;
        this.retryAt = 0;
      }
    } catch (error) {
      this.failures++;
      this.retryAt =
        Date.now() +
        Math.min(5 * 60000, 30000 * 2 ** Math.min(4, this.failures - 1));
      this.dependencies.failed(error);
    } finally {
      this.active = false;
      this.plan();
    }
  }
}
