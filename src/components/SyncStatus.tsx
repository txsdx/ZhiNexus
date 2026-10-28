/** A live last-success timer and one-click synchronization control shared by every application page. */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useKnowledge, useT } from "./common";
import { store } from "../core/store";
import { syncActivity, synchronize } from "../services/sync";
import { flushSettings } from "../services/settings";
import { diagnostics } from "../services/diagnostics";

/** Display elapsed minutes/seconds without writing clock ticks to storage or rerendering the document. */
export function SyncStatus({ notify }: { notify: (message: string) => void }) {
  const s = useKnowledge(),
    t = useT();
  const syncing = useSyncExternalStore(
    syncActivity.subscribe,
    syncActivity.getSnapshot,
  );
  const [now, setNow] = useState(Date.now),
    [pending, setPending] = useState(false);
  const starting = useRef(false);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const last = Date.parse(s.device.lastSync),
    valid = Number.isFinite(last);
  const seconds = valid ? Math.max(0, Math.floor((now - last) / 1000)) : 0;
  const elapsed = valid
    ? t(
        `${Math.floor(seconds / 60)}分${seconds % 60}秒`,
        `${Math.floor(seconds / 60)}m${seconds % 60}s`,
      )
    : t("尚未同步", "Never synced");
  const busy = pending || syncing;
  const run = async () => {
    if (starting.current || syncActivity.getSnapshot()) return;
    starting.current = true;
    setPending(true);
    try {
      await flushSettings();
      if (!store.getSnapshot().device.davUrl.trim())
        throw Error(
          t(
            "请先在设置中配置 WebDAV 云同步",
            "Configure WebDAV cloud sync in settings first",
          ),
        );
      await synchronize();
      setNow(Date.now());
    } catch (error) {
      diagnostics.error("app", "手动同步失败 / Manual sync failed", error);
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      starting.current = false;
      setPending(false);
    }
  };
  return (
    <button
      className="topbar-status sync-status"
      aria-label={t("点击立即同步", "Sync now from status")}
      aria-busy={busy}
      disabled={busy}
      title={
        busy
          ? t("同步或校验进行中", "Sync or audit in progress")
          : t(
              `距上次成功同步：${elapsed}；点击立即同步`,
              `Since last successful sync: ${elapsed}; click to sync now`,
            )
      }
      onClick={() => void run()}
    >
      <span className="status-dot" />
      <span className="sync-status-content">
        <span>{t("同步过时：", "Sync age: ")}</span>
        <span>{busy ? t("同步中…", "Syncing…") : elapsed}</span>
      </span>
    </button>
  );
}
