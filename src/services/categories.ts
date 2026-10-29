/** Safe taxonomy editing and removal with atomic entry reassignment and cycle prevention. */
import type { Category } from "../core/types";
import { canonical } from "../core/crypto";
import { store, type StorePatch } from "../core/store";
/** Resolve the complete root-to-leaf category path without looping on malformed remote hierarchies. */
export function categoryPath(categories: Category[], id: string): string[] {
  const names: string[] = [],
    seen = new Set<string>();
  let node = categories.find((c) => c.id === id);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    names.unshift(node.name);
    node = categories.find((c) => c.id === node!.parent);
  }
  return names;
}
/** Move one existing entry only while its category and destination remain valid at commit time. */
export async function moveEntry(id: string, category: string) {
  const before = store.getSnapshot().entries.find((e) => e.id === id);
  if (!before) throw Error("词条不存在 / Entry missing");
  if (
    !(await store.batchWhen(
      [
        {
          collection: "entry",
          id,
          patch: { category, updatedAt: new Date().toISOString() },
        },
      ],
      "entry-move",
      () => {
        const state = store.getSnapshot();
        return (
          state.entries.some(
            (e) => e.id === id && e.category === before.category,
          ) &&
          (!category || state.categories.some((c) => c.id === category))
        );
      },
    ))
  )
    throw Error(
      "词条分类或目标已改变，请重试 / Category or destination changed; retry",
    );
}
/** Verify that moving a category cannot introduce a cycle or reference a missing parent. */
export function validateCategoryMove(
  categories: Category[],
  id: string,
  parent: string,
): void {
  const seen = new Set([id]);
  let current = parent;
  while (current) {
    if (seen.has(current))
      throw Error("不能把分类移动到自身或子类 / Category cycle");
    seen.add(current);
    const c = categories.find((c) => c.id === current);
    if (!c) throw Error("父分类不存在 / Parent missing");
    current = c.parent;
  }
}
/** Rename or move an existing category without changing its identity or entry references. */
export async function editCategory(
  id: string,
  name: string,
  parent: string,
  expected = taxonomySignature(),
) {
  const s = store.getSnapshot();
  if (!s.categories.some((c) => c.id === id) || !name.trim())
    throw Error("分类或名称无效 / Invalid category");
  validateCategoryMove(s.categories, id, parent);
  const signature = expected;
  if (signature !== taxonomySignature())
    throw Error("分类已改变，请重试 / Category changed; retry");
  if (
    !(await store.batchWhen(
      [{ collection: "category", id, patch: { name: name.trim(), parent } }],
      "category-edit",
      () => signature === taxonomySignature(),
    ))
  )
    throw Error("分类已改变，请重试 / Category changed; retry");
}
/** Explicit category deletion choices; preservation is always the keyboard default. */
export type CategoryRemoval = "keep" | "all";
/** Detect edits made while a deletion preview is open, including newly moved or created descendants. */
export function taxonomySignature() {
  const s = store.getSnapshot();
  return canonical({ categories: s.categories, entries: s.entries });
}
/** Prepare one atomic deletion plan; keeping content promotes direct children and entries to the parent. */
export function categoryRemovalPlan(
  id: string,
  mode: CategoryRemoval = "keep",
): StorePatch[] {
  const s = store.getSnapshot(),
    category = s.categories.find((c) => c.id === id);
  if (!category) throw Error("分类不存在 / Category missing");
  const descendants = new Set([id]);
  if (mode === "all") {
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of s.categories)
        if (descendants.has(c.parent) && !descendants.has(c.id)) {
          descendants.add(c.id);
          changed = true;
        }
    }
  }
  const patches: StorePatch[] = [...descendants].map((id) => ({
    collection: "category",
    id,
    patch: { deleted: true },
  }));
  for (const e of s.entries.filter((e) => descendants.has(e.category)))
    patches.push({
      collection: "entry",
      id: e.id,
      patch:
        mode === "all"
          ? { deleted: true, updatedAt: new Date().toISOString() }
          : { category: category.parent, updatedAt: new Date().toISOString() },
    });
  if (mode === "keep")
    for (const c of s.categories.filter((c) => c.parent === id))
      patches.push({
        collection: "category",
        id: c.id,
        patch: { parent: category.parent },
      });
  return patches;
}
/** Delete the reviewed subtree atomically, rejecting a changed preview before any mutation. */
export async function removeCategory(
  id: string,
  mode: CategoryRemoval = "keep",
  expected = taxonomySignature(),
) {
  if (expected !== taxonomySignature())
    throw Error(
      "确认期间分类或词条已改变，请重新操作 / Taxonomy changed while confirming",
    );
  const patches = categoryRemovalPlan(id, mode);
  if (
    !(await store.batchWhen(
      patches,
      "category-remove",
      () => expected === taxonomySignature(),
    ))
  )
    throw Error(
      "确认期间分类或词条已改变，请重新操作 / Taxonomy changed while confirming",
    );
}
/** Count entries under a category including all descendant categories, tolerating malformed remote cycles. */
export function categoryCount(
  categories: Category[],
  assignments: { category: string }[],
  id: string,
): number {
  const descendants = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categories)
      if (descendants.has(c.parent) && !descendants.has(c.id)) {
        descendants.add(c.id);
        changed = true;
      }
  }
  return assignments.filter((a) => descendants.has(a.category)).length;
}
