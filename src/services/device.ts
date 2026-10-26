/** Per-device review reminders and signed native update integration. */
import { native } from "../core/database";
import { store } from "../core/store";
import { request, responseJson } from "./network";
/** Request notification permission only after the user explicitly enables reminders. */
export async function enableNotifications(): Promise<boolean> {
  if (native) {
    const n = await import("@tauri-apps/plugin-notification");
    return (
      (await n.isPermissionGranted()) ||
      (await n.requestPermission()) === "granted"
    );
  }
  return (
    "Notification" in window &&
    (await Notification.requestPermission()) === "granted"
  );
}
/** Notify once per due-day per running device; closed-process scheduling is a separate native milestone. */
export async function remind() {
  const s = store.getSnapshot();
  if (!s.device.notifications) return;
  const count = s.entries.filter((e) => e.card.due <= new Date()).length;
  if (!count) return;
  const day = new Date().toLocaleDateString();
  if ((await store.db.local("notifiedDay", "")) === day) return;
  const text = `知枢 · ${count} 个概念等待复习 / ${count} concepts ready to review`;
  if (native) {
    const { sendNotification } =
      await import("@tauri-apps/plugin-notification");
    sendNotification({ title: "ZhiNexus", body: text });
  } else if ("Notification" in window && Notification.permission === "granted")
    new Notification("ZhiNexus", { body: text });
  else return;
  await store.db.setLocal("notifiedDay", day);
}
/** Read public GitHub release metadata; this never downloads or executes an unsigned binary. */
export async function latestRelease() {
  const data = await responseJson(
    await request(
      "https://api.github.com/repos/txsdx/ZhiNexus/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    ),
  );
  const d = data as { tag_name?: string; html_url?: string };
  if (
    !d.tag_name ||
    !d.html_url?.startsWith("https://github.com/txsdx/ZhiNexus/releases/")
  )
    throw Error("无有效 Release");
  return { version: d.tag_name, url: d.html_url };
}
/** Install only artifacts verified by the configured Tauri updater public key. */
export async function installUpdate() {
  if (!native) throw Error("一键更新仅在桌面原生版本中可用");
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return false;
  await update.downloadAndInstall();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return true;
}
