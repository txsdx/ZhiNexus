/** Complete replicas, offline edits, racing publishers and interruption-safe cloud garbage collection. */
import { expect, it } from "vitest";
import type { Envelope, Operation } from "../core/types";
import { base64, canonical, sha256 } from "../core/crypto";
import { materialize, validateEnvelope } from "../core/crdt";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import {
  assetReference,
  synchronizePacked,
  verifiedAsset,
  type AssetValue,
  type PackedReplica,
} from "./packed-replica";
import { RemoteMissing, type SyncTransport } from "./sync-transport";
import { newPackedPath, parseHead, type Checkpoint } from "../core/sync-packs";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
async function event(seq: number, device = A, extra = {}): Promise<Envelope> {
  const op: Operation = {
    schema: 1,
    device,
    seq,
    vector: { [device]: seq },
    collection: "setting",
    entity: "fixture",
    patch: { value: seq, ...extra },
    at: "2026-10-28T00:00:00.000Z",
    source: "test",
  };
  return { op, hash: await sha256(op) };
}
/** Atomic in-memory server with hooks at exactly the same publication boundary as real WebDAV. */
class MemoryRemote implements SyncTransport {
  files = new Map<string, string>();
  version = 0;
  calls: { method: string; path: string }[] = [];
  beforeCAS?: () => Promise<void>;
  beforeRead?: (path: string) => Promise<void>;
  afterWrite?: (path: string) => void;
  failWrite = "";
  failRead = "";
  failRemove = false;
  async init() {}
  async list(folder: string) {
    this.calls.push({ method: "LIST", path: folder });
    return [...this.files.keys()]
      .filter((path) => path.startsWith(folder + "/"))
      .map((path) => path.slice(folder.length + 1));
  }
  async read(path: string) {
    this.calls.push({ method: "GET", path });
    if (this.failRead && path.includes(this.failRead))
      throw Error("injected read failure");
    await this.beforeRead?.(path);
    const data = this.files.get(path);
    if (data === undefined) throw new RemoteMissing(path);
    return data;
  }
  async write(path: string, body: string) {
    this.calls.push({ method: "PUT", path });
    if (this.failWrite && path.includes(this.failWrite))
      throw Error("injected upload failure");
    this.files.set(path, body);
    this.afterWrite?.(path);
  }
  async remove(path: string) {
    this.calls.push({ method: "DELETE", path });
    if (this.failRemove) throw Error("injected deletion failure");
    this.files.delete(path);
  }
  async readHead() {
    const body = this.files.get("HEAD.json");
    return body === undefined ? null : { body, etag: '"' + this.version + '"' };
  }
  async replaceHead(expected: string | null, body: string) {
    await this.beforeCAS?.();
    if ((await this.readHead())?.etag !== (expected ?? undefined)) return false;
    this.files.set("HEAD.json", body);
    this.version++;
    return true;
  }
  async quarantine(path: string) {
    const raw = await this.read(path),
      copy = "quarantine/" + (await sha256({ path, raw })) + ".json";
    this.files.set(copy, raw);
    return copy;
  }
}
/** Local operations are durably committed before cloud publication and survive a failed upload. */
class MemoryReplica implements PackedReplica {
  events: Envelope[] = [];
  values = new Map<string, AssetValue>();
  cache = new Map<string, Checkpoint>();
  bootstrap?: PackedReplica["bootstrap"];
  constructor(events: Envelope[] = []) {
    this.events = events;
  }
  async read() {
    return {
      events: structuredClone(this.events),
      assets: [...this.values.values()].map(assetReference),
    };
  }
  async asset(hash: string) {
    const value = this.values.get(hash);
    if (!value) throw Error("missing local asset");
    return value;
  }
  async apply(events: Envelope[], assets: AssetValue[]) {
    const all = [
      ...new Map(
        [...this.events, ...events].map((event) => [event.hash, event]),
      ).values(),
    ];
    for (const event of all) await validateEnvelope(event);
    assertCausalClosure(all);
    validateDocuments(materialize(all));
    for (const asset of assets)
      this.values.set(asset.hash, await verifiedAsset(asset));
    this.events = all;
  }
  async cachedCheckpoint(hash: string) {
    return this.cache.get(hash) ?? null;
  }
  async rememberCheckpoint(hash: string, value: Checkpoint) {
    this.cache.set(hash, structuredClone(value));
  }
}
async function checkpoint(remote: MemoryRemote) {
  const head = parseHead(JSON.parse((await remote.readHead())!.body));
  return JSON.parse(await remote.read(head.checkpoint.path)) as Checkpoint;
}

