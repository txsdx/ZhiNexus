/** FSRS scheduling and strict structured validation for resumable review assessments. */
import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";
import { z } from "zod";
export const questionSchema = z
  .object({
    question: z.string().min(1),
    type: z.enum(["short", "choice"]),
    choices: z.array(z.string()).max(8).default([]),
    answer: z.string().min(1),
    rubric: z.string().min(1),
  })
  .refine(
    (q) => q.type !== "choice" || q.choices.length >= 2,
    "选择题至少两个选项",
  );
export const gradeSchema = z.object({
  score: z.number().min(0).max(100),
  feedback: z.string().min(1),
  missing: z.string(),
  lesson: z.string(),
});
/** Restore Date fields after JSON/SQLite serialization. */
export function reviveCard(raw: Card): Card {
  return {
    ...raw,
    due: new Date(raw.due),
    last_review: raw.last_review ? new Date(raw.last_review) : undefined,
  };
}
/** Seed a card that is immediately available for its first review. */
export function newCard(): Card {
  return createEmptyCard(new Date());
}
/** Convert assessed understanding into an FSRS grade, then compute the next due date. */
export function schedule(raw: Card, score: number, now = new Date()): Card {
  const rating =
    score < 60
      ? Rating.Again
      : score < 75
        ? Rating.Hard
        : score < 90
          ? Rating.Good
          : Rating.Easy;
  return fsrs({ request_retention: 0.9 }).next(reviveCard(raw), now, rating)
    .card;
}
