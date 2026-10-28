/** Existing loose cloud data becomes verified compressed checkpoints before any old object can be removed. */
import { test, expect, type Page } from "@playwright/test";
import { mockWebDAV } from "./helpers/webdav";
import { repository } from "./helpers/ai-stream";

/** Build genuine pre-packing archives without keeping the obsolete cloud writer in production. */
async function legacy(page: Page, files: Map<string, string>, changes = 520) {
  await page.goto("/");
  await repository(
    page,
    `
    const hash=await store.db.putBlob(new Uint8Array([1,2,3,4,5]),'image/png');
    const id=await store.createEntry('旧云端知识','asset:'+hash);
    await store.batch(Array.from({length:${changes}},(_,i)=>({collection:'entry',id,patch:{summary:'原有版本 '+i}})),'legacy-fixture');
  `,
  );
  const archive = await page.evaluate(async () => {
    const { snapshot } = await import("/src/services/archive.ts" as string),
      { sha256 } = await import("/src/core/crypto.ts" as string);
    const data = await snapshot();
    return { data, hash: await sha256(data) };
  });
  for (const event of archive.data.events)
    files.set("events/" + event.hash + ".json", JSON.stringify(event));
  for (const asset of archive.data.blobs)
    files.set("blobs/" + asset.hash + ".json", JSON.stringify(asset));
  files.set(
    "snapshots/" + archive.hash + ".json",
    JSON.stringify(archive.data),
  );
  files.set(
    "devices/11111111-1111-4111-8111-111111111111.json",
    JSON.stringify({
      schema: 1,
      root: archive.data.root,
      state: archive.data.state,
      events: archive.data.events.length,
      at: new Date().toISOString(),
    }),
  );
  return archive.data.events.length;
}
/** Configure a fresh replica that has never held the existing cloud history. */
async function configure(page: Page) {
  await page.goto("/");
  await repository(
    page,
    "await store.updateDevice({davUrl:'https://dav.example/knowledge/',davUser:'fixture',davPassword:'fixture',syncMinutes:0});await store.createEntry('本地尚未上传','local edit must survive');",
  );
}
const sync = (page: Page) =>
  page.evaluate(async () =>
    (await import("/src/services/sync.ts" as string)).synchronize(),
  );
function manifest(files: Map<string, string>) {
  return JSON.parse(
    files.get(JSON.parse(files.get("state/HEAD.json")!).checkpoint.path)!,
  );
}

test("hundreds of existing cloud events and full archives retire only after a new client verifies a complete checkpoint", async ({
  page,
  browser,
}) => {
  const files = new Map<string, string>(),
    source = await browser.newContext(),
    peer = await browser.newContext();
  try {
    const sourcePage = await source.newPage(),
      count = await legacy(sourcePage, files);
    expect(count).toBeGreaterThan(500);
    await mockWebDAV(page, files);
    await configure(page);
    let report = await sync(page);
    expect(report.cleanup.pending).toBeGreaterThan(0);
    for (let attempt = 0; report.cleanup.pending && attempt < 5; attempt++)
      report = await sync(page);
    expect(report.cleanup.pending).toBe(0);
    expect(report.packs).toBeLessThan(20);
    expect(
      [...files.keys()].filter((path) =>
        /^(events|snapshots|devices)\//.test(path),
      ),
    ).toEqual([]);
    expect(manifest(files).retire).toEqual([]);
    const titles = await repository(
      page,
      "return store.getSnapshot().entries.map(e=>e.title).sort()",
    );
    expect(titles).toEqual(["旧云端知识", "本地尚未上传"].sort());
    expect(
      await repository(
        page,
        "const [hash]=await store.db.blobHashes();return Array.from((await store.db.blob(hash)).bytes)",
      ),
    ).toEqual([1, 2, 3, 4, 5]);
    await mockWebDAV(peer, files);
    const fresh = await peer.newPage();
    await fresh.goto("/");
    await repository(
      fresh,
      "await store.updateDevice({davUrl:'https://dav.example/knowledge/',davUser:'fixture',davPassword:'fixture',syncMinutes:0});",
    );
    await sync(fresh);
    expect(
      await repository(
        fresh,
        "return store.getSnapshot().entries.map(e=>e.title).sort()",
      ),
    ).toEqual(titles);
    const local = await fresh.evaluate(async () =>
      (await import("/src/services/integrity.ts" as string)).auditLocal(),
    );
    expect(local.root).toBe((await sync(fresh)).root);
  } finally {
    await source.close();
    await peer.close();
  }
});

test("failed old-file deletion is persisted and a different client finishes cleanup without repeating data writes", async ({
  page,
  browser,
}) => {
  const files = new Map<string, string>(),
    source = await browser.newContext(),
    peer = await browser.newContext();
  try {
    await legacy(await source.newPage(), files, 3);
    let reject = true;
    await mockWebDAV(page, files, {
      deleteStatus: (path) =>
        reject && path.startsWith("events/") ? 503 : undefined,
    });
    await configure(page);
    const first = await sync(page);
    expect(first.cleanup.pending).toBeGreaterThan(0);
    expect(manifest(files).looseEvents).toBe(true);
    expect(
      await repository(page, "return store.getSnapshot().entries.length"),
    ).toBe(2);
    reject = false;
    await mockWebDAV(peer, files);
    const fresh = await peer.newPage();
    await fresh.goto("/");
    await repository(
      fresh,
      "await store.updateDevice({davUrl:'https://dav.example/knowledge/',davUser:'fixture',davPassword:'fixture',syncMinutes:0});",
    );
    const finished = await sync(fresh);
    expect(finished.cleanup.pending).toBe(0);
    expect(manifest(files).retire).toEqual([]);
    expect([...files.keys()].some((path) => path.startsWith("events/"))).toBe(
      false,
    );
    expect(
      await repository(fresh, "return store.getSnapshot().entries.length"),
    ).toBe(2);
    await page.reload();
    expect(
      await repository(page, "return store.getSnapshot().entries.length"),
    ).toBe(2);
  } finally {
    await source.close();
    await peer.close();
  }
});