it("1000 operations become a few packs, and unchanged sync downloads no known pack bodies", async () => {
  const remote = new MemoryRemote(),
    local = new MemoryReplica();
  for (let n = 1; n <= 1000; n++) local.events.push(await event(n));
  const first = await synchronizePacked(remote, local);
  expect(first.sent).toBe(1000);
  expect(first.packs).toBe(4);
  expect(remote.files.size).toBe(6);
  remote.calls = [];
  const again = await synchronizePacked(remote, local);
  expect(again.sent).toBe(0);
  expect(remote.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  expect(
    remote.calls.filter(
      (call) => call.method === "GET" && call.path.endsWith(".json.gz"),
    ),
  ).toHaveLength(0);
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(fresh.events.map((e) => e.hash).sort()).toEqual(
    local.events.map((e) => e.hash).sort(),
  );
}, 15000);
it("bounds small delta files by automatic compaction, and a new device bootstraps after old files are removed", async () => {
  const remote = new MemoryRemote(),
    local = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, local);
  let compacted = false;
  for (let n = 2; n <= 12; n++) {
    local.events.push(await event(n));
    const report = await synchronizePacked(remote, local);
    compacted ||= report.compacted;
  }
  expect(compacted).toBe(true);
  expect((await checkpoint(remote)).packs.length).toBeLessThanOrEqual(8);
  const current = parseHead(JSON.parse((await remote.readHead())!.body)),
    manifest = await checkpoint(remote);
  expect(
    [...remote.files.keys()].filter((path) => path.startsWith("checkpoints/")),
  ).toEqual([current.checkpoint.path]);
  expect(
    [...remote.files.keys()].filter((path) => path.startsWith("packs/")),
  ).toHaveLength(manifest.packs.length);
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(fresh.events).toHaveLength(12);
});
it("merges offline edits after another device compacts without expiring or acknowledging the offline device", async () => {
  const remote = new MemoryRemote(),
    a = new MemoryReplica([await event(1)]),
    b = new MemoryReplica();
  await synchronizePacked(remote, a);
  await synchronizePacked(remote, b);
  const offline = await event(1, B, { note: "offline edit" });
  b.events.push(offline);
  a.events.push(await event(2));
  await synchronizePacked(remote, a, { compact: true });
  await synchronizePacked(remote, b);
  await synchronizePacked(remote, a);
  expect(a.events.map((e) => e.hash).sort()).toEqual(
    b.events.map((e) => e.hash).sort(),
  );
  expect(a.events.some((e) => e.hash === offline.hash)).toBe(true);
});
it("a competing conditional publisher cannot overwrite another device's operations", async () => {
  const remote = new MemoryRemote(),
    a = new MemoryReplica([await event(1)]),
    b = new MemoryReplica([await event(1, B)]);
  let release = () => {},
    arrived = 0;
  const barrier = new Promise<void>((resolve) => (release = resolve));
  remote.beforeCAS = async () => {
    if (++arrived === 2) release();
    if (arrived <= 2) await barrier;
  };
  await Promise.all([
    synchronizePacked(remote, a),
    synchronizePacked(remote, b),
  ]);
  remote.beforeCAS = undefined;
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(new Set(fresh.events.map((e) => e.op.device))).toEqual(
    new Set([A, B]),
  );
});
it("failed uploads and readback leave the previous committed head and all its objects intact", async () => {
  const remote = new MemoryRemote(),
    local = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, local);
  const before = structuredClone(remote.files),
    head = (await remote.readHead())!.body;
  local.events.push(await event(2));
  remote.failWrite = "packs/";
  await expect(synchronizePacked(remote, local)).rejects.toThrow(
    "upload failure",
  );
  expect((await remote.readHead())!.body).toBe(head);
  for (const [path, value] of before)
    expect(remote.files.get(path)).toBe(value);
  remote.failWrite = "";
  remote.failRead = "checkpoints/";
  await expect(synchronizePacked(remote, local)).rejects.toThrow(
    "read failure",
  );
  expect((await remote.readHead())!.body).toBe(head);
  remote.failRead = "";
  await synchronizePacked(remote, local);
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(fresh.events).toHaveLength(2);
});
it("partial deletion is retryable and never rolls back a successfully published replica", async () => {
  const remote = new MemoryRemote(),
    local = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, local);
  local.events.push(await event(2));
  remote.failRemove = true;
  const report = await synchronizePacked(remote, local, { compact: true });
  expect(report.cleanup.pending).toBeGreaterThan(0);
  remote.failRemove = false;
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(fresh.events).toHaveLength(2);
  expect(
    [...remote.files.keys()].filter((path) => path.startsWith("checkpoints/")),
  ).toHaveLength(1);
});
it("corrupted packs block new clients; explicit audit quarantines and repairs only matching local content", async () => {
  const remote = new MemoryRemote(),
    local = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, local);
  const manifest = await checkpoint(remote),
    path = manifest.packs[0].path;
  remote.files.set(path, '{"tampered":true}');
  await expect(
    synchronizePacked(remote, new MemoryReplica()),
  ).rejects.toThrow();
  expect(remote.files.get(path)).toBe('{"tampered":true}');
  const report = await synchronizePacked(remote, local, { audit: true });
  expect(report.repaired).toBe(1);
  expect(
    [...remote.files.keys()].some((path) => path.startsWith("quarantine/")),
  ).toBe(true);
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(fresh.events).toHaveLength(1);
});
it("a stale prepared writer cannot publish a path swept behind an epoch barrier", async () => {
  const remote = new MemoryRemote(),
    local = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, local);
  const stale = await remote.readHead(),
    head = parseHead(JSON.parse(stale!.body)),
    orphan = newPackedPath("packs", head.epoch, "f".repeat(64));
  remote.files.set(orphan, "abandoned");
  await synchronizePacked(remote, local);
  expect(remote.files.has(orphan)).toBe(false);
  expect(await remote.replaceHead(stale!.etag, stale!.body)).toBe(false);
  const future = newPackedPath(
    "packs",
    parseHead(JSON.parse((await remote.readHead())!.body)).epoch + 1,
    "e".repeat(64),
  );
  remote.files.set(future, "in flight");
  await synchronizePacked(remote, local);
  expect(remote.files.has(future)).toBe(true);
});
it("does not turn a missing root with unknown prepared data into an empty authoritative replica", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]);
  remote.failWrite = "checkpoints/";
  await expect(synchronizePacked(remote, source)).rejects.toThrow();
  remote.failWrite = "";
  await expect(synchronizePacked(remote, new MemoryReplica())).rejects.toThrow(
    "未合并数据",
  );
  expect(await remote.readHead()).toBeNull();
  await synchronizePacked(remote, source);
  expect((await checkpoint(remote)).count).toBe(1);
});

