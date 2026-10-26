/** Immutable WebDAV operation exchange, verified attachments and advisory device manifests. */
import { z } from "zod";
import { store, json } from "../core/store";
import { base64, canonical, merkle, sha256, unbase64 } from "../core/crypto";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import { materialize, stateHash } from "../core/crdt";
import type { Envelope, Json } from "../core/types";
import { request, boundedText, secureUrl } from "./network";
/** Future object-storage and dedicated-server adapters implement this immutable transport contract. */
export interface SyncTransport {
  init(): Promise<void>;
  list(folder: string): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, body: string): Promise<void>;
}
/** WebDAV requires TLS, same-root listing and no credentials in URL paths. */
export class WebDAV implements SyncTransport {
  private root: URL;
  private auth: string;
  constructor(root: string, user: string, password: string) {
    this.root = secureUrl(root.endsWith("/") ? root : root + "/");
    this.auth =
      "Basic " + base64(new TextEncoder().encode(user + ":" + password));
  }
  /** Issue authenticated requests only to paths generated under the selected root. */
  private call(
    path: string,
    method: string,
    body?: string,
    headers: Record<string, string> = {},
  ) {
    return request(new URL(path, this.root).href, {
      method,
      headers: { Authorization: this.auth, ...headers },
      body,
    });
  }
  /** Create the root and immutable storage collections; existing collections are expected. */
  async init() {
    for (const path of [
      "",
      "events/",
      "blobs/",
      "devices/",
      "snapshots/",
      "quarantine/",
    ]) {
      const res = await this.call(path, "MKCOL");
      if (!res.ok && res.status !== 405)
        throw Error(`WebDAV MKCOL HTTP ${res.status}；请确保父目录存在`);
    }
  }
  /** Enumerate immediate immutable children; never interpret a listing as permission to delete data. */
  async list(folder: string): Promise<string[]> {
    const res = await this.call(
      folder + "/",
      "PROPFIND",
      '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      { Depth: "1", "Content-Type": "application/xml" },
    );
    if (res.status !== 207) throw Error(`WebDAV PROPFIND HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(
      await boundedText(res),
      "application/xml",
    );
    if (doc.querySelector("parsererror")) throw Error("WebDAV 列表 XML 损坏");
    const prefix = new URL(folder + "/", this.root);
    return Array.from(doc.getElementsByTagNameNS("DAV:", "href")).flatMap(
      (node) => {
        const url = new URL(node.textContent ?? "", this.root);
        if (
          url.origin !== prefix.origin ||
          !url.pathname.startsWith(prefix.pathname)
        )
          return [];
        const name = decodeURIComponent(
          url.pathname.slice(prefix.pathname.length),
        );
        return /^[a-f0-9]{64}\.json$/.test(name) ? [name] : [];
      },
    );
  }
  /** Read an immutable payload without following redirects. */
  async read(path: string) {
    const res = await this.call(path, "GET");
    if (!res.ok) throw Error(`WebDAV GET HTTP ${res.status}`);
    return boundedText(
      res,
      (path.startsWith("snapshots/") ? 256 : 32) * 1024 * 1024,
    );
  }
  /** Upload deterministic bytes. Repeating an identical content-addressed PUT is idempotent. */
  async write(path: string, body: string) {
    const res = await this.call(path, "PUT", body, {
      "Content-Type": "application/json",
    });
    if (!res.ok) throw Error(`WebDAV PUT HTTP ${res.status}`);
  }
}
let syncing = false;
/** Share one gate between automatic exchange and explicit deep audit. */
export async function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  if (syncing) throw Error("同步或校验正在进行 / Sync or audit in progress");
  syncing = true;
  try {
    return await work();
  } finally {
    syncing = false;
  }
}
export interface SyncReport {
  received: number;
  sent: number;
  root: string;
  state: string;
}
/** Exchange missing records; validate all remote operations before they affect local state. */
export async function synchronize(
  transport?: SyncTransport,
  onProgress = (s: string) => {
    void s;
  },
): Promise<SyncReport> {
  return withSyncLock(async () => {
    const { device } = store.getSnapshot();
    const remote =
      transport ??
      new WebDAV(device.davUrl, device.davUser, device.davPassword);
    await remote.init();
    onProgress("读取增量日志…");
    const before = await store.db.events(),
      known = new Set(before.map((e) => e.hash)),
      names = await remote.list("events"),
      remoteSet = new Set(names.map((n) => n.slice(0, -5))),
      incoming: unknown[] = [];
    for (const name of names)
      if (!known.has(name.slice(0, -5))) {
        const e = JSON.parse(await remote.read("events/" + name));
        if (e.hash !== name.slice(0, -5))
          throw Error("远程日志路径与摘要不一致");
        incoming.push(e);
      }
    await store.ingest(incoming);
    const all = await store.db.events();
    let sent = 0;
    for (const e of all)
      if (!remoteSet.has(e.hash)) {
        await remote.write("events/" + e.hash + ".json", canonical(e));
        sent++;
      }
    onProgress("校验附件…");
    const referenced = new Set<string>();
    for (const e of all) {
      const text = canonical(e.op.patch);
      for (const match of text.matchAll(/asset:([a-f0-9]{64})/g))
        referenced.add(match[1]);
    }
    const localBlobs = new Set(await store.db.blobHashes()),
      remoteBlobs = new Set(
        (await remote.list("blobs")).map((n) => n.slice(0, -5)),
      );
    for (const hash of new Set([...referenced, ...localBlobs])) {
      if (!localBlobs.has(hash)) {
        if (!remoteBlobs.has(hash))
          throw Error(
            "缺失附件 " + hash.slice(0, 8) + "；历史数据已保留，未删除任何记录",
          );
        const b = z
          .object({ hash: z.string(), mime: z.string(), data: z.string() })
          .parse(JSON.parse(await remote.read("blobs/" + hash + ".json")));
        if (b.hash !== hash) throw Error("附件地址错误");
        await store.db.putBlob(unbase64(b.data), b.mime, hash);
      } else if (!remoteBlobs.has(hash)) {
        const b = (await store.db.blob(hash))!;
        await remote.write(
          "blobs/" + hash + ".json",
          canonical({ hash, mime: b.mime, data: base64(b.bytes) }),
        );
      }
    }
    if ((await store.db.integrity()) !== "ok")
      throw Error("SQLite 完整性检查失败");
    const root = await merkle([
        ...all.map((e) => e.hash),
        ...(await store.db.blobHashes()),
      ]),
      state = await stateHash(all);
    const id = await store.db.local<string>("manifestId", crypto.randomUUID());
    await store.db.setLocal("manifestId", id);
    await remote.write(
      "devices/" + id + ".json",
      canonical({
        schema: 1,
        root,
        state,
        events: all.length,
        at: new Date().toISOString(),
      }),
    );
    await store.saveDevice({
      ...store.getSnapshot().device,
      lastSync: new Date().toISOString(),
    });
    return { received: incoming.length, sent, root, state };
  });
}
/** Build a complete, independently verifiable snapshot without deleting operation history. */
export async function snapshot(): Promise<Json> {
  const events = await store.db.events(),
    blobs = [];
  for (const hash of await store.db.blobHashes()) {
    const b = (await store.db.blob(hash))!;
    blobs.push({ hash, mime: b.mime, data: base64(b.bytes) });
  }
  return json({
    schema: 1,
    events,
    blobs,
    root: await merkle([
      ...events.map((e) => e.hash),
      ...blobs.map((b) => b.hash),
    ]),
    state: await stateHash(events),
  });
}
/** Restore by union, preserving local edits and refusing tampered archives before any writes. */
export async function verifySnapshot(input: unknown) {
  const s = z
    .object({
      schema: z.literal(1),
      events: z.array(z.unknown()),
      blobs: z.array(
        z.object({
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          mime: z.string(),
          data: z.string(),
        }),
      ),
      root: z.string(),
      state: z.string(),
    })
    .parse(input);
  const { validateEnvelope } = await import("../core/crdt");
  const events: Envelope[] = [];
  for (const e of s.events) events.push(await validateEnvelope(e));
  for (const b of s.blobs)
    if ((await sha256(unbase64(b.data))) !== b.hash)
      throw Error("备份附件摘要不匹配");
  if (
    (await merkle([
      ...events.map((e) => e.hash),
      ...s.blobs.map((b) => b.hash),
    ])) !== s.root ||
    (await stateHash(events)) !== s.state
  )
    throw Error("备份完整性校验失败");
  assertCausalClosure(events);
  validateDocuments(materialize(events));
  return { ...s, events };
}
/** Validate a complete archive before merging any records. */
export async function restoreSnapshot(input: unknown) {
  const s = await verifySnapshot(input);
  for (const b of s.blobs)
    await store.db.putBlob(unbase64(b.data), b.mime, b.hash);
  await store.ingest(s.events);
}
/** Upload a complete manual snapshot in addition to incremental synchronization. */
export async function uploadSnapshot() {
  const { device } = store.getSnapshot(),
    remote = new WebDAV(device.davUrl, device.davUser, device.davPassword);
  await remote.init();
  const data = await snapshot(),
    hash = await sha256(data);
  await remote.write("snapshots/" + hash + ".json", canonical(data));
  return hash;
}
