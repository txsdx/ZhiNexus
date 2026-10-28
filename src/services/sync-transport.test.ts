/** Conditional publication must fail safely on incompatible WebDAV servers; operation bytes really use gzip. */
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./network", async (original) => ({
  ...(await original<typeof import("./network")>()),
  request: mock.fetch,
}));
import { WebDAV } from "./sync-transport";
import { newPackedPath } from "../core/sync-packs";
/** Implement real response streams and preconditions without involving the application repository. */
function fixture(
  options: {
    ignoreConditions?: boolean;
    fixedETag?: boolean;
    weakETag?: boolean;
    locking?: boolean;
    expireNextWrite?: boolean;
  } = {},
) {
  const files = new Map<string, { bytes: Uint8Array; etag: string }>();
  let revision = 0,
    lockCounter = 0;
  const locks = new Map<string, string>();
  const root = "https://" + crypto.randomUUID() + ".example/root/";
  const calls: { path: string; method: string }[] = [];
  mock.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.split("/root/")[1],
      method = init.method!,
      headers = new Headers(init.headers),
      old = files.get(path);
    calls.push({ path, method });
    if (method === "MKCOL")
      return new Response(null, {
        status: 201,
        headers: options.locking ? { server: "SFTPGo fixture" } : {},
      });
    if (options.locking && method === "LOCK") {
      if (
        [...locks.keys()].some(
          (base) => path.startsWith(base) || base.startsWith(path),
        )
      )
        return new Response(null, { status: 423 });
      const token = "<" + ++lockCounter + ">";
      locks.set(path, token);
      return new Response("<lock/>", { headers: { "lock-token": token } });
    }
    if (options.locking && method === "UNLOCK") {
      if (locks.get(path) !== headers.get("Lock-Token"))
        return new Response(null, { status: 409 });
      locks.delete(path);
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE") {
      files.delete(path);
      if (path.endsWith("/"))
        for (const name of [...files.keys()])
          if (name.startsWith(path)) files.delete(name);
      return new Response(null, { status: 204 });
    }
    if (method === "GET")
      return old
        ? new Response(Uint8Array.from(old.bytes), {
            headers: { etag: (options.weakETag ? "W/" : "") + old.etag },
          })
        : new Response(null, { status: 404 });
    if (method === "PUT") {
      if (options.locking) {
        if (options.expireNextWrite && path === "state/HEAD.json") {
          locks.clear();
          options.expireNextWrite = false;
        }
        const held = [...locks.entries()].find(([base]) =>
          path.startsWith(base),
        );
        if (held && headers.get("If") !== `(${held[1]})`)
          return new Response(null, { status: 423 });
        if (!held && headers.has("If"))
          return new Response(null, { status: 412 });
      }
      if (
        !options.ignoreConditions &&
        ((headers.get("If-None-Match") === "*" && old) ||
          (headers.has("If-Match") && headers.get("If-Match") !== old?.etag))
      )
        return new Response(null, { status: 412 });
      files.set(path, {
        bytes:
          typeof init.body === "string"
            ? new TextEncoder().encode(init.body)
            : Uint8Array.from(init.body as Uint8Array),
        etag: options.fixedETag ? '"fixed"' : '"v' + ++revision + '"',
      });
      return new Response(null, { status: old ? 200 : 201 });
    }
    throw Error("Unexpected fixture method");
  });
  return {
    files,
    calls,
    transport: new WebDAV(root, "test", "test"),
    client: () => new WebDAV(root, "test", "test"),
  };
}
beforeEach(() => vi.clearAllMocks());
it("uses valid strong ETags to create one head and rejects a losing writer without overwriting it", async () => {
  const { transport, files } = fixture();
  await transport.init();
  expect([...files.keys()]).toEqual([]);
  expect(await transport.readHead()).toBeNull();
  expect(await transport.replaceHead(null, '{"epoch":1}')).toBe(true);
  const first = (await transport.readHead())!;
  expect(await transport.replaceHead(null, "bad")).toBe(false);
  expect(await transport.replaceHead(first.etag, '{"epoch":2}')).toBe(true);
  expect(await transport.replaceHead(first.etag, "lost update")).toBe(false);
  expect((await transport.readHead())!.body).toBe('{"epoch":2}');
  await expect(transport.remove("state/HEAD.json")).rejects.toThrow(
    "未知云端路径",
  );
});
it.each([{ ignoreConditions: true }, { fixedETag: true }, { weakETag: true }])(
  "rejects unsafe server behavior %j without touching authoritative data",
  async (options) => {
    const { transport, files, calls } = fixture(options);
    files.set("state/HEAD.json", {
      bytes: new TextEncoder().encode("original"),
      etag: '"original"',
    });
    await expect(transport.init()).rejects.toThrow();
    expect(new TextDecoder().decode(files.get("state/HEAD.json")!.bytes)).toBe(
      "original",
    );
    expect(calls.filter((c) => c.path === "state/HEAD.json")).toEqual([]);
    expect([...files.keys()]).toEqual(["state/HEAD.json"]);
  },
);
it("stores compressed wire bytes and bounds decoding without a base64 wrapper", async () => {
  const { transport, files } = fixture();
  await transport.init();
  const path = newPackedPath("packs", 1, "a".repeat(64)),
    text = JSON.stringify({ text: "重复知识。".repeat(20000) });
  await transport.write(path, text);
  const bytes = files.get(path)!.bytes;
  expect([...bytes.slice(0, 2)]).toEqual([31, 139]);
  expect(bytes.length).toBeLessThan(text.length / 10);
  expect(await transport.read(path)).toBe(text);
});

