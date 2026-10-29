/** Device-local capture drafts, validated client requests and coalesced saves shared by modal and floating editors. */
import { z } from "zod";
import type { Category, Json } from "./types";

/** Captures retain a stable creation identifier until an entry is durably saved or explicitly discarded. */
export const captureDraftSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    title: z.string().max(300),
    content: z.string().max(8 * 1024 * 1024),
    category: z.string().max(200),
    source: z.string().max(1000),
  })
  .strict();
/** One resumable capture remains local until the user submits it. */
export type CaptureDraft = z.infer<typeof captureDraftSchema>;
/** Clipboard selection and OCR material append to an existing draft instead of replacing it. */
export interface CaptureSeed {
  text?: string;
  source?: string;
  image?: string;
}
/** Only UI preferences and category names cross into the floating window; credentials never do. */
export interface CaptureContext {
  categories: Category[];
  appearance: Record<string, Json>;
}
/** A durable save can return an existing entry without discarding the unfinished draft. */
export interface CaptureSaved {
  id: string;
  created: boolean;
  draft: CaptureDraft;
  warning?: string;
}
/** Every bridge operation is allowlisted, bounded and independent of filesystem paths. */
export const captureRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("load"),
      seed: z
        .object({
          text: z
            .string()
            .max(8 * 1024 * 1024)
            .optional(),
          source: z.string().max(1000).optional(),
          image: z
            .string()
            .max(28 * 1024 * 1024)
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal("context") }).strict(),
  z.object({ type: z.literal("search"), query: z.string().max(300) }).strict(),
  z.object({ type: z.literal("save"), draft: captureDraftSchema }).strict(),
  z.object({ type: z.literal("submit"), draft: captureDraftSchema }).strict(),
  z
    .object({
      type: z.literal("discard"),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("stage-image"),
      draftId: z.uuid(),
      mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      data: z.string().max(28 * 1024 * 1024),
    })
    .strict(),
  z
    .object({
      type: z.literal("preview"),
      draftId: z.uuid(),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({ type: z.literal("open-entry"), id: z.string().min(1).max(200) })
    .strict(),
]);
/** Requests are identical for the main-window repository and the restricted native bridge. */
export type CaptureRequest = z.infer<typeof captureRequestSchema>;
/** The floating editor uses RPC while the in-app editor calls the same single writer directly. */
export interface CaptureClient {
  request<T>(request: CaptureRequest): Promise<T>;
}
/** Observable client state distinguishes unsaved text from an acknowledged persistent revision. */
export interface CaptureSessionState {
  draft: CaptureDraft | null;
  pending: boolean;
  error: string;
}
/** Coalesce edits during a save, retain input on failure and never overwrite newer typing with an older acknowledgement. */
export class CaptureSession {
  private state: CaptureSessionState = {
    draft: null,
    pending: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private savedGeneration = 0;
  private work?: Promise<void>;
  private initialization?: Promise<void>;
  constructor(
    readonly client: CaptureClient,
    private seed?: CaptureSeed,
  ) {}
  /** Subscribe to stable snapshots used by either editor surface. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Read the latest local input, including edits not yet persisted. */
  getSnapshot = () => this.state;
  private publish(patch: Partial<CaptureSessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  /** Restore the previous draft once; errors remain visible and do not substitute an empty draft. */
  init() {
    return (this.initialization ??= this.client
      .request<CaptureDraft>({ type: "load", seed: this.seed })
      .then((draft) => {
        this.publish({ draft: captureDraftSchema.parse(draft), error: "" });
      })
      .catch((error) => {
        this.initialization = undefined;
        this.publish({
          error: String(error instanceof Error ? error.message : error),
        });
        throw error;
      }));
  }
  /** Queue current input immediately; concurrent keystrokes are folded into the next persistent write. */
  patch(patch: Partial<Pick<CaptureDraft, "title" | "content" | "category">>) {
    if (!this.state.draft) return;
    this.generation++;
    this.publish({ draft: { ...this.state.draft, ...patch }, pending: true });
    void this.flush().catch(() => {});
  }
  /** Wait for all current edits, preserving the draft and retry opportunity if storage or CAS fails. */
  async flush(): Promise<void> {
    await this.init();
    if (this.work) {
      await this.work;
      if (this.savedGeneration < this.generation) return this.flush();
      return;
    }
    if (this.savedGeneration === this.generation) return;
    const task = (async () => {
      while (this.savedGeneration < this.generation) {
        const generation = this.generation;
        const sent = { ...this.state.draft! };
        const saved = captureDraftSchema.parse(
          await this.client.request<CaptureDraft>({
            type: "save",
            draft: sent,
          }),
        );
        this.savedGeneration = generation;
        this.publish({
          draft: {
            ...this.state.draft!,
            id: saved.id,
            revision: saved.revision,
          },
          pending: this.savedGeneration < this.generation,
          error: "",
        });
      }
    })().catch((error) => {
      this.publish({
        pending: true,
        error: String(error instanceof Error ? error.message : error),
      });
      throw error;
    });
    this.work = task;
    try {
      await task;
    } finally {
      if (this.work === task) this.work = undefined;
    }
    if (this.savedGeneration < this.generation) await this.flush();
  }
  /** Reload only when local edits are saved, unless an explicit discard confirmation authorized replacing them. */
  async reload(discardLocal = false) {
    if (!discardLocal) await this.flush();
    if (this.work) await this.work.catch(() => {});
    const draft = captureDraftSchema.parse(
      await this.client.request<CaptureDraft>({ type: "load" }),
    );
    this.generation = this.savedGeneration = 0;
    this.publish({ draft, pending: false, error: "" });
  }
  /** Submit the acknowledged draft; its stable identifier makes delivery retries safe. */
  async submit() {
    await this.flush();
    const result = await this.client.request<CaptureSaved>({
      type: "submit",
      draft: this.state.draft!,
    });
    this.generation = this.savedGeneration = 0;
    this.publish({
      draft: captureDraftSchema.parse(result.draft),
      pending: false,
      error: "",
    });
    return result;
  }
  /** Clear only the revision explicitly confirmed by the user, including its staged local images. */
  async discard() {
    if (this.work) await this.work.catch(() => {});
    const current = this.state.draft!;
    const draft = captureDraftSchema.parse(
      await this.client.request<CaptureDraft>({
        type: "discard",
        id: current.id,
        revision: current.revision,
      }),
    );
    this.generation = this.savedGeneration = 0;
    this.publish({ draft, pending: false, error: "" });
  }
}
const editors = new Set<{
  flush: () => Promise<void>;
  freeze: (value: boolean) => void;
}>();
let editorsFrozen = false;
/** Register imports and draft persistence so window close, migration and quit can wait for real durability. */
export function registerCaptureEditor(editor: {
  flush: () => Promise<void>;
  freeze: (value: boolean) => void;
}) {
  editors.add(editor);
  if (editorsFrozen) editor.freeze(true);
  return () => {
    editors.delete(editor);
  };
}
/** Freeze input only for shutdown; ordinary capture opening can flush without blocking further editing. */
export async function flushCaptureEditors(freeze = false) {
  if (freeze) {
    editorsFrozen = true;
    editors.forEach((e) => e.freeze(true));
  }
  const outcomes = await Promise.allSettled([...editors].map((e) => e.flush()));
  const failed = outcomes.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
/** Restore editing after an interrupted shutdown or migration without discarding draft text. */
export function resumeCaptureEditors() {
  editorsFrozen = false;
  editors.forEach((e) => e.freeze(false));
}
