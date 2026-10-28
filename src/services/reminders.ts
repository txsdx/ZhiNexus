import { nextReviewAt, reviewTarget } from "../core/review-policy";
/** Native Android notification schedules are handed to the operating system instead of relying on JS timers. */
import { native } from "../core/database";
import { store } from "../core/store";
import { reminderPlan } from "../core/reminders";
import { sha256 } from "../core/crypto";
let tail: Promise<unknown> = Promise.resolve();
let reconciledThisRuntime = false;
/** Reconcile only app-owned pending alarms after due dates or per-device preferences change. */
export function reconcileReminders(): Promise<void> {
  const run = async () => {
    if (!native || !/Android|iPhone|iPad/i.test(navigator.userAgent)) return;
    const {
      isPermissionGranted,
      pending,
      cancel,
      createChannel,
      Importance,
      sendNotification,
      Schedule,
    } = await import("@tauri-apps/plugin-notification");
    const existing = (await pending()).filter(
      (n) => n.id >= 0x5a100000 && n.id < 0x5a100040,
    );
    const s = store.getSnapshot();
    if (!s.device.notifications || !(await isPermissionGranted())) {
      if (existing.length) await cancel(existing.map((n) => n.id));
      await store.db.setLocal("review-alarm-signature", "");
      return;
    }
    const plan = reminderPlan(
        s.entries.map((e) => ({
          ...e,
          card: { ...e.card, due: nextReviewAt(e, reviewTarget(s.docs)) },
        })),
      ),
      signature = await sha256(
        plan.map((p) => ({
          id: p.id,
          at: p.at.toISOString(),
          titles: p.titles,
          count: p.count,
        })),
      );
    if (
      reconciledThisRuntime &&
      (await store.db.local("review-alarm-signature", "")) === signature &&
      plan.every((p) => existing.some((n) => n.id === p.id))
    )
      return;
    if (existing.length) await cancel(existing.map((n) => n.id));
    if (/Android/i.test(navigator.userAgent))
      await createChannel({
        id: "learning-reviews",
        name: "ZhiNexus reviews",
        importance: Importance.Default,
      });
    for (const alarm of plan)
      sendNotification({
        id: alarm.id,
        title: "知枢 · ZhiNexus",
        body: `${alarm.count} 个概念待复习 / concepts to revisit: ${alarm.titles.join(" · ")}`,
        channelId: /Android/i.test(navigator.userAgent)
          ? "learning-reviews"
          : undefined,
        schedule: Schedule.at(alarm.at, false, true),
        autoCancel: true,
        extra: { kind: "review" },
      });
    await store.db.setLocal("review-alarm-signature", signature);
    reconciledThisRuntime = true;
  };
  const task = tail.then(run, run);
  tail = task.catch(() => {});
  return task;
}
