/** One desired-retention policy for forecasting, due queues, notifications and new FSRS schedules. */
import { fsrs } from "ts-fsrs";
import type { Doc, Entry } from "./types";
import { memoryEstimate } from "./knowledge-view";
import { reviewEnabled, importanceRank } from "./importance";
const schedulers = new Map<number, ReturnType<typeof fsrs>>();
/** Default to the documented FSRS/Anki 90% target; invalid remote values never reach the scheduler. */
export function reviewTarget(docs: Doc[] = []): number {
  const value = docs.find(
    (d) => d.collection === "setting" && d.id === "review-policy",
  )?.fields.retention;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.5 &&
    value <= 0.99
    ? value
    : 0.9;
}
/** Preserve already scheduled/learning deadlines while also bringing below-target learned material forward. */
export function nextReviewAt(entry: Entry, target = 0.9): Date {
  const card = entry.card;
  if (!card.last_review || card.stability <= 0 || card.reps <= 0)
    return card.due;
  let scheduler = schedulers.get(target);
  if (!scheduler) {
    scheduler = fsrs({ request_retention: target, enable_fuzz: false });
    schedulers.set(target, scheduler);
  }
  const estimated =
    card.last_review.getTime() +
    card.stability * scheduler.interval_modifier * 86400000;
  return new Date(Math.min(card.due.getTime(), estimated));
}
/** Below-target estimates and existing due work share one eligibility rule, including short learning steps. */
export function needsReview(
  entry: Entry,
  target = 0.9,
  now = new Date(),
): boolean {
  return (
    reviewEnabled(entry) &&
    (nextReviewAt(entry, target) <= now ||
      (memoryEstimate(entry, now) ?? 1) < target)
  );
}
/** Order due work by importance, then the existing deadline; never promote future work into the queue. */
export function reviewQueue(
  entries: Entry[],
  target = 0.9,
  now = new Date(),
): Entry[] {
  return entries
    .filter((entry) => needsReview(entry, target, now))
    .sort(
      (a, b) =>
        importanceRank(a) - importanceRank(b) ||
        nextReviewAt(a, target).getTime() - nextReviewAt(b, target).getTime() ||
        a.id.localeCompare(b.id),
    );
}
