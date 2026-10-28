/** Memory visualization uses recorded states and the same FSRS model as scheduling and queue eligibility. */
import { expect, it } from "vitest";
import { curveHistory, curveRecall, curvePalette } from "./forgetting-curves";
import { reviewTarget, nextReviewAt, needsReview } from "./review-policy";
import { rememberedCard, schedule } from "./review";
import { memoryEstimate } from "./knowledge-view";
import type { Doc, Entry } from "./types";
const start = new Date("2026-01-01T00:00:00Z"),
  day = 86400000;
const entry = (): Entry => ({
  id: "entry",
  title: "科学复习",
  content: "定义",
  category: "",
  tags: [],
  prerequisites: [],
  createdAt: start.toISOString(),
  updatedAt: start.toISOString(),
  card: rememberedCard(start),
  reviewCount: 0,
});
it("initial learning predicts recall but does not invent a curve before a recorded learning event", () => {
  const e = entry(),
    cards = curveHistory(e, []);
  expect(curveRecall(cards, start.getTime() - 1)).toBeNull();
  expect(curveRecall(cards, start.getTime())).toBe(1);
  expect(curveRecall(cards, start.getTime() + day)!).toBeLessThan(1);
  expect(needsReview(e, 0.9, start)).toBe(false);
});
it("an actual review changes later predictions while keeping the earlier forgetting segment", () => {
  const e = entry(),
    old = e.card,
    reviewedAt = new Date(start.getTime() + 7 * day);
  e.card = schedule(old, 85, reviewedAt, 0.9, 3);
  const docs = [
    {
      id: e.id,
      collection: "entry",
      fields: {},
      conflicts: {},
      history: [
        {
          hash: "fixture",
          op: {
            schema: 1,
            device: "fixture",
            seq: 1,
            vector: { fixture: 1 },
            collection: "entry",
            entity: e.id,
            patch: { card: JSON.parse(JSON.stringify(old)) },
            at: start.toISOString(),
            source: "test",
          },
        },
      ],
    },
  ] as Doc[];
  const cards = curveHistory(e, docs);
  expect(curveRecall(cards, start.getTime() + day)).toBeCloseTo(
    memoryEstimate({ ...e, card: old }, new Date(start.getTime() + day))!,
  );
  expect(curveRecall(cards, reviewedAt.getTime() - 1)!).toBeLessThan(0.9);
  expect(curveRecall(cards, reviewedAt.getTime())).toBe(1);
});
it("higher desired retention brings reviews forward without discarding already due work", () => {
  const e = entry();
  expect(nextReviewAt(e, 0.97).getTime()).toBeLessThan(
    nextReviewAt(e, 0.8).getTime(),
  );
  const when = new Date(nextReviewAt(e, 0.97).getTime() + 1);
  expect(needsReview(e, 0.97, when)).toBe(true);
  expect(needsReview(e, 0.8, when)).toBe(false);
  e.card.due = start;
  expect(needsReview(e, 0.5, new Date(start.getTime() + 1))).toBe(true);
});
it("invalid or missing synced policy uses a conservative documented default", () => {
  expect(reviewTarget()).toBe(0.9);
  expect(
    reviewTarget([
      {
        collection: "setting",
        id: "review-policy",
        fields: { retention: 1.5 },
        history: [],
        conflicts: {},
      },
    ]),
  ).toBe(0.9);
  expect(
    reviewTarget([
      {
        collection: "setting",
        id: "review-policy",
        fields: { retention: 0.95 },
        history: [],
        conflicts: {},
      },
    ]),
  ).toBe(0.95);
});
it("self-rated Again schedules relearning independently of a high AI score", () => {
  const card = rememberedCard(start),
    now = new Date(start.getTime() + 7 * day);
  const forgot = schedule(card, 100, now, 0.9, 1),
    easy = schedule(card, 100, now, 0.9, 4);
  expect(forgot.due.getTime()).toBeLessThan(easy.due.getTime());
  expect(forgot.reps).toBe(card.reps + 1);
  expect(easy.reps).toBe(card.reps + 1);
});
it("a discarded newer state cannot override the currently retained model's future curve", () => {
  const e = entry(),
    newer = rememberedCard(new Date(start.getTime() + day));
  const docs = [
    {
      id: e.id,
      collection: "entry",
      history: [{ op: { patch: { card: newer } } }],
    },
  ] as unknown as Doc[];
  expect(curveHistory(e, docs)).toEqual([e.card]);
});
it("visible curves receive unique, order-independent colors even when entry hashes collide", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `entry-${i}`),
    palette = curvePalette(ids);
  expect(new Set(palette.values()).size).toBe(100);
  expect(curvePalette([...ids].reverse())).toEqual(palette);
});
