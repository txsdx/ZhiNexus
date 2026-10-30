/** Offline review uses the same FSRS schedule and guards both material and policy before any atomic completion. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { store } from "../core/store";
import { rememberedCard } from "../core/review";
import {
  startSelfReview,
  revealSelfReview,
  finishSelfReview,
} from "./self-review";
let state: ReturnType<typeof store.getSnapshot>;
let fail = false,
  beforeCommit = () => {};
beforeEach(() => {
  state = {
    ...store.getSnapshot(),
    entries: [
      {
        id: "entry",
        title: "概念",
        content: "解释",
        category: "",
        tags: [],
        prerequisites: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        card: rememberedCard(),
        reviewCount: 0,
      },
    ],
    reviews: [],
    docs: [],
  };
  fail = false;
  beforeCommit = () => {};
  vi.spyOn(store, "getSnapshot").mockImplementation(() => state);
  const commit = async (
    patches: any[],
    _source: string,
    guard: () => boolean,
  ) => {
    beforeCommit();
    if (!guard()) return false;
    if (fail) throw Error("disk full");
    for (const item of patches) {
      if (item.collection === "entry")
        state.entries = state.entries.map((entry) =>
          entry.id === item.id ? { ...entry, ...item.patch } : entry,
        );
      else {
        const existing = state.reviews.find((review) => review.id === item.id);
        state.reviews = existing
          ? state.reviews.map((review) =>
              review.id === item.id ? { ...review, ...item.patch } : review,
            )
          : [...state.reviews, { id: item.id, ...item.patch }];
      }
    }
    return true;
  };
  vi.spyOn(store, "batchWhen").mockImplementation(commit);
  vi.spyOn(store, "patchWhen").mockImplementation(
    async (collection, id, patch, source, guard) =>
      commit([{ collection, id, patch }], source, guard),
  );
});
afterEach(() => vi.restoreAllMocks());
it("start and reveal never increment a card; an explicit rating completes exactly once without an AI grade", async () => {
  const original = JSON.stringify(state.entries[0]);
  const id = await startSelfReview("entry", "self");
  expect(await startSelfReview("entry", "duplicate")).toBe(id);
  expect(state.reviews).toHaveLength(1);
  expect(state.reviews[0].grade).toBeNull();
  await expect(finishSelfReview(id, 3)).rejects.toThrow("changed");
  expect(JSON.stringify(state.entries[0])).toBe(original);
  await revealSelfReview(id);
  expect(JSON.stringify(state.entries[0])).toBe(original);
  await finishSelfReview(id, 3);
  expect(state.entries[0].reviewCount).toBe(1);
  expect(state.entries[0].content).toBe("解释");
  expect(state.reviews[0]).toMatchObject({
    phase: "done",
    mode: "self",
    rating: 3,
    grade: null,
  });
  expect(state.reviews[0].completedAt).toBeTruthy();
  await expect(finishSelfReview(id, 3)).rejects.toThrow("changed");
  expect(state.entries[0].reviewCount).toBe(1);
});
it("material edits and later policy changes invalidate the attempted recall", async () => {
  const id = await startSelfReview("entry", "stale");
  state.entries[0].content = "并发新内容";
  await expect(revealSelfReview(id)).rejects.toThrow("changed");
  expect(state.entries[0].reviewCount).toBe(0);
  state.entries[0].content = "解释";
  await revealSelfReview(id);
  state.docs = [
    {
      id: "review-policy",
      collection: "setting",
      fields: { retention: 0.95 },
      conflicts: {},
      history: [],
    },
  ];
  await expect(finishSelfReview(id, 2)).rejects.toThrow("changed");
  expect(state.reviews[0].phase).toBe("graded");
});
it("a cancelled, queued stale, or failed save cannot partially update a session and entry", async () => {
  const id = await startSelfReview("entry", "failure");
  await revealSelfReview(id);
  const original = JSON.stringify(state.entries[0]);
  fail = true;
  await expect(finishSelfReview(id, 1)).rejects.toThrow("disk full");
  expect(JSON.stringify(state.entries[0])).toBe(original);
  expect(state.reviews[0].phase).toBe("graded");
  fail = false;
  beforeCommit = () => {
    state.reviews[0] = { ...state.reviews[0], phase: "cancelled" };
  };
  await expect(finishSelfReview(id, 1)).rejects.toThrow("changed");
  expect(JSON.stringify(state.entries[0])).toBe(original);
});

it("lowering importance pauses start, reveal and commit, while raising it restores the untouched session", async () => {
  const id = await startSelfReview("entry", "priority");
  const card = JSON.stringify(state.entries[0].card);
  state.entries[0].importance = { level: "low", mode: "manual" };
  await expect(startSelfReview("entry", "duplicate-low")).rejects.toThrow(
    "excluded",
  );
  await expect(revealSelfReview(id)).rejects.toThrow("changed");
  state.entries[0].importance = { level: "high", mode: "manual" };
  expect(await startSelfReview("entry")).toBe(id);
  await revealSelfReview(id);
  beforeCommit = () => {
    state.entries[0].importance = { level: "low", mode: "manual" };
  };
  await expect(finishSelfReview(id, 3)).rejects.toThrow("changed");
  expect(JSON.stringify(state.entries[0].card)).toBe(card);
  expect(state.entries[0].reviewCount).toBe(0);
  expect(state.reviews[0].phase).toBe("graded");
  beforeCommit = () => {};
  state.entries[0].importance = { level: "normal", mode: "manual" };
  await finishSelfReview(id, 3);
  expect(state.entries[0].reviewCount).toBe(1);
});
