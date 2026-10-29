/** One writer protects local media drafts, explicit creation, concurrent revisions and retries after partial acknowledgement failure. */
import { beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
const fixture = vi.hoisted(() => ({
  meta: new Map<string, unknown>(),
  blobs: new Map<string, unknown>(),
  state: { entries: [] as any[], docs: [] as any[] },
  failClear: false,
  failPromotion: false,
  failCleanup: false,
  created: 0,
}));
vi.mock("../core/store", () => ({
  store: {
    getSnapshot: () => ({
      ...fixture.state,
      categories: [],
      device: { apiKey: "" },
    }),
    db: {
      local: async (key: string, fallback: unknown) =>
        structuredClone(
          fixture.meta.has(key) ? fixture.meta.get(key) : fallback,
        ),
      setLocal: async (key: string, value: any) => {
        if (
          fixture.failCleanup &&
          key.startsWith("capture-asset:") &&
          value === null
        ) {
          fixture.failCleanup = false;
          throw Error("temporary cleanup failed");
        }
        if (
          fixture.failClear &&
          key === "capture-draft-v1" &&
          value?.title === "" &&
          fixture.created
        ) {
          fixture.failClear = false;
          throw Error("cleanup failed");
        }
        fixture.meta.set(key, structuredClone(value));
      },
      putBlob: async (bytes: Uint8Array, mime: string, expected: string) => {
        if (fixture.failPromotion) throw Error("attachment write failed");
        const { sha256 } = await import("../core/crypto");
        const hash = await sha256(bytes);
        if (hash !== expected) throw Error("hash mismatch");
        fixture.blobs.set(hash, { mime, bytes });
        return hash;
      },
      blob: async (hash: string) => fixture.blobs.get(hash),
    },
    createEntry: async (
      title: string,
      content: string | undefined,
      _source: string,
      category: string,
      id: string,
    ) => {
      if (fixture.state.docs.some((d) => d.id === id)) return id;
      const fields = { title, content: content ?? "", category };
      fixture.state.entries.push({ id, ...fields });
      fixture.state.docs.push({ collection: "entry", id, fields });
      fixture.created++;
      return id;
    },
  },
}));
vi.mock("./enrichment", () => ({ enrichEntry: async () => {} }));
import { CaptureRepository } from "./capture-repository";
import type { CaptureDraft, CaptureSaved } from "../core/capture-draft";
import { base64 } from "../core/crypto";
beforeEach(() => {
  fixture.meta.clear();
  fixture.blobs.clear();
  fixture.state = { entries: [], docs: [] };
  fixture.created = 0;
  fixture.failClear = false;
  fixture.failPromotion = false;
  fixture.failCleanup = false;
});
it("stale windows cannot overwrite or discard another revision, while identical delivery retries remain idempotent", async () => {
  const repo = new CaptureRepository(),
    base = await repo.request<CaptureDraft>({ type: "load" });
  const saved = await repo.request<CaptureDraft>({
    type: "save",
    draft: { ...base, title: "winner" },
  });
  await expect(
    repo.request({ type: "save", draft: { ...base, title: "stale" } }),
  ).rejects.toThrow(/另一个窗口/);
  await expect(
    repo.request({ type: "discard", id: base.id, revision: base.revision }),
  ).rejects.toThrow(/另一个窗口/);
  expect(
    await repo.request({ type: "save", draft: { ...base, title: "winner" } }),
  ).toEqual(saved);
  expect(await repo.request({ type: "load" })).toEqual(saved);
});
it("images stay in local draft metadata until explicit submission, then become verified attachment bytes", async () => {
  const repo = new CaptureRepository(),
    base = await repo.request<CaptureDraft>({ type: "load" }),
    bytes = new Uint8Array(fs.readFileSync("public/app-icon.png"));
  const hash = await repo.request<string>({
    type: "stage-image",
    draftId: base.id,
    mime: "image/png",
    data: base64(bytes),
  });
  expect(fixture.blobs.size).toBe(0);
  const saved = await repo.request<CaptureDraft>({
    type: "save",
    draft: { ...base, title: "image", content: `![image](asset:${hash})` },
  });
  const result = await repo.request<CaptureSaved>({
    type: "submit",
    draft: saved,
  });
  expect(fixture.created).toBe(1);
  expect(fixture.blobs.has(hash)).toBe(true);
  expect(result.draft.title).toBe("");
  expect(result.draft.id).not.toBe(base.id);
  expect(fixture.meta.get(`capture-asset:${base.id}:${hash}`)).toBe(null);
});
it("failed attachment promotion retains the draft and creates no entry", async () => {
  const repo = new CaptureRepository(),
    base = await repo.request<CaptureDraft>({ type: "load" }),
    bytes = new Uint8Array(fs.readFileSync("public/app-icon.png"));
  const hash = await repo.request<string>({
      type: "stage-image",
      draftId: base.id,
      mime: "image/png",
      data: base64(bytes),
    }),
    saved = await repo.request<CaptureDraft>({
      type: "save",
      draft: { ...base, title: "keep", content: `![image](asset:${hash})` },
    });
  fixture.failPromotion = true;
  await expect(repo.request({ type: "submit", draft: saved })).rejects.toThrow(
    /attachment write failed/,
  );
  expect(await repo.request({ type: "load" })).toEqual(saved);
  expect(fixture.created).toBe(0);
});
it("cleanup failure can retry one stable entry; later edits fork the draft instead of being silently cleared", async () => {
  const repo = new CaptureRepository(),
    base = await repo.request<CaptureDraft>({ type: "load" }),
    saved = await repo.request<CaptureDraft>({
      type: "save",
      draft: { ...base, title: "first", content: "original" },
    });
  fixture.failClear = true;
  await expect(repo.request({ type: "submit", draft: saved })).rejects.toThrow(
    /词条已保存/,
  );
  expect(fixture.created).toBe(1);
  const edited = await repo.request<CaptureDraft>({
    type: "save",
    draft: { ...saved, title: "second", content: "new input" },
  });
  expect(edited.id).not.toBe(saved.id);
  expect(fixture.state.entries[0].content).toBe("original");
  const second = await repo.request<CaptureSaved>({
    type: "submit",
    draft: edited,
  });
  expect(fixture.created).toBe(2);
  expect(second.id).not.toBe(saved.id);
  const repeated = await repo.request<CaptureSaved>({
    type: "submit",
    draft: saved,
  });
  expect(fixture.created).toBe(2);
  expect(repeated.id).toBe(saved.id);
  expect(repeated.draft.id).toBe(second.draft.id);
});
it("selecting an existing title retains the unfinished content and does not promote its images or overwrite knowledge", async () => {
  fixture.state.entries.push({
    id: "existing",
    title: "same",
    content: "saved",
  });
  fixture.state.docs.push({
    collection: "entry",
    id: "existing",
    fields: { title: "same", content: "saved" },
  });
  const repo = new CaptureRepository(),
    base = await repo.request<CaptureDraft>({ type: "load" }),
    saved = await repo.request<CaptureDraft>({
      type: "save",
      draft: { ...base, title: "same", content: "unfinished" },
    });
  const result = await repo.request<CaptureSaved>({
    type: "submit",
    draft: saved,
  });
  expect(result).toMatchObject({
    id: "existing",
    created: false,
    draft: saved,
  });
  expect(fixture.state.entries[0].content).toBe("saved");
  expect(fixture.created).toBe(0);
});

it("an acknowledged explicit discard stays successful if temporary-image cleanup fails", async () => {
  const repo = new CaptureRepository();
  const base = await repo.request<CaptureDraft>({ type: "load" });
  await repo.request({
    type: "stage-image",
    draftId: base.id,
    mime: "image/png",
    data: base64(new Uint8Array(fs.readFileSync("public/app-icon.png"))),
  });
  const saved = await repo.request<CaptureDraft>({
    type: "save",
    draft: { ...base, title: "discard me", content: "original" },
  });
  fixture.failCleanup = true;
  const next = await repo.request<CaptureDraft>({
    type: "discard",
    id: saved.id,
    revision: saved.revision,
  });
  expect(next.id).not.toBe(saved.id);
  expect(next.title).toBe("");
  expect(await repo.request({ type: "load" })).toEqual(next);
  expect(fixture.created).toBe(0);
});
