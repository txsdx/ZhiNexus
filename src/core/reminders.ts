/** Deterministic mobile OS alarm planning with bounded, deduplicated due-time groups. */
import type { Entry } from "./types";
/** One OS-owned alarm groups concepts due in the same minute and survives a closed webview. */
export interface ReminderAlarm {
  id: number;
  at: Date;
  titles: string[];
  count: number;
}
/** Plan at most 48 alarms; already overdue concepts receive a next-morning reminder after the immediate in-app notice. */
export function reminderPlan(
  entries: Pick<Entry, "title" | "card">[],
  now = new Date(),
): ReminderAlarm[] {
  const groups = new Map<number, string[]>(),
    tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  for (const e of entries) {
    const due = new Date(e.card.due).getTime();
    if (!Number.isFinite(due)) continue;
    const at =
      Math.ceil(
        (due <= now.getTime()
          ? tomorrow.getTime()
          : Math.max(now.getTime() + 60000, due)) / 60000,
      ) * 60000;
    const titles = groups.get(at) ?? [];
    titles.push(e.title);
    groups.set(at, titles);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .slice(0, 48)
    .map(([at, titles], i) => ({
      id: 0x5a100000 + i,
      at: new Date(at),
      titles: titles.slice(0, 3),
      count: titles.length,
    }));
}
