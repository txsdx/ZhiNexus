/** Shared update lifecycle: coalesced discovery/downloads, durable staging and retryable errors independent of routes. */
import type { UpdateInfo } from "./updates";
/** One stable snapshot consumed by global and settings update controls. */
export interface UpdateState {
  phase:
    | "idle"
    | "checking"
    | "downloading"
    | "ready"
    | "installing"
    | "current"
    | "error";
  update: UpdateInfo | null;
  error: string;
  checkedAt: string;
}
/** Native transfer and device persistence stay outside the lifecycle controller. */
export interface UpdateDependencies {
  check(): Promise<UpdateInfo | null>;
  prepare(info: UpdateInfo): Promise<void>;
  restore(): Promise<UpdateInfo | null>;
  remember(info: UpdateInfo | null): Promise<void>;
  failed(error: unknown): void;
}
/** Serialize manual and automatic work, keeping a verified ready update usable during offline check failures. */
export class UpdateController {
  private state: UpdateState = {
    phase: "idle",
    update: null,
    error: "",
    checkedAt: "",
  };
  private listeners = new Set<() => void>();
  private active?: Promise<UpdateInfo | null>;
  private restored = false;
  constructor(private readonly dependencies: UpdateDependencies) {}
  /** Stable snapshots avoid repeated renders while the rest of the app is edited. */
  getSnapshot = () => this.state;
  /** Observe updates without owning the background task lifetime. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  /** Revalidate cached bytes after restart, then check the selected platform; callers share one in-flight operation. */
  check = (): Promise<UpdateInfo | null> => {
    if (this.active) return this.active;
    if (this.state.phase === "installing")
      return Promise.resolve(this.state.update);
    this.active = this.perform().finally(() => {
      this.active = undefined;
    });
    return this.active;
  };
  private async stage(info: UpdateInfo) {
    this.publish({ phase: "downloading", update: info });
    await this.dependencies.prepare(info);
    await this.dependencies.remember(info);
    this.publish({ phase: "ready", update: info, error: "" });
  }
  private async perform() {
    let ready = this.state.phase === "ready" ? this.state.update : null;
    this.publish({ phase: "checking", error: "" });
    try {
      if (!this.restored) {
        this.restored = true;
        try {
          const cached = await this.dependencies.restore();
          if (cached?.available) {
            await this.stage(cached);
            ready = cached;
          }
        } catch (error) {
          this.dependencies.failed(error);
          this.publish({ phase: "checking" });
        }
      }
      const info = await this.dependencies.check();
      this.publish({ checkedAt: new Date().toISOString() });
      if (info?.available) {
        if (
          !ready ||
          ready.sha256 !== info.sha256 ||
          ready.version !== info.version ||
          ready.kind !== info.kind ||
          ready.signature !== info.signature ||
          ready.url !== info.url
        )
          await this.stage(info);
        else this.publish({ phase: "ready", update: info });
      } else if (ready?.available && info?.current === ready.current) {
        this.publish({ phase: "ready", update: ready });
      } else {
        await this.dependencies.remember(null);
        this.publish({ phase: "current", update: info });
      }
      return this.state.update;
    } catch (error) {
      this.publish({
        phase: ready ? "ready" : "error",
        update: ready ?? this.state.update,
        error: error instanceof Error ? error.message : String(error),
      });
      this.dependencies.failed(error);
      throw error;
    }
  }
  /** Install only a fully staged update; repeat clicks and simultaneous background checks cannot launch twice. */
  async install(work: (info: UpdateInfo) => Promise<void>) {
    if (this.active || this.state.phase !== "ready" || !this.state.update)
      return false;
    const info = this.state.update;
    this.publish({ phase: "installing", error: "" });
    try {
      await work(info);
      this.publish({ phase: "ready" });
      return true;
    } catch (error) {
      this.publish({
        phase: "ready",
        error: error instanceof Error ? error.message : String(error),
      });
      this.dependencies.failed(error);
      throw error;
    }
  }
}
