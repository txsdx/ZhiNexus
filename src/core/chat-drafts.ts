/** Durable device-local conversation drafts, coalesced independently of React mounts and knowledge sync. */
import { z } from "zod";
const draftSchema = z.object({
  text: z.string(),
  quote: z.string(),
  model: z.string(),
  effort: z.string(),
});
const schema = z.record(z.string(), draftSchema);
/** Unsent text and explicit model overrides belong to exactly one entry/topic scope. */
export type ChatDraft = z.infer<typeof draftSchema>;
/** Separate global, per-entry and not-yet-created conversations without delimiter collisions. */
export function chatDraftKey(entryId: string, topicId: string) {
  return JSON.stringify([entryId, topicId]);
}
/** Serialized snapshots retain pending edits and surface failures; nothing is silently evicted. */
export class ChatDrafts {
  private state = {
    ready: false,
    frozen: false,
    pending: false,
    error: "",
    drafts: {} as Record<string, ChatDraft>,
  };
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor(
    private read: () => Promise<unknown>,
    private write: (drafts: Record<string, ChatDraft>) => Promise<void>,
  ) {}
  /** Stable snapshots support useSyncExternalStore without render loops. */
  getSnapshot = () => this.state;
  /** Subscribe to editing, actual durability and errors. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  /** Validate saved drafts before enabling edits; a malformed value is retained and never overwritten. */
  init() {
    return (this.initialization ??= this.read()
      .then((value) => {
        this.publish({
          ready: true,
          error: "",
          drafts: schema.parse(value ?? {}),
        });
      })
      .catch((error) => {
        this.initialization = undefined;
        this.publish({ error: String(error) });
        throw error;
      }));
  }
  /** Patch only the current scope, bounded to eight MiB total without dropping another conversation. */
  patch(key: string, patch: Partial<ChatDraft>, defaults: ChatDraft) {
    if (!this.state.ready || this.state.frozen)
      throw Error("Chat drafts are not writable");
    const drafts = {
      ...this.state.drafts,
      [key]: { ...(this.state.drafts[key] ?? defaults), ...patch },
    };
    this.replace(drafts);
  }
  private replace(drafts: Record<string, ChatDraft>) {
    if (
      new TextEncoder().encode(JSON.stringify(drafts)).byteLength >
      8 * 1024 * 1024
    )
      throw Error("聊天草稿总量超过8 MiB / Chat drafts exceed 8 MiB");
    this.generation++;
    this.publish({ drafts, pending: true });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => {}), 250);
  }
  /** Transfer the latest draft after creating a topic, including edits typed while creation was pending. */
  transfer(from: string, to: string) {
    if (from === to || !this.state.drafts[from]) return;
    if (this.state.drafts[to])
      throw Error("Destination chat draft already exists");
    const drafts = { ...this.state.drafts, [to]: this.state.drafts[from] };
    delete drafts[from];
    this.replace(drafts);
  }
  /** Clear only the exact submitted text/quote; late typing and model changes remain intact. */
  clearSent(key: string, text: string, quote: string) {
    const draft = this.state.drafts[key];
    if (!draft) return;
    this.replace({
      ...this.state.drafts,
      [key]: {
        ...draft,
        text: draft.text === text ? "" : draft.text,
        quote: draft.quote === quote ? "" : draft.quote,
      },
    });
  }
  /** Called only after confirmed, durable topic deletion. */
  remove(key: string) {
    const drafts = { ...this.state.drafts };
    delete drafts[key];
    this.replace(drafts);
  }
  /** Drain the newest generation, retaining pending state on failure and permitting an explicit retry. */
  flush() {
    clearTimeout(this.timer);
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        while (this.state.ready && this.state.pending) {
          const generation = this.generation;
          try {
            await this.write(this.state.drafts);
          } catch (error) {
            this.publish({ error: String(error) });
            throw error;
          }
          if (generation === this.generation)
            this.publish({ pending: false, error: "" });
        }
      });
    this.tail = task;
    return task;
  }
  /** Freeze before normal native shutdown/migration, then wait for the newest draft to reach SQLite. */
  async freeze() {
    await this.init();
    this.publish({ frozen: true });
    await this.flush();
  }
  /** Restore editing after a cancelled or failed native handoff. */
  resume() {
    this.publish({ frozen: false });
  }
}
