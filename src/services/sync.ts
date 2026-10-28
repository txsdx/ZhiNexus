/** Packed WebDAV synchronization with atomic checkpoints and verified, resumable garbage collection. */
import { store } from "../core/store";
import { flushKeySync } from "./key-sync";
import { synchronizePacked, type PackedReport } from "./packed-replica";
import { diagnostics } from "./diagnostics";
import { sqliteReplica } from "./sync-replica";
import { WebDAV, type SyncTransport } from "./sync-transport";
export { WebDAV } from "./sync-transport";
export type { SyncTransport } from "./sync-transport";
/** Verified data counts and cloud reclamation progress from one captured exchange. */
export type SyncReport = PackedReport;
let syncing = false;
const syncListeners = new Set<() => void>();
/** Observe the shared exchange/audit lock so every sync control reflects in-flight work. */
export const syncActivity = {
  getSnapshot: () => syncing,
  subscribe: (listener: () => void) => {
    syncListeners.add(listener);
    return () => {
      syncListeners.delete(listener);
    };
  },
};
/** Share one gate between automatic exchange and explicit deep audit. */
export async function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  if (syncing) throw Error("同步或校验正在进行 / Sync or audit in progress");
  syncing = true;
  syncListeners.forEach((listener) => listener());
  try {
    return await work();
  } finally {
    syncing = false;
    syncListeners.forEach((listener) => listener());
  }
}
/** Merge immutable batches and publish through compare-and-swap; successful background sync remains silent. */
export async function synchronize(
  transport?: SyncTransport,
  onProgress: (message: string) => void = () => {},
): Promise<SyncReport> {
  return withSyncLock(async () => {
    await flushKeySync();
    const { device } = store.getSnapshot(),
      remote =
        transport ??
        new WebDAV(device.davUrl, device.davUser, device.davPassword);
    const report = await synchronizePacked(
      remote,
      sqliteReplica(remote, false, onProgress),
      { progress: onProgress },
    );
    if ((await store.db.integrity()) !== "ok")
      throw Error("SQLite 完整性检查失败 / SQLite integrity check failed");
    if (report.cleanup.errors.length)
      diagnostics.error(
        "app",
        "云端冗余清理未完成，将自动重试 / Cloud cleanup will retry",
        report.cleanup.errors,
      );
    await store.db.setLocal("last-packed-sync", report);
    await store.updateDevice({ lastSync: new Date().toISOString() });
    return report;
  });
}
