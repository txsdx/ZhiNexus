/** Synchronization configuration panel with explicit persistence and verification. */
import { useSyncExternalStore } from "react";
import { keySyncStatus } from "../../services/key-sync";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { synchronize } from "../../services/sync";
import { useSettings } from "./context";
/** Configure HTTPS replication and one optional encryption key for all shared credentials. */
/** SynchronizationPanel exposes one focused settings workflow. */
export function SynchronizationPanel() {
  const keyStatus = useSyncExternalStore(
    keySyncStatus.subscribe,
    keySyncStatus.getSnapshot,
  );
  const { t, device, setDevice, act, busy, setBusy, setReport, s } =
    useSettings();
  return (
    <>
      <h3>{t("WebDAV 云同步", "WebDAV cloud sync")}</h3>
      <div className="notice">
        <ShieldCheck size={18} />
        {t(
          "WebDAV 强制 HTTPS。不可变日志不覆盖整库，并发版本保留；AI Key、WebDAV 和 MCP 凭证自动加密保存并同步。",
          "HTTPS is mandatory. Immutable logs preserve concurrent versions. AI, WebDAV and MCP credentials are saved and synchronized encrypted automatically.",
        )}
      </div>
      <label>
        {t("WebDAV 根目录", "WebDAV root directory")}
        <input
          placeholder="https://dav.example.com/ZhiNexus/"
          value={device.davUrl}
          onChange={(e) => setDevice({ ...device, davUrl: e.target.value })}
        />
      </label>
      <div className="form-grid">
        <label>
          {t("用户名", "Username")}
          <input
            autoComplete="off"
            value={device.davUser}
            onChange={(e) => setDevice({ ...device, davUser: e.target.value })}
          />
        </label>
        <label>
          {t("密码 / 应用密码", "Password / app password")}
          <input
            type="password"
            autoComplete="off"
            value={device.davPassword}
            onChange={(e) =>
              setDevice({ ...device, davPassword: e.target.value })
            }
          />
        </label>
      </div>
      <label>
        {t(
          "自动同步间隔（分钟；0 为手动）",
          "Sync interval (minutes; 0 for manual)",
        )}
        <input
          type="number"
          min="0"
          max="1440"
          value={device.syncMinutes}
          onChange={(e) =>
            setDevice({
              ...device,
              syncMinutes: Math.max(0, Math.min(1440, Number(e.target.value))),
            })
          }
        />
      </label>
      <div className="actions">
        <button
          disabled={!!busy}
          onClick={() =>
            void act(t("同步中…", "Syncing…"), async () => {
              const r = await synchronize(undefined, setBusy);
              setReport(JSON.stringify(r, null, 2));
            })
          }
        >
          <RefreshCw size={16} />
          {t("立即同步", "Sync now")}
        </button>
      </div>
      <p>
        {t("上次成功同步", "Last successful sync")}:{" "}
        {s.device.lastSync
          ? new Date(s.device.lastSync).toLocaleString()
          : t("尚未同步", "Never")}
      </p>
      <label>
        {t("自定义同步密钥（可选）", "Custom synchronization key (optional)")}
        <input
          type="password"
          autoComplete="off"
          value={device.apiKeySyncKey ?? ""}
          onChange={(e) =>
            setDevice({ ...device, apiKeySyncKey: e.target.value })
          }
          placeholder={t(
            "留空使用默认密钥加密",
            "Leave blank to encrypt with the default key",
          )}
        />
      </label>
      <p className="muted">
        {t(
          "留空时使用默认密钥，AI Key、WebDAV 和 MCP 凭证自动加密保存并随数据同步。默认密钥随程序提供；如填写自定义同步密钥，各设备需使用相同的值。首次连接仍需填写 WebDAV 地址和账号。",
          "Leave blank to use the default key. AI, WebDAV and MCP credentials are encrypted and synchronized automatically. The default key ships with the app; a custom key must match on every device. Enter your WebDAV address and account to connect a new device first.",
        )}
      </p>
      {keyStatus.message && <p role="status">{keyStatus.message}</p>}
      <p className="muted">
        {t(
          "对象存储与专属服务端已预留 Transport 接口，本版不提供连接器。浏览器访问 WebDAV 需要服务端允许 CORS。",
          "Object storage and dedicated-server transport contracts are reserved; connectors are not implemented. Browser WebDAV requires server CORS.",
        )}
      </p>
    </>
  );
}
