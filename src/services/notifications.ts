/** Per-device notification policies, with focus-aware AI completion and bounded message previews. */
import { native } from "../core/database";
import { store } from "../core/store";
export const defaultNotifications = {
  aiWhenUnfocused: true,
  ocrWhenUnfocused: true,
  syncFailures: false,
  preview: false,
  cooldownSeconds: 15,
};
const last = new Map<string, number>();
/** Resolve actual main-window focus instead of treating a hidden or minimized page as active. */
export async function isMainFocused() {
  if (native) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow()
      .isFocused()
      .catch(() => false);
  }
  return document.visibilityState === "visible" && document.hasFocus();
}
/** Send only authorized notifications; notification delivery must never fail a completed AI operation. */
export async function notifyCompletion(
  kind: "ai" | "ocr" | "sync",
  content = "",
) {
  const settings = {
    ...defaultNotifications,
    ...store.getSnapshot().device.notificationOptions,
  };
  if (
    (kind === "ai" && !settings.aiWhenUnfocused) ||
    (kind === "ocr" && !settings.ocrWhenUnfocused) ||
    (kind === "sync" && !settings.syncFailures)
  )
    return;
  if (kind !== "sync" && (await isMainFocused())) return;
  if (Date.now() - (last.get(kind) ?? 0) < settings.cooldownSeconds * 1000)
    return;
  const body =
    settings.preview && content
      ? content.slice(0, 180)
      : kind === "ai"
        ? "AI 响应已完成 / AI response ready"
        : kind === "ocr"
          ? "截图文字识别已完成 / Screenshot text ready"
          : "同步未完成，请检查网络设置 / Synchronization needs attention";
  if (native) {
    const { isPermissionGranted, sendNotification } =
      await import("@tauri-apps/plugin-notification");
    if (!(await isPermissionGranted())) return;
    sendNotification({ title: "知枢 · ZhiNexus", body });
  } else if ("Notification" in window && Notification.permission === "granted")
    new Notification("ZhiNexus", { body });
  else return;
  last.set(kind, Date.now());
}
/** Exercise notification authorization and display through the same native API used by automatic reminders. */
export async function testNotification() {
  const { enableNotifications } = await import("./device");
  if (!(await enableNotifications()))
    throw Error("未获得通知权限 / Notification permission was not granted");
  if (native) {
    const { sendNotification } =
      await import("@tauri-apps/plugin-notification");
    sendNotification({
      title: "知枢 · ZhiNexus",
      body: "通知设置已就绪 / Notifications are ready",
    });
  } else
    new Notification("ZhiNexus", {
      body: "通知设置已就绪 / Notifications are ready",
    });
}
