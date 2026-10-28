/** Automatic sync ownership and wakeup signals; successful background work remains silent. */
import { AutoSyncClock } from "../core/auto-sync";
import { store } from "../core/store";
import { synchronize, syncActivity } from "./sync";
import { diagnostics } from "./diagnostics";
import { notifyCompletion } from "./notifications";
import type { DeviceConfig } from "../core/types";
/** Bind one scheduler to the application's durable device configuration and shared manual/audit lock. */
export function startAutomaticSync(notify: (message: string) => void) {
  const clock = new AutoSyncClock({
    read: () => {
      const d = store.getSnapshot().device;
      return {
        key: d.davUrl
          ? JSON.stringify([d.davUrl, d.davUser, d.davPassword])
          : "",
        minutes: d.syncMinutes,
        lastSuccess: Date.parse(d.lastSync) || 0,
        online: navigator.onLine !== false,
        busy: syncActivity.getSnapshot(),
      };
    },
    run: async (): Promise<number | false> => {
      const exchange = async (): Promise<number | false> => {
        if (syncActivity.getSnapshot()) return false;
        const d = store.getSnapshot().device,
          saved = await store.db.local<DeviceConfig>("device", d),
          last = Date.parse(saved.lastSync) || 0;
        if (
          saved.davUrl === d.davUrl &&
          last <= Date.now() &&
          Date.now() - last < Math.max(1, d.syncMinutes) * 60000
        )
          return last;
        await synchronize();
        return Date.parse(store.getSnapshot().device.lastSync) || Date.now();
      };
      if (!navigator.locks) return exchange();
      return navigator.locks.request(
        "zhinexus-auto-sync",
        { ifAvailable: true },
        (lock) => (lock ? exchange() : Promise.resolve<false>(false)),
      );
    },
    failed: (error) => {
      diagnostics.error(
        "app",
        "自动同步失败，将重试 / Automatic sync failed; retry scheduled",
        error,
      );
      const message = error instanceof Error ? error.message : String(error);
      notify(message);
      void notifyCompletion("sync", message).catch(() => {});
    },
  });
  let signature = "";
  const unsubscribe = store.subscribe(() => {
    const d = store.getSnapshot().device,
      next = JSON.stringify([
        d.davUrl,
        d.davUser,
        d.davPassword,
        d.syncMinutes,
        d.lastSync,
      ]);
    if (signature !== next) {
      signature = next;
      clock.wake();
    }
  });
  const stopActivity = syncActivity.subscribe(() => clock.wake());
  const visible = () => {
    if (document.visibilityState === "visible") clock.wake();
  };
  const focus = () => clock.wake(),
    online = () => clock.wake(true);
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("focus", focus);
  window.addEventListener("online", online);
  clock.start();
  return () => {
    clock.stop();
    unsubscribe();
    stopActivity();
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("focus", focus);
    window.removeEventListener("online", online);
  };
}
