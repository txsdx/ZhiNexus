/** Serialized autosave with debouncing, retryable failures and merge of concurrent untouched settings. */

/** Apply only fields edited between base and draft onto the latest committed source. */
export function mergeEdits<T>(source: T, base: T, draft: T): T {
  if (JSON.stringify(base) === JSON.stringify(draft))
    return structuredClone(source);
  if (
    base &&
    draft &&
    typeof base === "object" &&
    typeof draft === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(draft)
  ) {
    const result = { ...(source as Record<string, unknown>) };
    for (const key of new Set([...Object.keys(base), ...Object.keys(draft)])) {
      const before = (base as Record<string, unknown>)[key],
        after = (draft as Record<string, unknown>)[key];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      if (!(key in draft)) delete result[key];
      else result[key] = mergeEdits(result[key], before, after);
    }
    return result as T;
  }
  return structuredClone(draft);
}

/** Observable settings editor that remains alive across page changes and flushes before actions/quit. */
export class AutoSave<T> {
  private base: T;
  private state: {
    value: T;
    status: "saved" | "pending" | "saving" | "error";
    error: string;
  };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private running: Promise<void> | null = null;
  constructor(
    private source: () => T,
    private save: (next: T, previous: T) => Promise<void>,
    private onError: (error: unknown) => void = () => {},
    private delay = 350,
  ) {
    this.base = structuredClone(source());
    this.state = {
      value: structuredClone(this.base),
      status: "saved",
      error: "",
    };
  }
  /** Observe immutable draft and persistence status. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  /** Read the draft without losing in-progress edits after navigation. */
  getSnapshot = () => this.state;
  /** Incorporate remote saves while retaining only local edited fields. */
  receive = () => {
    const source = this.source();
    if (JSON.stringify(source) === JSON.stringify(this.base)) return;
    const value = mergeEdits(source, this.base, this.state.value);
    this.base = structuredClone(source);
    this.state = { ...this.state, value };
    this.emit();
  };
  /** Edit immediately and schedule one coalesced save; explicit flush never discards newer edits. */
  update = (update: T | ((previous: T) => T)) => {
    const value =
      typeof update === "function"
        ? (update as (previous: T) => T)(this.state.value)
        : update;
    this.state = {
      value: structuredClone(value),
      status: "pending",
      error: "",
    };
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, this.delay);
  };
  /** Persist edits in order, including changes made during an earlier save, or report a retryable failure. */
  flush = async (): Promise<void> => {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      return this.flush();
    }
    if (JSON.stringify(this.base) === JSON.stringify(this.state.value)) {
      if (this.state.status !== "saved") {
        this.state = { ...this.state, status: "saved", error: "" };
        this.emit();
      }
      return;
    }
    const base = structuredClone(this.base),
      value = structuredClone(this.state.value);
    this.state = { ...this.state, status: "saving", error: "" };
    this.emit();
    this.running = Promise.resolve().then(() => this.save(value, base));
    try {
      await this.running;
      const latest = this.source();
      this.state = {
        value: mergeEdits(latest, value, this.state.value),
        status: "pending",
        error: "",
      };
      this.base = structuredClone(latest);
    } catch (error) {
      this.state = {
        ...this.state,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      this.emit();
      this.onError(error);
      throw error;
    } finally {
      this.running = null;
    }
    return this.flush();
  };
  private emit() {
    for (const fn of this.listeners) fn();
  }
}
