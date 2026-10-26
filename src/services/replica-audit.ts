/** Full replica reconciliation: validate a union before repair, then re-read remote bytes to prove convergence. */
import { z } from "zod";
import { native } from "../core/database";
import { store } from "../core/store";
import type { Envelope } from "../core/types";
import { validateEnvelope, materialize, stateHash } from "../core/crdt";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import { canonical, sha256, merkle, base64, unbase64 } from "../core/crypto";
import { verifySnapshot, type SyncTransport } from "./sync";
const assetSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.string(),
  data: z.string(),
});
type Asset = z.infer<typeof assetSchema>;
/** Reject hash/name mismatches even when a payload has an otherwise valid internal digest. */
async function asset(input: unknown, hash: string): Promise<Asset> {
  const b = assetSchema.parse(input);
  const bytes = unbase64(b.data);
  if (
    b.hash !== hash ||
    bytes.length > 20 * 1024 * 1024 ||
    (await sha256(bytes)) !== hash
  )
    throw Error("Asset address mismatch");
  return b;
}
/** Validate causal counters and every historical attachment reference before any replacement. */
function validateUnion(events: Envelope[], blobs: Map<string, Asset>) {
  const dots = new Map<string, string>();
  for (const e of events) {
    const dot = e.op.device + ":" + e.op.seq;
    if (dots.has(dot) && dots.get(dot) !== e.hash)
      throw Error("设备计数器冲突 / Conflicting writer counter");
    dots.set(dot, e.hash);
    for (const m of canonical(e.op.patch).matchAll(/asset:([a-f0-9]{64})/g))
      if (!blobs.has(m[1]))
        throw Error(
          "缺少可验证附件副本 / No verified asset source: " + m[1].slice(0, 12),
        );
  }
  assertCausalClosure(events);
  validateDocuments(materialize(events));
}
/** Compare only canonical, verified content; never trust a device's advisory manifest. */
async function digest(events: Envelope[], blobs: Map<string, Asset>) {
  return {
    root: await merkle([...events.map((e) => e.hash), ...blobs.keys()]),
    state: await stateHash(events),
  };
}
/** Build the fullest published union, preserving unknown corruption and refusing cleanup on instability. */
export async function reconcileReplicas(
  transport: SyncTransport,
  progress: (s: string) => void,
) {
  await transport.init();
  let repaired = 0,
    checked = 0;
  for (let round = 0; round < 3; round++) {
    const events = new Map<string, Envelope>(),
      blobs = new Map<string, Asset>();
    const damaged = new Set<string>();
    const badRemote = new Map<string, string>();
    const names = {
      events: await transport.list("events"),
      blobs: await transport.list("blobs"),
      snapshots: await transport.list("snapshots"),
    };
    const takeEvent = async (hash: string, raw: string) => {
      const e = await validateEnvelope(JSON.parse(raw));
      if (e.hash !== hash) throw Error("Operation address mismatch");
      events.set(hash, e);
    };
    for (const row of await store.db.rawEvents()) {
      try {
        await takeEvent(row.hash, row.json);
      } catch {
        damaged.add("events/" + row.hash + ".json");
      }
    }
    for (const hash of await store.db.blobHashes()) {
      try {
        const b = (await store.db.blob(hash))!;
        blobs.set(hash, { hash, mime: b.mime, data: base64(b.bytes) });
      } catch {
        damaged.add("blobs/" + hash + ".json");
      }
    }
    if (native) {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const kind of ["events", "blobs"] as const)
        for (const r of await invoke<{ id: string; data: string }[]>(
          "read_storage_journal",
          { kind },
        )) {
          try {
            if (kind === "events") await takeEvent(r.id, r.data);
            else
              blobs.set(
                r.id,
                await asset({ hash: r.id, ...JSON.parse(r.data) }, r.id),
              );
          } catch {
            damaged.add(kind + "/" + r.id + ".json");
          }
        }
    }
    // A valid complete archive can supply missing/corrupt immutable records in either replica.
    for (const name of names.snapshots) {
      const raw = await transport.read("snapshots/" + name),
        data = JSON.parse(raw);
      if ((await sha256(data)) !== name.slice(0, -5))
        throw Error(
          "云快照损坏，保留原文件 / Corrupt cloud snapshot: " +
            name.slice(0, 12),
        );
      const s = await verifySnapshot(data);
      for (const e of s.events) events.set(e.hash, e);
      for (const b of s.blobs) blobs.set(b.hash, await asset(b, b.hash));
    }
    for (const kind of ["events", "blobs"] as const) {
      for (const name of names[kind]) {
        progress("云端深度校验 / Cloud deep audit: " + ++checked);
        const path = kind + "/" + name,
          hash = name.slice(0, -5),
          raw = await transport.read(path);
        try {
          if (kind === "events") await takeEvent(hash, raw);
          else blobs.set(hash, await asset(JSON.parse(raw), hash));
        } catch {
          damaged.add(path);
          badRemote.set(path, raw);
        }
      }
    }
    for (const path of damaged) {
      const [kind, name] = path.split("/"),
        hash = name.slice(0, -5);
      if (!(kind === "events" ? events : blobs).has(hash))
        throw Error(
          "损坏记录没有同摘要可信副本，未清理文件 / No verified repair source: " +
            path,
        );
    }
    const all = [...events.values()];
    validateUnion(all, blobs);
    // Repair the local copy even when an existing SQL row is corrupt; retain replaced bytes first.
    repaired += await store.db.repair(all, [...blobs.values()]);
    for (const [path, raw] of badRemote) {
      const quarantine =
        "quarantine/" + (await sha256({ path, raw })) + ".json";
      const retained = canonical({ path, raw });
      await transport.write(quarantine, retained);
      if ((await transport.read(quarantine)) !== retained)
        throw Error("Quarantine read-back failed");
    }
    for (const [kind, values] of [
      ["events", events],
      ["blobs", blobs],
    ] as const)
      for (const [hash, value] of values) {
        const path = kind + "/" + hash + ".json";
        if (!names[kind].includes(hash + ".json") || badRemote.has(path)) {
          await transport.write(path, canonical(value));
          repaired++;
        }
      }
    // Re-read every actual remote byte after writes, then discover concurrent additions again.
    const remoteEvents: Envelope[] = [],
      remoteBlobs = new Map<string, Asset>();
    for (const hash of events.keys()) {
      const e = await validateEnvelope(
        JSON.parse(await transport.read("events/" + hash + ".json")),
      );
      if (e.hash !== hash) throw Error("Repair read-back failed");
      remoteEvents.push(e);
    }
    for (const hash of blobs.keys())
      remoteBlobs.set(
        hash,
        await asset(
          JSON.parse(await transport.read("blobs/" + hash + ".json")),
          hash,
        ),
      );
    const stable = (a: string[], b: string[]) =>
      canonical([...new Set(a)].sort()) === canonical([...new Set(b)].sort());
    if (
      !stable(
        await transport.list("events"),
        [...events.keys()].map((h) => h + ".json"),
      ) ||
      !stable(
        await transport.list("blobs"),
        [...blobs.keys()].map((h) => h + ".json"),
      ) ||
      !stable(await transport.list("snapshots"), names.snapshots)
    )
      continue;
    const localEvents = await store.db.events();
    const localBlobs = new Map<string, Asset>();
    for (const hash of await store.db.blobHashes()) {
      const b = (await store.db.blob(hash))!;
      localBlobs.set(hash, { hash, mime: b.mime, data: base64(b.bytes) });
    }
    validateUnion(localEvents, localBlobs);
    const local = await digest(localEvents, localBlobs),
      remote = await digest(remoteEvents, remoteBlobs);
    if (canonical(local) !== canonical(remote)) continue;
    if ((await store.db.integrity()) !== "ok")
      throw Error("SQLite integrity_check failed; cleanup skipped");
    await store.db.checkpoint();
    const cleanup = native
      ? await (
          await import("@tauri-apps/api/core")
        ).invoke<{ files: number; bytes: number }>("cleanup_storage")
      : { files: 0, bytes: 0 };
    return {
      checked,
      repaired,
      events: localEvents.length,
      blobs: localBlobs.size,
      ...local,
      cloudRoot: remote.root,
      cloudState: remote.state,
      cleanup,
    };
  }
  throw Error(
    "云端仍有并发变更，已保留合并结果，未执行清理；请稍后重试 / Cloud is changing; merged data retained, cleanup skipped. Retry shortly.",
  );
}
