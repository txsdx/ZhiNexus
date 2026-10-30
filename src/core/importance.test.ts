/** Importance is a review policy, not memory strength; scheduling, filtering and replication must agree. */
import { expect, it } from "vitest";
import {
  importanceLevel,
  importanceSchema,
  manualImportance,
  reviewEnabled,
} from "./importance";
import { reviewQueue, needsReview, nextReviewAt } from "./review-policy";
import { reminderPlan } from "./reminders";
import { reviewForecast } from "./review-forecast";
import { searchKnowledge, parseKnowledgeQuery } from "./knowledge-search";
import { rememberedCard } from "./review";
import { materialize } from "./crdt";
import { validateDocuments } from "./validation";
import { json } from "./store";
import type { Entry, Envelope } from "./types";
const now = new Date("2026-10-31T12:00:00Z");
function entry(
  id: string,
  level?: "high" | "normal" | "low",
  days = -3,
): Entry {
  const card = rememberedCard(new Date(now.getTime() + days * 86400000));
  if (days < 0) card.due = new Date(now.getTime() - 60000);
  return {
    id,
    title: id,
    content: "解释",
    category: "",
    tags: [],
    prerequisites: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    card,
    reviewCount: 2,
    ...(level ? { importance: manualImportance(level) } : {}),
  };
}
it("missing metadata is normal and low excludes old, new and learning cards without changing them", () => {
  const old = entry("old");
  expect(importanceLevel(old)).toBe("normal");
  expect(needsReview(old, 0.9, now)).toBe(true);
  const low = entry("low", "low", -500),
    original = JSON.stringify(low.card);
  for (const target of [0.5, 0.9, 0.99])
    expect(needsReview(low, target, now)).toBe(false);
  expect(reviewEnabled(low)).toBe(false);
  expect(JSON.stringify(low.card)).toBe(original);
  low.importance = manualImportance("normal");
  expect(needsReview(low, 0.9, now)).toBe(true);
  expect(JSON.stringify(low.card)).toBe(original);
});
it("priority only orders due work and leaves future important material out of the queue", () => {
  const values = [
    entry("normal"),
    entry("low", "low"),
    entry("high", "high"),
    entry("future", "high", 0),
  ];
  expect(reviewQueue(values, 0.9, now).map((value) => value.id)).toEqual([
    "high",
    "normal",
  ]);
  expect(nextReviewAt(values[3]).getTime()).toBeGreaterThan(now.getTime());
  expect(
    reminderPlan(values, now).flatMap((alarm) => alarm.titles),
  ).not.toContain("low");
});
it("importance filters combine with due, phrases, Unicode aliases and exclusions", () => {
  const values = [entry("normal"), entry("low", "low"), entry("high", "high")];
  expect(
    searchKnowledge(values, [], "importance:低 is:due", 0.9, now),
  ).toHaveLength(0);
  expect(
    searchKnowledge(values, [], "importance:高 -title:missing", 0.9, now).map(
      (value) => value.id,
    ),
  ).toEqual(["high"]);
  expect(
    searchKnowledge(values, [], "-importance:low is:due", 0.9, now)
      .map((value) => value.id)
      .sort(),
  ).toEqual(["high", "normal"]);
  expect(
    searchKnowledge(values, [], "importance:normal", 0.9, now).map(
      (value) => value.id,
    ),
  ).toEqual(["normal"]);
  expect(parseKnowledgeQuery("importance:unknown")[0].field).toBe("text");
});
it("forecast counts one current next-due per eligible entry and never simulates later repetitions", () => {
  const values = [
    entry("normal"),
    entry("high", "high"),
    entry("low", "low"),
    entry("future", "normal", 0),
    entry("far", "normal", 40),
  ];
  const days = reviewForecast(values, 0.9, now);
  expect(days).toHaveLength(7);
  expect(days[0].high.map((value) => value.id)).toEqual(["high"]);
  expect(days[0].normal.map((value) => value.id)).toEqual(["normal"]);
  expect(
    days
      .flatMap((day) => [...day.high, ...day.normal])
      .map((value) => value.id)
      .sort(),
  ).toEqual(["future", "high", "normal"]);
  expect(
    new Set(
      days
        .flatMap((day) => [...day.high, ...day.normal])
        .map((value) => value.id),
    ).size,
  ).toBe(3);
});
it("replicated concurrent choices stay whole with matching modes, preserve alternatives and validate every candidate", () => {
  const base = {
    ...entry("item"),
    importance: { level: "normal", mode: "auto" },
  };
  const event = (
    device: string,
    seq: number,
    vector: Record<string, number>,
    patch: unknown,
    hash: string,
  ) =>
    ({
      hash,
      op: {
        schema: 1,
        device,
        seq,
        vector,
        collection: "entry",
        entity: "item",
        patch: json(patch),
        at: now.toISOString(),
        source: "test",
      },
    }) as Envelope;
  const events = [
    event("a", 1, { a: 1 }, base, "0"),
    event("a", 2, { a: 2 }, { importance: manualImportance("low") }, "a"),
    event(
      "b",
      1,
      { a: 1, b: 1 },
      { importance: { level: "high", mode: "auto", reason: "基础概念" } },
      "b",
    ),
  ];
  const docs = materialize(events);
  validateDocuments(docs);
  expect(
    docs[0].conflicts.importance.map((candidate) => candidate.value),
  ).toEqual(
    expect.arrayContaining([
      manualImportance("low"),
      { level: "high", mode: "auto", reason: "基础概念" },
    ]),
  );
  expect(materialize([...events].reverse())[0].fields.importance).toEqual(
    docs[0].fields.importance,
  );
  expect(docs[0].fields.card).toEqual(json(base.card));
  expect(
    importanceSchema.safeParse({ level: "urgent", mode: "manual" }).success,
  ).toBe(false);
  expect(
    importanceSchema.safeParse({
      level: "low",
      mode: "auto",
      reason: "x".repeat(601),
    }).success,
  ).toBe(false);
});

it("forecast buckets follow local calendar midnights through a DST boundary", () => {
  const priorTimezone = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const localNow = new Date(2026, 2, 7, 12, 0),
      values = [entry("dst", "high")];
    values[0].card = {
      ...values[0].card,
      last_review: undefined,
      reps: 0,
      due: new Date(2026, 2, 8, 23, 50),
    };
    const days = reviewForecast(values, 0.9, localNow);
    expect(days[1].high.map((value) => value.id)).toEqual(["dst"]);
    expect(days[2].date.getTime() - days[1].date.getTime()).toBe(23 * 3600000);
  } finally {
    if (priorTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = priorTimezone;
  }
});
