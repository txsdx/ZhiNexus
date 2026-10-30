/** A bounded workload preview counts currently scheduled concepts, never hypothetical future completions. */
import type { Entry } from "./types";
import { importanceLevel, reviewEnabled } from "./importance";
import { needsReview, nextReviewAt } from "./review-policy";
/** One local-calendar bucket; each eligible concept occurs at most once in the forecast. */
export interface ReviewForecastDay {
  date: Date;
  high: Entry[];
  normal: Entry[];
}
/** Overdue work belongs to today, while future buckets follow local midnight across DST changes. */
export function reviewForecast(
  entries: Entry[],
  retention = 0.9,
  now = new Date(),
  days = 7,
): ReviewForecastDay[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const result = Array.from(
    { length: Math.max(1, Math.min(31, Math.floor(days) || 7)) },
    (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return { date, high: [] as Entry[], normal: [] as Entry[] };
    },
  );
  const end = new Date(result.at(-1)!.date);
  end.setDate(end.getDate() + 1);
  for (const entry of entries) {
    if (!reviewEnabled(entry)) continue;
    const at = needsReview(entry, retention, now)
      ? now
      : nextReviewAt(entry, retention);
    if (at >= end || !Number.isFinite(at.getTime())) continue;
    const bucket = [...result].reverse().find((value) => value.date <= at);
    if (bucket)
      bucket[importanceLevel(entry) === "high" ? "high" : "normal"].push(entry);
  }
  return result;
}
