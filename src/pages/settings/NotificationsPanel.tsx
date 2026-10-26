/** Independent device notification settings for reviews, unfocused AI/OCR completion and sync failures. */
import { store } from "../../core/store";
import { enableNotifications } from "../../services/device";
import {
  defaultNotifications,
  testNotification,
} from "../../services/notifications";
import { useSettings } from "./context";
/** Persist notification choices separately from appearance and synchronization credentials. */
export function NotificationsPanel() {
  const { t, device, setDevice, busy, act, notify } = useSettings();
  const options = { ...defaultNotifications, ...device.notificationOptions };
  const update = (key: keyof typeof options, value: boolean | number) =>
    setDevice({ ...device, notificationOptions: { ...options, [key]: value } });
  return (
    <>
      <h2>{t("按你的节奏提醒", "Notifications on your terms")}</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={device.notifications}
          onChange={(e) =>
            setDevice({ ...device, notifications: e.target.checked })
          }
        />
        {t("复习到期提醒（本设备）", "Due review reminders on this device")}
      </label>
      {(
        [
          [
            "aiWhenUnfocused",
            t(
              "主窗口失去焦点后，AI 响应结束时通知",
              "Notify when AI finishes while the main window is unfocused",
            ),
          ],
          [
            "ocrWhenUnfocused",
            t(
              "失去焦点后，OCR 完成时通知",
              "Notify when OCR finishes while unfocused",
            ),
          ],
          [
            "syncFailures",
            t(
              "自动同步失败时通知",
              "Notify when automatic synchronization fails",
            ),
          ],
          ["preview", t("允许通知预览内容", "Include content previews")],
        ] as const
      ).map(([key, label]) => (
        <label className="toggle" key={key}>
          <input
            type="checkbox"
            checked={options[key]}
            onChange={(e) => update(key, e.target.checked)}
          />
          {label}
        </label>
      ))}
      <label>
        {t(
          "同类通知最小间隔（秒）",
          "Minimum interval per notification type (seconds)",
        )}
        <input
          type="number"
          min={0}
          max={300}
          value={options.cooldownSeconds}
          onChange={(e) =>
            update(
              "cooldownSeconds",
              Math.min(300, Math.max(0, Number(e.target.value))),
            )
          }
        />
      </label>
      <p className="muted">
        {t(
          "Android 到期提醒交给系统排程；桌面后台常驻时继续提醒。系统强制停止或省电设置可能影响展示。默认不预览学习内容。",
          "Android review alarms use OS scheduling. Desktop reminders continue while running in the background. Force-stop and battery settings can affect delivery. Content previews are off by default.",
        )}
      </p>
      <div className="actions">
        <button
          className="primary"
          disabled={!!busy}
          onClick={() =>
            void act(
              t("保存通知设置", "Saving notification settings"),
              async () => {
                const enabled =
                  device.notifications ||
                  options.aiWhenUnfocused ||
                  options.ocrWhenUnfocused ||
                  options.syncFailures;
                if (enabled && !(await enableNotifications()))
                  throw Error(
                    t(
                      "未获得系统通知权限",
                      "Notification permission was not granted",
                    ),
                  );
                await store.saveDevice({
                  ...store.getSnapshot().device,
                  notifications: device.notifications,
                  notificationOptions: options,
                });
                notify(t("通知设置已保存", "Notification settings saved"));
              },
            )
          }
        >
          {t("保存通知设置", "Save notification settings")}
        </button>
        <button
          disabled={!!busy}
          onClick={() =>
            void act(
              t("发送测试通知", "Sending a test notification"),
              testNotification,
            )
          }
        >
          {t("测试通知", "Test notification")}
        </button>
      </div>
    </>
  );
}
