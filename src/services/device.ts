import { needsReview, reviewTarget } from "../core/review-policy";
/** Per-device notification authorization and reminders for the running application. */
import { native } from "../core/database";
import { store } from "../core/store";
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
  const count = s.entries.filter((e) =>
    needsReview(e, reviewTarget(s.docs)),
  ).length;
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
