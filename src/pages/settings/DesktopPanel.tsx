/** Device-local background, startup shortcut and global hotkey controls with native validation. */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  desktopAvailable,
  defaultDesktop,
  quitDesktop,
} from "../../services/desktop";
import { store } from "../../core/store";
import type { DesktopPreferences } from "../../core/types";
import { useSettings } from "./context";
/** Keep OS integrations explicit and report actual shortcut conflicts without silently dropping registrations. */
export function DesktopPanel() {
  const { t, act, busy, notify } = useSettings();
  const [settings, setSettings] = useState(defaultDesktop),
    [warning, setWarning] = useState("");
  useEffect(() => {
    if (desktopAvailable)
      void invoke<{ settings: DesktopPreferences; warning: string }>(
        "desktop_configuration",
      )
        .then((value) => {
          setSettings(value.settings);
          setWarning(value.warning);
        })
        .catch((e) => setWarning(String(e)));
  }, []);
  if (!desktopAvailable)
    return (
      <>
        <h2>{t("后台与快捷键", "Background & shortcuts")}</h2>
        <p>
          {t(
            "桌面客户端支持系统托盘、开机自启和全局快捷键。Android 通知请在通知设置中配置。",
            "The desktop client supports tray, startup and global shortcuts. Configure Android notifications on the Notifications page.",
          )}
        </p>
      </>
    );
  return (
    <>
      <h2>{t("随时记下一点新知", "Capture knowledge anytime")}</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.background}
          onChange={(e) =>
            setSettings({ ...settings, background: e.target.checked })
          }
        />
        {t(
          "关闭主窗口后常驻托盘",
          "Keep running in the tray when the main window closes",
        )}
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.autostart}
          onChange={(e) =>
            setSettings({ ...settings, autostart: e.target.checked })
          }
        />
        {t("开机自启动（后台启动）", "Start in the background at login")}
      </label>
      <p className="muted">
        {t(
          "Windows 使用当前用户 Startup 文件夹中的快捷方式。Ubuntu 使用 XDG autostart；无需管理员权限。",
          "Uses a shortcut in the current user's Windows Startup folder, or XDG autostart on Ubuntu. Administrator privileges are not required.",
        )}
      </p>
      {(
        [
          ["captureShortcut", t("快速添加选中内容", "Capture selected text")],
          ["ocrShortcut", t("截图 OCR", "Screenshot OCR")],
          ["showShortcut", t("显示主窗口", "Show main window")],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            value={settings[key]}
            onChange={(e) =>
              setSettings({ ...settings, [key]: e.target.value })
            }
            placeholder="CommandOrControl+Shift+N"
          />
        </label>
      ))}
      <p className="muted">
        {t(
          "快捷键留空可禁用；更改时会检查占用。系统 DPI 在启动时读取并跟随屏幕变化，字体大小可在外观页单独调整。",
          "Leave a shortcut empty to disable it. Conflicts are checked before changes. System DPI follows the display; font size is adjustable on the Appearance page.",
        )}
      </p>
      {warning && <p role="alert">{warning}</p>}
      <div className="actions">
        <button
          className="primary"
          disabled={!!busy}
          onClick={() =>
            void act(
              t("应用桌面设置", "Applying desktop preferences"),
              async () => {
                await invoke("configure_desktop", { settings });
                await store.saveDevice({
                  ...store.getSnapshot().device,
                  desktop: settings,
                });
                setWarning("");
                notify(
                  t("后台与快捷键设置已保存", "Desktop preferences saved"),
                );
              },
            )
          }
        >
          {t("保存并应用", "Save and apply")}
        </button>
        <button
          disabled={!!busy}
          onClick={() => void act(t("退出", "Quitting"), quitDesktop)}
        >
          {t("完全退出程序", "Quit application")}
        </button>
      </div>
    </>
  );
}
