/** Explicit full replica auditing and verified repair, using the same packed protocol as ordinary synchronization. */
import { native } from "../core/database";
import { store } from "../core/store";
import { validateEnvelope, materialize, stateHash } from "../core/crdt";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import { canonical, merkle } from "../core/crypto";
import { WebDAV, type SyncTransport, withSyncLock } from "./sync";
import { synchronizePacked } from "./packed-replica";
import { sqliteReplica } from "./sync-replica";
import { diagnostics } from "./diagnostics";
import { flushKeySync } from "./key-sync";
/** Construct a provider from saved connection fields; credentials never enter diagnostic reports. */
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
/** Deep verification re-reads wire objects and uses matching trusted copies; no cloud rollback history is required. */
export async function auditAndRepair(
  transport: SyncTransport = configuredTransport(),
  progress: (message: string) => void = () => {},
  options: { compact?: boolean } = {},
) {
  return withSyncLock(async () => {
    await flushKeySync();
    const report = await store.maintain(async () => {
      const packed = await synchronizePacked(
        transport,
        sqliteReplica(transport, true, progress),
        { audit: true, compact: options.compact, progress },
      );
      if (packed.cleanup.errors.length)
        diagnostics.error(
          "app",
          "云端清理待重试 / Cloud cleanup pending",
          packed.cleanup.errors,
        );
      const local = await auditLocal();
      if (local.root !== packed.root || local.state !== packed.state)
        throw Error(
          "本地仍有并发修改，未清理恢复副本，请重试 / Local state changed; recovery cleanup skipped, retry",
        );
      await store.db.checkpoint();
      const localCleanup = native
        ? await (
            await import("@tauri-apps/api/core")
          ).invoke<{ files: number; bytes: number }>("cleanup_storage")
        : { files: 0, bytes: 0 };
      const result = {
        ...packed,
        cloudRoot: packed.root,
        cloudState: packed.state,
        localCleanup,
      };
      await store.db.setLocal("last-packed-sync", result);
      return result;
    });
    await store.updateDevice({ lastSync: new Date().toISOString() });
    return report;
  });
}
