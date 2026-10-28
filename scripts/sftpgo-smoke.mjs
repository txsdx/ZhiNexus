/** Opt-in real SFTPGo check. Run a local disposable SFTPGo plus Vite, then set SFTPGO_TEST_URL and APP_TEST_URL. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { gunzipSync } from "node:zlib";
const backend = new URL(
    process.env.SFTPGO_TEST_URL ?? "http://127.0.0.1:11880/",
  ),
  app = process.env.APP_TEST_URL ?? "http://localhost:1427";
if (!["127.0.0.1", "localhost", "[::1]"].includes(backend.hostname))
  throw Error(
    "This opt-in test writes only to a disposable loopback SFTPGo fixture",
  );
const user = process.env.SFTPGO_TEST_USER ?? "fixture",
  password = process.env.SFTPGO_TEST_PASSWORD ?? "fixture-key";
const folder = "zhinexus-smoke-" + crypto.randomUUID(),
  fake = "https://sftpgo.fixture/" + folder + "/",
  wire = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const contexts = [];
/** Forward real client bytes to an isolated local server without weakening the app's HTTPS validation. */
async function page() {
  const context = await browser.newContext({ locale: "zh-CN" });
  contexts.push(context);
  await context.route("https://sftpgo.fixture/**", async (route) => {
    const request = route.request(),
      original = new URL(request.url()),
      headers = { ...request.headers() };
    delete headers.host;
    delete headers["accept-encoding"];
    const body = request.postDataBuffer();
    wire.push({
      method: request.method(),
      path: original.pathname,
      bytes: body?.length ?? 0,
    });
    const target = new URL(original.pathname.slice(1), backend);
    const response = await fetch(target, {
      method: request.method(),
      headers,
      body: body?.length ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    const forwarded = Object.fromEntries(response.headers);
    for (const name of [
      "content-length",
      "content-encoding",
      "transfer-encoding",
      "connection",
    ])
      delete forwarded[name];
    Object.assign(forwarded, {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "ETag, Lock-Token",
      "access-control-allow-headers": "*",
    });
    await route.fulfill({
      status: response.status,
      headers: forwarded,
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  const page = await context.newPage();
  await page.goto(app);
  await page.locator(".app-shell").waitFor();
  await page.evaluate(
    async ({ url, user, password }) => {
      const { store } = await import("/src/core/store.ts");
      await store.updateDevice({
        davUrl: url,
        davUser: user,
        davPassword: password,
        syncMinutes: 0,
      });
    },
    { url: fake, user, password },
  );
  return page;
}
/** Inspect the ordinary repository and invoke the production synchronization service. */
const sync = (page) =>
  page.evaluate(async () =>
    (await import("/src/services/sync.ts")).synchronize(),
  );
try {
  const a = await page(),
    b = await page();
  const id = await a.evaluate(async () => {
    const { store } = await import("/src/core/store.ts");
    const hash = await store.db.putBlob(
      new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]),
      "image/png",
    );
    const id = await store.createEntry(
      "SFTPGo verified entry",
      "asset:" + hash,
    );
    await store.batch(
      Array.from({ length: 1000 }, (_, i) => ({
        collection: "entry",
        id,
        patch: { summary: "revision " + i },
      })),
      "sftpgo-test",
    );
    return id;
  });
  const first = await sync(a);
  assert.ok(first.events >= 1000);
  assert.ok(first.packs < 20);
  assert.ok(wire.some((call) => call.method === "LOCK"));
  assert.ok(wire.some((call) => call.method === "UNLOCK"));
  const compactUploads = wire.filter(
    (call) => call.method === "PUT" && call.path.endsWith(".json.gz"),
  );
  assert.ok(compactUploads.length < 20);
  await sync(b);
  await a.evaluate(
    async (id) =>
      (await import("/src/core/store.ts")).store.patch("entry", id, {
        content: "computer offline change",
      }),
    id,
  );
  await b.evaluate(
    async (id) =>
      (await import("/src/core/store.ts")).store.patch("entry", id, {
        content: "phone offline change",
      }),
    id,
  );
  await Promise.all([sync(a), sync(b)]);
  await sync(a);
  await sync(b);
  const compacted = await a.evaluate(async () =>
    (await import("/src/services/integrity.ts")).auditAndRepair(
      undefined,
      () => {},
      { compact: true },
    ),
  );
  assert.equal(compacted.root, compacted.cloudRoot);
  assert.equal(compacted.state, compacted.cloudState);
  await b.evaluate(
    async (id) =>
      (await import("/src/core/store.ts")).store.patch("entry", id, {
        content: "offline after compaction",
      }),
    id,
  );
  await sync(b);
  await sync(a);
  assert.equal(
    await a.evaluate(async () =>
      (await import("/src/core/store.ts")).store
        .getSnapshot()
        .events.some(
          (event) => event.op.patch.content === "offline after compaction",
        ),
    ),
    true,
  );
  const fresh = await page();
  await sync(fresh);
  await sync(a);
  await sync(b);
  const roots = [];
  for (const p of [a, b, fresh]) roots.push((await sync(p)).root);
  assert.equal(new Set(roots).size, 1);
  const current = await a.evaluate(async () => {
    const { store } = await import("/src/core/store.ts"),
      { WebDAV } = await import("/src/services/sync.ts");
    const d = store.getSnapshot().device,
      remote = new WebDAV(d.davUrl, d.davUser, d.davPassword);
    await remote.init();
    return {
      packs: await remote.list("packs"),
      checkpoints: await remote.list("checkpoints"),
      events: store.getSnapshot().events.length,
    };
  });
  assert.equal(current.checkpoints.length, 1);
  assert.ok(current.packs.length < 20);
  let packedBytes = 0,
    plainBytes = 0;
  for (const name of current.packs) {
    const response = await fetch(new URL(folder + "/packs/" + name, backend), {
      headers: {
        Authorization:
          "Basic " + Buffer.from(user + ":" + password).toString("base64"),
      },
    });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes[0], 31);
    assert.equal(bytes[1], 139);
    packedBytes += bytes.length;
    plainBytes += gunzipSync(bytes).length;
  }
  assert.ok(packedBytes < plainBytes / 2);
  console.log(
    JSON.stringify({
      provider: "real SFTPGo",
      events: current.events,
      packFiles: current.packs.length,
      checkpointFiles: current.checkpoints.length,
      plainBytes,
      packedBytes,
      clients: 3,
      concurrentPublication: "passed",
      offlineAfterGC: "passed",
      nativeGzip: "passed",
    }),
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  await fetch(new URL(folder, backend), {
    method: "DELETE",
    headers: {
      Authorization:
        "Basic " + Buffer.from(user + ":" + password).toString("base64"),
    },
  }).catch(() => {});
}