it("preserves exact damaged gzip bytes before a repair, without requiring decompression", async () => {
  const { transport, files } = fixture();
  await transport.init();
  const path = newPackedPath("packs", 1, "b".repeat(64)),
    damaged = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
  files.set(path, { bytes: damaged, etag: '"broken"' });
  await expect(transport.read(path)).rejects.toThrow();
  const preserved = await transport.quarantine(path);
  expect(files.get(preserved)!.bytes).toEqual(damaged);
  await transport.write(path, '{"repaired":true}');
  expect(await transport.read(path)).toBe('{"repaired":true}');
  expect(files.get(preserved)!.bytes).toEqual(damaged);
});

it("uses SFTPGo ancestor locks with opaque numeric tokens when conditional PUT is unavailable", async () => {
  const { transport, client, calls } = fixture({
    locking: true,
    ignoreConditions: true,
    weakETag: true,
  });
  await transport.init();
  expect(await transport.replaceHead(null, '{"epoch":1}')).toBe(true);
  const first = (await transport.readHead())!,
    second = client();
  await second.init();
  const raced = await Promise.all([
    transport.replaceHead(first.etag, '{"epoch":2,"writer":"a"}'),
    second.replaceHead(first.etag, '{"epoch":2,"writer":"b"}'),
  ]);
  expect(raced.filter(Boolean)).toHaveLength(1);
  expect((await transport.readHead())!.body).toMatch(/"writer":"[ab]"/);
  expect(calls.some((call) => call.method === "LOCK")).toBe(true);
  expect(calls.some((call) => call.method === "UNLOCK")).toBe(true);
});
it("rejects a delayed SFTPGo write after its lock expires instead of publishing without a fence", async () => {
  const options = {
      locking: true,
      ignoreConditions: true,
      expireNextWrite: false,
    },
    { transport } = fixture(options);
  await transport.init();
  await transport.replaceHead(null, '{"epoch":1}');
  const first = (await transport.readHead())!;
  options.expireNextWrite = true;
  expect(await transport.replaceHead(first.etag, '{"epoch":2}')).toBe(false);
  expect((await transport.readHead())!.body).toBe('{"epoch":1}');
});
