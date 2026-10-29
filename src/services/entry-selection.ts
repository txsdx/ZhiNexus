/** Shared guarded bulk changes keep confirmed selections atomic and refuse stale knowledge. */
import { store } from "../core/store";
/** Capture the exact entry revisions displayed in a bulk selection. */
export function entrySelectionSnapshot(ids: string[]) {
  const entries = store.getSnapshot().entries;
  return JSON.stringify(
    [...new Set(ids)]
      .sort()
      .map((id) => entries.find((entry) => entry.id === id) ?? null),
  );
}
/** One transaction either changes every reviewed entry or preserves all entries on failure/staleness. */
export async function changeEntrySelection(
  ids: string[],
  before: string,
  change: { category: string } | { deleted: true },
) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const valid = () =>
    unique.every((id) =>
      store.getSnapshot().entries.some((entry) => entry.id === id),
    ) &&
    entrySelectionSnapshot(unique) === before &&
    (!("category" in change) ||
      !change.category ||
      store
        .getSnapshot()
        .categories.some((category) => category.id === change.category));
  const patches = unique.map((id) => ({
    collection: "entry" as const,
    id,
    patch: { ...change, updatedAt: new Date().toISOString() },
  }));
  if (!(await store.batchWhen(patches, "entry-bulk-change", valid)))
    throw Error(
      "选中条目或分类已改变，请重新选择 / Selected entries or category changed; select again",
    );
}
