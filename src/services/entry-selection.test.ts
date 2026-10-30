/** Bulk operations reject stale selections and commit exactly one atomic batch. */
import { afterEach, expect, it, vi } from "vitest";
import { store } from "../core/store";
import {
  entrySelectionSnapshot,
  changeEntrySelection,
} from "./entry-selection";
afterEach(() => vi.restoreAllMocks());
it("deduplicates a selection and submits one guarded transaction", async () => {
  const state = {
    ...store.getSnapshot(),
    entries: [
      { id: "a", title: "a" },
      { id: "b", title: "b" },
    ] as any,
    categories: [],
  };
  vi.spyOn(store, "getSnapshot").mockReturnValue(state);
  const commit = vi
    .spyOn(store, "batchWhen")
    .mockImplementation(async (_p, _r, guard) => guard());
  await changeEntrySelection(
    ["a", "a", "b"],
    entrySelectionSnapshot(["a", "b"]),
    { deleted: true },
  );
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0][0]).toHaveLength(2);
  expect(state.entries).toEqual([
    { id: "a", title: "a" },
    { id: "b", title: "b" },
  ]);
});
it("rejects changed entries, disappeared categories and persistence failure without partial changes", async () => {
  const state = {
    ...store.getSnapshot(),
    entries: [{ id: "a", title: "a" }] as any,
    categories: [{ id: "cat", name: "cat", parent: "" }],
  };
  vi.spyOn(store, "getSnapshot").mockReturnValue(state);
  const before = entrySelectionSnapshot(["a"]),
    commit = vi
      .spyOn(store, "batchWhen")
      .mockImplementation(async (_p, _r, guard) => guard());
  state.entries[0].title = "edited";
  await expect(
    changeEntrySelection(["a"], before, { deleted: true }),
  ).rejects.toThrow("changed");
  const fresh = entrySelectionSnapshot(["a"]);
  state.categories = [];
  await expect(
    changeEntrySelection(["a"], fresh, { category: "cat" }),
  ).rejects.toThrow("changed");
  commit.mockRejectedValue(Error("disk full"));
  await expect(
    changeEntrySelection(["a"], fresh, { deleted: true }),
  ).rejects.toThrow("disk full");
  expect(state.entries[0].title).toBe("edited");
});

it("bulk priority changes preserve cards and submit one whole manual register for each reviewed entry", async () => {
  const state = {
    ...store.getSnapshot(),
    entries: [
      { id: "a", title: "a", card: { reps: 4 } },
      { id: "b", title: "b", card: { reps: 3 } },
    ] as any,
    categories: [],
  };
  vi.spyOn(store, "getSnapshot").mockReturnValue(state);
  const commit = vi
    .spyOn(store, "batchWhen")
    .mockImplementation(async (_patches, _source, guard) => guard());
  await changeEntrySelection(["a", "b"], entrySelectionSnapshot(["a", "b"]), {
    importance: { level: "low", mode: "manual" },
  });
  expect(commit.mock.calls[0][0]).toHaveLength(2);
  for (const patch of commit.mock.calls[0][0]) {
    expect(patch.patch.importance).toEqual({ level: "low", mode: "manual" });
    expect(patch.patch).not.toHaveProperty("card");
  }
  expect(state.entries[0].card.reps).toBe(4);
});
