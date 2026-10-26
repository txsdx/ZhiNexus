/** Deep replica auditing, verified cloud snapshot recovery and repair from provably matching local content. */
import { reconcileReplicas } from "./replica-audit";
import { store } from "../core/store";
import { validateEnvelope, materialize, stateHash } from "../core/crdt";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import { canonical, sha256, merkle } from "../core/crypto";
import {
  WebDAV,
  type SyncTransport,
  restoreSnapshot,
  withSyncLock,
} from "./sync";
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
/** Verify both replicas, repair only from matching trusted copies and clean proven recovery redundancy. */
export async function auditAndRepair(
  transport: SyncTransport = configuredTransport(),
  progress: (s: string) => void = () => {},
) {
  return withSyncLock(async () => {
    const report = await store.maintain(() =>
      reconcileReplicas(transport, progress),
    );
    await store.updateDevice({ lastSync: new Date().toISOString() });
    return report;
  });
}
