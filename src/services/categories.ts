/** Safe taxonomy editing and removal with atomic entry reassignment and cycle prevention. */
import type { Category, Collection, Json } from "../core/types";
import { store } from "../core/store";
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
export async function editCategory(id: string, name: string, parent: string) {
  const s = store.getSnapshot();
  if (!s.categories.some((c) => c.id === id) || !name.trim())
    throw Error("分类或名称无效 / Invalid category");
  validateCategoryMove(s.categories, id, parent);
  await store.patch(
    "category",
    id,
    { name: name.trim(), parent },
    "category-edit",
  );
}
/** Remove only the category itself, moving direct children and entries to its parent in one commit. */
export async function removeCategory(id: string) {
  const s = store.getSnapshot(),
    category = s.categories.find((c) => c.id === id);
  if (!category) throw Error("分类不存在 / Category missing");
  const patches: {
    collection: Collection;
    id: string;
    patch: Record<string, Json>;
  }[] = [{ collection: "category", id, patch: { deleted: true } }];
  for (const e of s.entries.filter((e) => e.category === id))
    patches.push({
      collection: "entry",
      id: e.id,
      patch: { category: category.parent, updatedAt: new Date().toISOString() },
    });
  for (const c of s.categories.filter((c) => c.parent === id))
    patches.push({
      collection: "category",
      id: c.id,
      patch: { parent: category.parent },
    });
  await store.batch(patches, "category-remove");
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
