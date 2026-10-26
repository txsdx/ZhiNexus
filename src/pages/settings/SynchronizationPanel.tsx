/** Synchronization configuration panel with explicit persistence and verification. */
import { useState } from "react";
import { sealCredentials, unlockCredentials } from "../../services/vault";
import { RefreshCw, Save, ShieldCheck } from "lucide-react";
import { store } from "../../core/store";
import { enableNotifications } from "../../services/device";
import { synchronize } from "../../services/sync";
import { useSettings } from "./context";
/** Manage HTTPS replication and an optional end-to-end encrypted credential vault. */
/** SynchronizationPanel exposes one focused settings workflow. */
export function SynchronizationPanel() {
  const [vaultPassword, setVaultPassword] = useState("");
  const { t, device, setDevice, act, notify, busy, setBusy, setReport, s } =
    useSettings();
  return (
    <>
      <h2>
        {t("随时离线，随处连接", "Offline anywhere. Connected everywhere.")}
      </h2>
      <div className="notice">
        <ShieldCheck size={18} />
        {t(
          "WebDAV 强制 HTTPS。不可变日志不覆盖整库，并发版本保留；凭证仅本设备保存。",
          "HTTPS is mandatory. Immutable logs preserve concurrent versions. Credentials stay on this device.",
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
      <label className="toggle">
        <input
          type="checkbox"
          checked={device.notifications}
          onChange={(e) => {
            const checked = e.target.checked;
            void act(t("通知权限", "Notification permission"), async () => {
              const allowed = checked ? await enableNotifications() : false;
              setDevice({ ...device, notifications: allowed });
              if (checked && !allowed)
                notify(
                  t(
                    "未获得系统通知权限",
                    "Notification permission was not granted",
                  ),
                );
            });
          }}
        />
        {t("在此设备提醒我复习", "Remind me on this device")}
      </label>
      <p className="muted">
        {t(
          "Android 使用系统排程，关闭页面后仍可提醒（系统省电或强制停止可能延迟或阻止）；桌面版目前仅运行期间提醒。电脑和手机可独立开关。",
          "Android alarms are scheduled with the OS and can fire after the webview closes; battery restrictions or force-stop can delay or prevent delivery. Desktop reminders currently require the app to run. Each device has its own switch.",
        )}
      </p>
      <div className="actions">
        <button
          className="primary"
          disabled={!!busy}
          onClick={() =>
            void act(t("保存同步设置", "Saving sync settings"), async () => {
              if (device.davUrl) {
                const { secureUrl } = await import("../../services/network");
                secureUrl(device.davUrl);
              }
              await store.saveDevice({
                ...store.getSnapshot().device,
                ...device,
              });
              notify(t("本设备设置已保存", "Device settings saved"));
            })
          }
        >
          <Save size={16} />
          {t("保存本设备设置", "Save device settings")}
        </button>
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
          {t("立即同步（使用已保存设置）", "Sync saved settings")}
        </button>
      </div>
      <p>
        {t("上次成功同步", "Last successful sync")}:{" "}
        {s.device.lastSync
          ? new Date(s.device.lastSync).toLocaleString()
          : t("尚未同步", "Never")}
      </p>
      <h3>{t("跨设备凭证保险箱", "Cross-device credential vault")}</h3>
      <p className="muted">
        {t(
          "如需同步全部 AI、WebDAV 和 MCP 凭证，设置至少12位保险箱密码。云端只存 AES-GCM 密文。另一设备先完成 WebDAV 同步，再用同一密码解锁。通知开关仍保持设备独立。密码不会保存，忘记后无法恢复。",
          "To replicate AI, WebDAV and MCP credentials, use a vault passphrase of at least 12 characters. Only AES-GCM ciphertext is replicated. Sync the other device first, then unlock with the same passphrase. Reminder preferences stay local. The passphrase is never stored.",
        )}
      </p>
      <label>
        {t("保险箱密码（不保存）", "Vault passphrase (not stored)")}
        <input
          type="password"
          autoComplete="off"
          value={vaultPassword}
          onChange={(e) => setVaultPassword(e.target.value)}
        />
      </label>
      <div className="actions">
        <button
          disabled={!!busy || vaultPassword.length < 12}
          onClick={() =>
            void act(t("加密凭证…", "Encrypting credentials…"), async () => {
              await sealCredentials(vaultPassword);
              setVaultPassword("");
              notify(
                t(
                  "已加密保存；下一次同步将传输密文",
                  "Vault sealed; next sync will transfer ciphertext",
                ),
              );
            })
          }
        >
          {t("封存本机已保存凭证供同步", "Seal saved credentials for sync")}
        </button>
        <button
          disabled={!!busy || !vaultPassword}
          onClick={() =>
            void act(t("解锁凭证…", "Unlocking credentials…"), async () => {
              await unlockCredentials(vaultPassword);
              setVaultPassword("");
              setDevice(structuredClone(store.getSnapshot().device));
              notify(t("已应用保险箱中的凭证", "Vault credentials applied"));
            })
          }
        >
          {t("解锁并应用共享凭证", "Unlock and apply shared credentials")}
        </button>
      </div>
      <p className="muted">
        {t(
          "对象存储与专属服务端已预留 Transport 接口，本版不提供连接器。浏览器访问 WebDAV 需要服务端允许 CORS。",
          "Object storage and dedicated-server transport contracts are reserved; connectors are not implemented. Browser WebDAV requires server CORS.",
        )}
      </p>
    </>
  );
}
