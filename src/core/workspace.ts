/** Device-local tabs and resumable drafts; committed knowledge still uses the replicated event repository. */
import { z } from "zod";
import { store } from "./store";
import type { Entry } from "./types";
const draftSchema = z.object({
  title: z.string(),
  content: z.string(),
  summary: z.string(),
  editing: z.boolean(),
  sourceMode: z.boolean(),
  focus: z
    .object({
      id: z.string(),
      key: z.string(),
      before: z.string().nullable(),
      after: z.string().nullable(),
    })
    .nullable(),
  base: z.object({
    title: z.string(),
    content: z.string(),
    summary: z.string(),
  }),
  editorDocument: z.json().optional(),
});
const workspaceSchema = z.object({
  schema: z.literal(1),
  tabs: z.array(z.string()),
  active: z.string(),
  drafts: z.record(z.string(), draftSchema),
});
/** A local draft records its original version so remote changes require a comparison before overwriting. */
export type EntryDraft = z.infer<typeof draftSchema>;
/** Persisted window context is deliberately per device rather than replacing another device's open tabs. */
export type WorkspaceData = z.infer<typeof workspaceSchema>;
/** Serialize local workspace updates and retain pending edits on a persistence failure. */
export class EntryWorkspace {
  private state: WorkspaceData & {
    ready: boolean;
    pending: boolean;
    error: string;
  } = {
    schema: 1,
    tabs: [],
    active: "",
    drafts: {},
    ready: false,
    pending: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  /** React subscribes only to stable immutable snapshots. */
  getSnapshot = () => this.state;
  /** Observe optimistic draft changes and their actual durability status. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  /** Publish session state without adding replicated knowledge operations for every keystroke. */
  private emit() {
    for (const listener of this.listeners) listener();
  }
  /** Merge any tabs opened during initialization instead of dropping them when disk loading completes. */
  init() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const saved = await store.db.local<unknown>("entry-workspace", null);
      const parsed = workspaceSchema.safeParse(saved);
      if (!parsed.success && saved)
        await store.db.setLocal("entry-workspace-damaged-" + Date.now(), saved);
      const initial = parsed.success
        ? parsed.data
        : { schema: 1 as const, tabs: [], active: "", drafts: {} };
      this.state = {
        ...initial,
        ...(this.generation
          ? {
              tabs: [...new Set([...initial.tabs, ...this.state.tabs])],
              active: this.state.active || initial.active,
              drafts: { ...initial.drafts, ...this.state.drafts },
            }
          : {}),
        ready: true,
        pending: this.state.pending,
        error:
          !parsed.success && saved
            ? "无法读取旧的窗口上下文；原记录已保留 / Workspace context could not be read; original retained"
            : "",
      };
      this.emit();
      if (this.state.pending) this.persistLater();
    })().catch((e) => {
      this.state = { ...this.state, ready: true, error: String(e) };
      this.emit();
    });
    return this.initialization;
  }
  /** Apply one session edit and coalesce rapid keystrokes into a bounded local database write rate. */
  private change(patch: Partial<WorkspaceData>) {
    this.state = { ...this.state, ...patch, pending: true };
    this.generation++;
    this.emit();
    this.persistLater();
  }
  /** A short debounce prevents full browser SQLite exports on every keypress. */
  private persistLater() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 250);
  }
  /** Flush the latest draft snapshot; a newer queued change keeps its pending indicator until its own commit. */
  flush = async () => {
    clearTimeout(this.timer);
    const version = this.generation;
    const { schema, tabs, active, drafts } = this.state;
    const task = this.tail.then(() =>
      store.db.setLocal("entry-workspace", { schema, tabs, active, drafts }),
    );
    this.tail = task.catch(() => {});
    try {
      await task;
      if (version === this.generation) {
        this.state = { ...this.state, pending: false, error: "" };
        this.emit();
      }
    } catch (e) {
      this.state = { ...this.state, error: String(e), pending: true };
      this.emit();
      throw e;
    }
  };
  /** Open an existing tab without losing another tab's unsaved draft. */
  open(id: string) {
    this.change({
      tabs: this.state.tabs.includes(id)
        ? this.state.tabs
        : [...this.state.tabs, id],
      active: id,
    });
  }
  /** Persist a draft only when its actual content or cursor context changed. */
  draft(id: string, value: EntryDraft) {
    if (JSON.stringify(this.state.drafts[id]) !== JSON.stringify(value))
      this.change({ drafts: { ...this.state.drafts, [id]: value } });
  }
  /** Drop a local draft only after explicit cancellation or successful knowledge persistence. */
  clearDraft(id: string) {
    if (!this.state.drafts[id]) return;
    const drafts = { ...this.state.drafts };
    delete drafts[id];
    this.change({ drafts });
  }
  /** Close a reviewed tab; the caller confirms before dropping an unsaved draft. */
  close(id: string) {
    const index = this.state.tabs.indexOf(id),
      tabs = this.state.tabs.filter((tab) => tab !== id),
      drafts = { ...this.state.drafts };
    delete drafts[id];
    this.change({
      tabs,
      drafts,
      active:
        this.state.active === id
          ? (tabs[Math.min(index, tabs.length - 1)] ?? "")
          : this.state.active,
    });
    return this.state.active;
  }
  /** Distinguish local unsaved knowledge from a purely navigational focus bookmark. */
  isDirty(id: string, entry?: Entry) {
    const d = this.state.drafts[id];
    if (
      entry &&
      d &&
      d.content === entry.content &&
      d.title === entry.title &&
      d.summary === (entry.summary ?? "")
    )
      return false;
    return (
      !!d?.editing &&
      (d.content !== d.base.content ||
        d.title !== d.base.title ||
        d.summary !== d.base.summary ||
        (!entry && !!d.content))
    );
  }
}
export const entryWorkspace = new EntryWorkspace();
