/** Main-window single writer for local capture drafts, staged images and idempotent entry creation. */
import Fuse from "fuse.js";
import { store } from "../core/store";
import { unbase64, sha256, canonical } from "../core/crypto";
import {
  captureDraftSchema,
  captureRequestSchema,
  type CaptureDraft,
  type CaptureRequest,
  type CaptureClient,
  type CaptureContext,
  type CaptureSaved,
} from "../core/capture-draft";
import {
  captureImageMime,
  captureImageReferences,
  captureImagePreview,
} from "./capture-images";
const key = "capture-draft-v1";
const fresh = (): CaptureDraft => ({
  id: crypto.randomUUID(),
  revision: 0,
  title: "",
  content: "",
  category: "",
  source: "manual-capture",
});
const assetKey = (id: string, hash: string) => `capture-asset:${id}:${hash}`;
const indexKey = (id: string) => `capture-assets:${id}`;
const contents = (draft: CaptureDraft) => canonical({ ...draft, revision: 0 });
/** Queue all clients through one repository; the floating window never opens SQLite or owns an event writer. */
export class CaptureRepository implements CaptureClient {
  private tail: Promise<unknown> = Promise.resolve();
  /** Complete already queued host requests before a process shutdown closes SQLite. */
  async flush() {
    await this.tail;
  }
  /** Validate and serialize both local and native-window requests before touching persistent data. */
  request<T>(input: CaptureRequest): Promise<T> {
    const request = captureRequestSchema.parse(input);
    const task = this.tail.then(() => this.execute(request));
    this.tail = task.catch(() => {});
    return task as Promise<T>;
  }
  private async draft() {
    const saved = await store.db.local<unknown>(key, null);
    if (saved !== null) return captureDraftSchema.parse(saved);
    const draft = fresh();
    await store.db.setLocal(key, draft);
    return draft;
  }
  private async persist(draft: CaptureDraft) {
    await store.db.setLocal(key, captureDraftSchema.parse(draft));
    return draft;
  }
  private assertRevision(current: CaptureDraft, id: string, revision: number) {
    if (current.id !== id || current.revision !== revision)
      throw Error(
        "草稿已在另一个窗口改变，当前输入已保留；请复制后重新加载 / Capture draft changed in another window; copy your input before reloading",
      );
  }
  private async stage(draftId: string, mime: string, data: string) {
    const bytes = unbase64(data);
    if (captureImageMime(bytes) !== mime)
      throw Error("图片类型不匹配 / Image type mismatch");
    const hash = await sha256(bytes),
      ids = await store.db.local<string[]>(indexKey(draftId), []);
    if (!ids.includes(hash)) {
      if (ids.length >= 100)
        throw Error(
          "单份草稿最多100张图片 / A capture draft supports up to 100 images",
        );
      await store.db.setLocal(indexKey(draftId), [...ids, hash]);
    }
    const previous = await store.db.local<{
      mime: string;
      data: string;
    } | null>(assetKey(draftId, hash), null);
    if (!previous || previous.mime !== mime || previous.data !== data)
      await store.db.setLocal(assetKey(draftId, hash), { mime, data });
    return hash;
  }
  private async cleanup(id: string) {
    for (const hash of await store.db.local<string[]>(indexKey(id), []))
      await store.db.setLocal(assetKey(id, hash), null);
    await store.db.setLocal(indexKey(id), []);
  }
  private async execute(request: CaptureRequest): Promise<unknown> {
    if (request.type === "context") {
      const s = store.getSnapshot();
      const appearance =
        s.docs.find((d) => d.collection === "setting" && d.id === "appearance")
          ?.fields ?? {};
      return {
        categories: s.categories,
        appearance: Object.fromEntries(
          [
            "language",
            "theme",
            "layout",
            "mobileLayout",
            "font",
            "accent",
            "scale",
          ]
            .filter((key) => key in appearance)
            .map((key) => [key, appearance[key]]),
        ),
      } satisfies CaptureContext;
    }
    if (request.type === "search")
      return request.query.trim()
        ? new Fuse(store.getSnapshot().entries, {
            keys: ["title"],
            threshold: 0.35,
          })
            .search(request.query)
            .slice(0, 5)
            .map((r) => ({ id: r.item.id, title: r.item.title }))
        : [];
    if (request.type === "open-entry") {
      if (!store.getSnapshot().entries.some((e) => e.id === request.id))
        throw Error("词条不存在 / Entry missing");
      window.dispatchEvent(
        new CustomEvent("zhinexus:open-entry", { detail: request.id }),
      );
      return null;
    }
    let current = await this.draft();
    if (request.type === "load") {
      const seed = request.seed;
      if (!seed) return current;
      const text = seed.text ?? "";
      let content = current.content;
      if (text && !content.includes(text))
        content += (content ? "\n\n" : "") + text;
      if (seed.image) {
        const match =
          /^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]+)$/.exec(
            seed.image,
          );
        if (!match) throw Error("截图格式无效 / Invalid capture image");
        const hash = await this.stage(current.id, match[1], match[2]);
        if (!captureImageReferences(content).some((r) => r.hash === hash))
          content +=
            (content ? "\n\n" : "") + `![截图 / Screenshot](asset:${hash})`;
      }
      if (content !== current.content) {
        current = await this.persist({
          ...current,
          content,
          title: current.title || text.split(/\r?\n/)[0].slice(0, 120),
          source: current.content
            ? current.source
            : (seed.source ?? current.source),
          revision: current.revision + 1,
        });
      }
      return current;
    }
    if (request.type === "save") {
      if (
        current.id === request.draft.id &&
        contents(current) === contents(request.draft) &&
        request.draft.revision <= current.revision
      )
        return current;
      this.assertRevision(current, request.draft.id, request.draft.revision);
      if (
        store
          .getSnapshot()
          .docs.some((d) => d.collection === "entry" && d.id === current.id)
      ) {
        // Preserve new edits after an entry saved successfully but draft cleanup failed.
        const next = {
          ...request.draft,
          id: crypto.randomUUID(),
          revision: current.revision + 1,
        };
        const images = await store.db.local<string[]>(indexKey(current.id), []);
        await store.db.setLocal(indexKey(next.id), images);
        for (const hash of images) {
          const staged = await store.db.local(assetKey(current.id, hash), null);
          if (staged) await store.db.setLocal(assetKey(next.id, hash), staged);
        }
        const saved = await this.persist(next);
        void this.cleanup(current.id).catch(() => {});
        return saved;
      }
      return this.persist({ ...request.draft, revision: current.revision + 1 });
    }
    if (request.type === "stage-image") {
      if (current.id !== request.draftId)
        throw Error("草稿已改变，请重新导入 / Draft changed; import again");
      return this.stage(current.id, request.mime, request.data);
    }
    if (request.type === "preview") {
      if (current.id !== request.draftId)
        throw Error("草稿已改变 / Draft changed");
      const staged = await store.db.local<{
        mime: string;
        data: string;
      } | null>(assetKey(current.id, request.hash), null);
      if (staged) {
        const bytes = unbase64(staged.data);
        if (
          (await sha256(bytes)) !== request.hash ||
          captureImageMime(bytes) !== staged.mime
        )
          throw Error("草稿图片损坏 / Draft image is corrupt");
        return captureImagePreview(bytes, staged.mime);
      }
      const image = await store.db.blob(request.hash);
      if (!image) throw Error("图片不存在 / Image missing");
      if (captureImageMime(image.bytes) !== image.mime)
        throw Error("图片类型不匹配 / Image type mismatch");
      return captureImagePreview(image.bytes, image.mime);
    }
    if (request.type === "discard") {
      this.assertRevision(current, request.id, request.revision);
      const next = await this.persist(fresh());
      // Consent cleared the durable draft. Temporary-image cleanup cannot turn that successful action into a false failure.
      await this.cleanup(current.id).catch(() => {});
      return next;
    }
    const input = request.draft;
    // A lost delivery after entry creation/cleanup can be retried without creating another entry or clearing a newer draft.
    const prior = store
      .getSnapshot()
      .docs.find((d) => d.collection === "entry" && d.id === input.id);
    if (prior?.fields.deleted)
      throw Error(
        "上次保存的条目已删除，请先检查回收站 / The previously saved entry is deleted; check the recycle bin",
      );
    if (prior && current.id !== input.id)
      return {
        id: input.id,
        created: true,
        draft: current,
      } satisfies CaptureSaved;
    this.assertRevision(current, input.id, input.revision);
    if (contents(current) !== contents(input))
      throw Error("请等待草稿保存完成 / Wait for draft persistence");
    if (!input.title.trim()) throw Error("请输入词条名称 / Enter a title");
    const exact = store
      .getSnapshot()
      .entries.find(
        (e) =>
          e.title.toLocaleLowerCase() ===
            input.title.trim().toLocaleLowerCase() && e.id !== input.id,
      );
    if (exact)
      return {
        id: exact.id,
        created: false,
        draft: current,
      } satisfies CaptureSaved;
    for (const hash of new Set(
      captureImageReferences(input.content).map((r) => r.hash),
    )) {
      const staged = await store.db.local<{
        mime: string;
        data: string;
      } | null>(assetKey(input.id, hash), null);
      if (staged) {
        const bytes = unbase64(staged.data);
        if (captureImageMime(bytes) !== staged.mime)
          throw Error("图片类型不匹配 / Image type mismatch");
        await store.db.putBlob(bytes, staged.mime, hash);
      } else if (!(await store.db.blob(hash)))
        throw Error(
          "图片不存在，原始草稿已保留 / Missing image; draft retained",
        );
    }
    const id = await store.createEntry(
      input.title,
      input.content || undefined,
      input.source,
      input.category,
      input.id,
    );
    if (!prior)
      void import("./enrichment")
        .then(({ enrichEntry }) => enrichEntry(id))
        .catch((error) => {
          window.dispatchEvent(
            new CustomEvent("zhinexus:notify", {
              detail:
                "原始词条已保存；自动整理未完成 / Entry saved; enrichment incomplete: " +
                String(error instanceof Error ? error.message : error),
            }),
          );
        });
    let next: CaptureDraft;
    try {
      next = await this.persist(fresh());
    } catch (error) {
      throw Error(
        "词条已保存，但草稿清理失败；再次保存会复用该条目 / Entry saved; draft cleanup failed. Retry safely: " +
          String(error),
      );
    }
    let warning: string | undefined;
    try {
      await this.cleanup(input.id);
    } catch (error) {
      warning =
        "词条已保存，临时图片清理未完成 / Entry saved; temporary cleanup incomplete: " +
        String(error);
    }
    return { id, created: true, draft: next, warning } satisfies CaptureSaved;
  }
}
/** The main webview owns the sole repository instance; quick-capture only accesses it through validated RPC. */
export const captureRepository = new CaptureRepository();
