/** Taxonomy deletion is one guarded plan, with preservation and subtree modes and no partial commits. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { store } from "../core/store";
import { newCard } from "../core/review";
import {
  categoryRemovalPlan,
  removeCategory,
  taxonomySignature,
  editCategory,
  moveEntry,
} from "./categories";
import type { Entry } from "../core/types";
let state: ReturnType<typeof store.getSnapshot>;
const entry = (id: string, category: string): Entry => ({
  id,
  title: id,
  category,
  content: "original",
  tags: [],
  prerequisites: [],
  card: newCard(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
it("entry category changes reject a removed destination or a concurrent move inside the commit queue", async () => {
  const commit = vi
    .spyOn(store, "batchWhen")
    .mockImplementation(async (_patches, _source, guard) => {
      state = {
        ...state,
        categories: state.categories.filter((c) => c.id !== "other"),
      };
      return guard();
    });
  await expect(moveEntry("a", "other")).rejects.toThrow("changed");
  expect(state.entries[0].category).toBe("root");
  commit.mockImplementation(async (_patches, _source, guard) => {
    state = {
      ...state,
      entries: state.entries.map((e) =>
        e.id === "a" ? { ...e, category: "grand" } : e,
      ),
    };
    return guard();
  });
  await expect(moveEntry("a", "child")).rejects.toThrow("changed");
  expect(state.entries[0].category).toBe("grand");
});
beforeEach(() => {
  state = {
    ...store.getSnapshot(),
    categories: [
      { id: "root", name: "大类", parent: "" },
      { id: "child", name: "子类", parent: "root" },
      { id: "grand", name: "孙类", parent: "child" },
      { id: "other", name: "别类", parent: "" },
    ],
    entries: [
      entry("a", "root"),
      entry("b", "child"),
      entry("c", "grand"),
      entry("d", "other"),
    ],
  };
  vi.spyOn(store, "getSnapshot").mockImplementation(() => state);
});
afterEach(() => vi.restoreAllMocks());
it("preserve mode promotes only direct children and entries, retaining the lower subtree", () => {
  expect(categoryRemovalPlan("child", "keep")).toEqual(
    expect.arrayContaining([
      { collection: "category", id: "child", patch: { deleted: true } },
      { collection: "category", id: "grand", patch: { parent: "root" } },
      expect.objectContaining({
        collection: "entry",
        id: "b",
        patch: expect.objectContaining({ category: "root" }),
      }),
    ]),
  );
  expect(categoryRemovalPlan("child", "keep").some((p) => p.id === "c")).toBe(
    false,
  );
});
it("delete-all mode includes exactly the descendant categories and their entries", () => {
  const plan = categoryRemovalPlan("child", "all");
  expect(new Set(plan.map((p) => p.id))).toEqual(
    new Set(["child", "grand", "b", "c"]),
  );
  expect(plan.every((p) => p.patch.deleted === true)).toBe(true);
});
it("a changed confirmation snapshot is rejected before the transaction", async () => {
  const expected = taxonomySignature(),
    commit = vi.spyOn(store, "batchWhen").mockResolvedValue(true);
  state = {
    ...state,
    categories: [
      ...state.categories,
      { id: "new", name: "新", parent: "child" },
    ],
  };
  await expect(removeCategory("child", "all", expected)).rejects.toThrow(
    "changed",
  );
  expect(commit).not.toHaveBeenCalled();
});
it("a storage failure leaves the complete projection unchanged and cycle moves never commit", async () => {
  const before = JSON.stringify(state),
    commit = vi.spyOn(store, "batchWhen").mockRejectedValue(Error("disk full"));
  await expect(removeCategory("child", "all")).rejects.toThrow("disk full");
  expect(JSON.stringify(state)).toBe(before);
  commit.mockClear();
  await expect(editCategory("root", "大类", "grand")).rejects.toThrow("cycle");
  expect(commit).not.toHaveBeenCalled();
});
