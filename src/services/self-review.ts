/** Offline retrieval practice stores genuine self-ratings without manufacturing AI grades or changing explanation text. */
import { store, json, type StorePatch } from "../core/store";
import { sha256, canonical } from "../core/crypto";
import { reviewTarget } from "../core/review-policy";
import { scheduleRecall } from "../core/review";
import type { Entry } from "../core/types";
/** Hashable starting knowledge and policy protect a revealed answer from later remote/local edits. */
export function selfReviewSource(entry: Entry, retention: number) {
  return canonical({
    title: entry.title,
    content: entry.content,
    card: json(entry.card),
    reviewCount: entry.reviewCount ?? entry.card.reps,
    retention,
  });
}
/** Reuse an unfinished self session; a queued competing start cannot create duplicate active sessions. */
export async function startSelfReview(
  entryId: string,
  id: string = crypto.randomUUID(),
) {
  const state = store.getSnapshot(),
    existing = state.reviews.find(
      (review) =>
        review.entryId === entryId &&
        review.mode === "self" &&
        !["done", "cancelled"].includes(review.phase),
    );
  if (existing) return existing.id;
  const entry = state.entries.find((entry) => entry.id === entryId);
  if (!entry) throw Error("Entry missing");
  const retention = reviewTarget(state.docs),
    source = selfReviewSource(entry, retention),
    referenceHash = await sha256(source);
  const saved = await store.patchWhen(
    "review",
    id,
    {
      entryId,
      mode: "self",
      phase: "answer",
      referenceHash,
      question: {
        question: "回忆并解释这个概念 / Recall and explain this concept",
        type: "short",
        choices: [],
        answer: "揭示后对照解释 / Reveal and compare",
        rubric: "根据实际回忆选择档位 / Rate actual recall",
      },
      answer: "",
      grade: null,
      startedAt: new Date().toISOString(),
    },
    "self-review-start",
    () => {
      const current = store.getSnapshot(),
        currentEntry = current.entries.find((entry) => entry.id === entryId);
      return (
        !!currentEntry &&
        selfReviewSource(currentEntry, reviewTarget(current.docs)) === source &&
        !current.reviews.some(
          (review) =>
            review.entryId === entryId &&
            review.mode === "self" &&
            !["done", "cancelled"].includes(review.phase),
        )
      );
    },
  );
  if (!saved) {
    const existing = store
      .getSnapshot()
      .reviews.find(
        (review) =>
          review.entryId === entryId &&
          review.mode === "self" &&
          !["done", "cancelled"].includes(review.phase),
      );
    if (existing) return existing.id;
    throw Error("词条已改变，请重新开始 / Entry changed; start again");
  }
  return id;
}
/** Reveal is durable but never counts as a completed review; changed material requires restarting. */
export async function revealSelfReview(id: string) {
  await updateSelfReview(id);
}
/** Commit one explicit actual-recall rating together with the new card and completed session. */
export async function finishSelfReview(id: string, rating: 1 | 2 | 3 | 4) {
  if (![1, 2, 3, 4].includes(rating)) throw Error("Invalid recall rating");
  await updateSelfReview(id, rating);
}
async function updateSelfReview(id: string, rating?: 1 | 2 | 3 | 4) {
  const state = store.getSnapshot(),
    session = state.reviews.find((review) => review.id === id),
    entry = state.entries.find((entry) => entry.id === session?.entryId),
    retention = reviewTarget(state.docs);
  if (
    !session ||
    session.mode !== "self" ||
    !entry ||
    session.phase !== (rating ? "graded" : "answer")
  )
    throw Error("复习状态已改变 / Review changed");
  const source = selfReviewSource(entry, retention),
    sessionSource = canonical(session);
  if ((await sha256(source)) !== session.referenceHash)
    throw Error(
      "词条或复习设置已改变，请取消后重新开始 / Entry or review settings changed; cancel and start again",
    );
  const now = new Date();
  const patches: StorePatch[] = rating
    ? [
        {
          collection: "entry" as const,
          id: entry.id,
          patch: {
            card: json(scheduleRecall(entry.card, rating, now, retention)),
            reviewCount: (entry.reviewCount ?? entry.card.reps) + 1,
            updatedAt: now.toISOString(),
          },
        },
        {
          collection: "review" as const,
          id,
          patch: { phase: "done", rating, completedAt: now.toISOString() },
        },
      ]
    : [{ collection: "review" as const, id, patch: { phase: "graded" } }];
  if (
    !(await store.batchWhen(
      patches,
      rating ? "self-review-complete" : "self-review-reveal",
      () => {
        const current = store.getSnapshot(),
          currentEntry = current.entries.find((value) => value.id === entry.id),
          currentSession = current.reviews.find((value) => value.id === id);
        return (
          !!currentEntry &&
          !!currentSession &&
          selfReviewSource(currentEntry, reviewTarget(current.docs)) ===
            source &&
          canonical(currentSession) === sessionSource
        );
      },
    ))
  )
    throw Error(
      "词条或复习状态已改变，请重新检查 / Entry or review changed; inspect again",
    );
}