it("remembers unfinished loose-event retirement across a new device and clears its queue after successful deletion", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]),
    old = "events/" + source.events[0].hash + ".json";
  remote.files.set(old, canonical(source.events[0]));
  source.bootstrap = async () => ({
    events: source.events,
    assets: [],
    retire: [],
    looseEvents: true,
  });
  remote.failRemove = true;
  await synchronizePacked(remote, source);
  expect((await checkpoint(remote)).looseEvents).toBe(true);
  remote.failRemove = false;
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(remote.files.has(old)).toBe(false);
  expect((await checkpoint(remote)).retire).toEqual([]);
  remote.calls = [];
  await synchronizePacked(remote, fresh);
  expect(
    remote.calls.some(
      (call) => call.method === "DELETE" && call.path.startsWith("events/"),
    ),
  ).toBe(false);
});

it("a reader reloads the head when another device compacts its old pack during download", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, source);
  source.events.push(await event(2));
  let injected = false;
  remote.beforeRead = async (path) => {
    if (path.endsWith(".json.gz") && !injected) {
      injected = true;
      await synchronizePacked(remote, source, { compact: true });
    }
  };
  const reader = new MemoryReplica();
  await synchronizePacked(remote, reader);
  expect(injected).toBe(true);
  expect(reader.events).toHaveLength(2);
});
it("bad upload readback cannot publish or delete a previously committed object", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, source);
  const prior = structuredClone(remote.files),
    head = (await remote.readHead())!.body;
  source.events.push(await event(2));
  remote.afterWrite = (path) => {
    if (path.endsWith(".json.gz")) remote.files.set(path, "corrupt upload");
  };
  await expect(synchronizePacked(remote, source)).rejects.toThrow();
  expect((await remote.readHead())!.body).toBe(head);
  for (const [path, body] of prior) expect(remote.files.get(path)).toBe(body);
  remote.afterWrite = undefined;
  await synchronizePacked(remote, source);
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(fresh.events).toHaveLength(2);
});
it("a lost publication acknowledgment is idempotent on retry and preserves the newly committed history", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, source);
  source.events.push(await event(2));
  const replace = remote.replaceHead.bind(remote);
  let lost = false;
  remote.replaceHead = async (expected, body) => {
    const ok = await replace(expected, body);
    if (ok && !lost) {
      lost = true;
      throw Error("lost publication acknowledgment");
    }
    return ok;
  };
  await expect(
    synchronizePacked(remote, source, { compact: true }),
  ).rejects.toThrow("lost publication");
  await synchronizePacked(remote, source);
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(fresh.events).toHaveLength(2);
  expect(new Set(fresh.events.map((event) => event.hash)).size).toBe(2);
});
it("missing attachment bytes block projection until a verified source republishes them", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]),
    bytes = new Uint8Array([1, 2, 3, 4]),
    hash = await sha256(bytes),
    value = { hash, mime: "image/png", data: base64(bytes) };
  source.values.set(hash, value);
  await synchronizePacked(remote, source);
  remote.files.delete("blobs/" + hash + ".json");
  const fresh = new MemoryReplica();
  await expect(synchronizePacked(remote, fresh)).rejects.toThrow();
  expect(fresh.events).toHaveLength(0);
  await synchronizePacked(remote, source);
  await synchronizePacked(remote, fresh);
  expect(fresh.values.get(hash)).toEqual(value);
});
it("a surviving replica rebuilds a lost head above prior epochs without retaining orphaned generations", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, source);
  source.events.push(await event(2));
  await synchronizePacked(remote, source, { compact: true });
  const oldEpoch = parseHead(JSON.parse((await remote.readHead())!.body)).epoch;
  remote.files.delete("HEAD.json");
  await synchronizePacked(remote, source);
  expect(
    parseHead(JSON.parse((await remote.readHead())!.body)).epoch,
  ).toBeGreaterThan(oldEpoch);
  const fresh = new MemoryReplica();
  await synchronizePacked(remote, fresh);
  expect(fresh.events).toHaveLength(2);
  expect(
    [...remote.files.keys()].filter((path) => path.startsWith("checkpoints/")),
  ).toHaveLength(1);
});
it("missing head and missing packs cannot silently become an empty replica while a checkpoint remains", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, source);
  remote.files.delete("HEAD.json");
  for (const path of [...remote.files.keys()])
    if (path.startsWith("packs/")) remote.files.delete(path);
  await expect(synchronizePacked(remote, new MemoryReplica())).rejects.toThrow(
    "重建检查点",
  );
  expect(await remote.readHead()).toBeNull();
  expect(
    [...remote.files.keys()].some((path) => path.startsWith("checkpoints/")),
  ).toBe(true);
  await synchronizePacked(remote, source);
  expect((await checkpoint(remote)).count).toBe(1);
});

it("unrecoverable damaged rows remain untouched before any repair transaction", async () => {
  const remote = new MemoryRemote(),
    source = new MemoryReplica([await event(1)]);
  await synchronizePacked(remote, source);
  const missing = await event(1, B);
  for (const bootstrap of [false, true]) {
    const local = new MemoryReplica([await event(1)]);
    let applied = false;
    const read = local.read.bind(local);
    local.read = async () => ({
      ...(await read()),
      damaged: applied ? [] : [missing.hash],
    });
    local.apply = async () => {
      applied = true;
    };
    if (bootstrap) {
      remote.files.clear();
      local.bootstrap = async () => ({
        events: local.events,
        assets: [],
        retire: [],
        looseEvents: false,
      });
    }
    await expect(
      synchronizePacked(remote, local, { audit: true }),
    ).rejects.toThrow("No verified repair source");
    expect(applied).toBe(false);
  }
});
