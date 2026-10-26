/** Deep replica auditing, verified cloud snapshot recovery and repair from provably matching local content. */
import { z } from "zod";
import { store } from "../core/store";
import { validateEnvelope, materialize, stateHash } from "../core/crdt";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import { canonical, sha256, merkle, base64, unbase64 } from "../core/crypto";
import { WebDAV, type SyncTransport, restoreSnapshot } from "./sync";
/** Construct a provider only from the saved device connection, keeping credentials out of diagnostics. */
function configuredTransport() {
  const d = store.getSnapshot().device;
  return new WebDAV(d.davUrl, d.davUser, d.davPassword);
}
/** Verify every local record and all referenced attachments, including historical versions. */
export async function auditLocal() {
  const events = await store.db.events();
  for (const e of events) await validateEnvelope(e);
  assertCausalClosure(events);
  validateDocuments(materialize(events));
  const hashes = new Set(await store.db.blobHashes());
  for (const e of events)
    for (const m of canonical(e.op.patch).matchAll(/asset:([a-f0-9]{64})/g))
      if (!hashes.has(m[1]))
        throw Error(
          "缺失引用附件 / Missing referenced asset: " + m[1].slice(0, 12),
        );
  for (const hash of hashes) await store.db.blob(hash);
  if ((await store.db.integrity()) !== "ok")
    throw Error("SQLite integrity_check failed");
  return {
    root: await merkle([...events.map((e) => e.hash), ...hashes]),
    state: await stateHash(events),
    events: events.length,
    blobs: hashes.size,
  };
}
/** Recover verified snapshot unions; invalid archives are skipped and explicitly reported, never applied. */
export async function recoverCloudSnapshots(
  transport: SyncTransport = configuredTransport(),
) {
  await transport.init();
  const names = await transport.list("snapshots");
  if (!names.length) throw Error("云端没有快照 / No cloud snapshots");
  let restored = 0;
  const rejected: string[] = [];
  for (const name of names) {
    try {
      const data = JSON.parse(await transport.read("snapshots/" + name));
      if ((await sha256(data)) !== name.slice(0, -5))
        throw Error("Snapshot address mismatch");
      await restoreSnapshot(data);
      restored++;
    } catch {
      rejected.push(name.slice(0, 12));
    }
  }
  if (!restored)
    throw Error("未找到可验证快照，原始数据保留 / No verified snapshots");
  return { restored, rejected, ...(await auditLocal()) };
}
/** Audit remote bytes instead of trusting filenames; quarantine before repairing from matching verified local data. */
export async function auditAndRepair(
  transport: SyncTransport = configuredTransport(),
  progress: (s: string) => void = () => {},
) {
  await auditLocal();
  await transport.init();
  const local = new Map((await store.db.events()).map((e) => [e.hash, e])),
    remote = new Set(await transport.list("events")),
    incoming: unknown[] = [];
  let repaired = 0,
    checked = 0;
  for (const name of remote) {
    progress("校验日志 / Auditing operations: " + ++checked);
    const hash = name.slice(0, -5),
      raw = await transport.read("events/" + name);
    try {
      const e = await validateEnvelope(JSON.parse(raw));
      if (e.hash !== hash) throw Error("address mismatch");
      if (!local.has(hash)) incoming.push(e);
    } catch {
      const good = local.get(hash);
      if (!good)
        throw Error(
          "远端损坏日志无可验证副本，请从文件或云快照恢复 / No verified repair source: " +
            hash.slice(0, 12),
        );
      await transport.write(
        "quarantine/" + (await sha256(raw)) + ".json",
        canonical({
          path: "events/" + name,
          raw,
          at: new Date().toISOString(),
        }),
      );
      await transport.write("events/" + name, canonical(good));
      const verified = await validateEnvelope(
        JSON.parse(await transport.read("events/" + name)),
      );
      if (verified.hash !== hash) throw Error("Repair read-back failed");
      repaired++;
    }
  }
  await store.ingest(incoming);
  for (const e of await store.db.events())
    if (!remote.has(e.hash + ".json")) {
      await transport.write("events/" + e.hash + ".json", canonical(e));
      repaired++;
    }
  const localBlobs = new Set(await store.db.blobHashes()),
    remoteBlobs = new Set(await transport.list("blobs"));
  for (const hash of new Set([
    ...localBlobs,
    ...[...remoteBlobs].map((n) => n.slice(0, -5)),
  ])) {
    const path = "blobs/" + hash + ".json";
    let raw = "";
    try {
      if (!remoteBlobs.has(hash + ".json")) throw Error("missing");
      raw = await transport.read(path);
      const b = z
        .object({ hash: z.string(), mime: z.string(), data: z.string() })
        .parse(JSON.parse(raw));
      if (b.hash !== hash || (await sha256(unbase64(b.data))) !== hash)
        throw Error("corrupt");
      if (!localBlobs.has(hash))
        await store.db.putBlob(unbase64(b.data), b.mime, hash);
    } catch {
      const good = await store.db.blob(hash);
      if (!good)
        throw Error(
          "缺少可验证附件副本 / No verified asset source: " + hash.slice(0, 12),
        );
      if (raw)
        await transport.write(
          "quarantine/" + (await sha256(raw)) + ".json",
          canonical({ path, raw, at: new Date().toISOString() }),
        );
      await transport.write(
        path,
        canonical({ hash, mime: good.mime, data: base64(good.bytes) }),
      );
      const b = JSON.parse(await transport.read(path));
      if ((await sha256(unbase64(b.data))) !== hash)
        throw Error("Asset repair read-back failed");
      repaired++;
    }
  }
  await store.db.checkpoint();
  return { checked, repaired, ...(await auditLocal()) };
}
