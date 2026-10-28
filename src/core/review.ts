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
/** Treat captured knowledge as already learned, scheduling its first real review in the future. */
export function rememberedCard(now = new Date(), retention = 0.9): Card {
  return fsrs({ request_retention: retention, enable_short_term: false }).next(
    createEmptyCard(now),
    now,
    Rating.Good,
  ).card;
}
/** Convert assessed understanding into an FSRS grade, then compute the next due date. */
export function suggestedRating(score: number): 1 | 2 | 3 | 4 {
  return score < 60 ? 1 : score < 75 ? 2 : score < 90 ? 3 : 4;
}
/** Record the learner's actual recall rating; AI scores supply only a default suggestion. */
export function schedule(
  raw: Card,
  score: number,
  now = new Date(),
  retention = 0.9,
  selectedRating?: 1 | 2 | 3 | 4,
): Card {
  const rating = selectedRating ?? suggestedRating(score);
  return fsrs({ request_retention: retention }).next(
    reviveCard(raw),
    now,
    rating,
  ).card;
}
