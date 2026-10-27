/** Validate AI taxonomy proposals before showing a before/after confirmation dialog. */
import { z } from "zod";
import { store } from "../core/store";
const schema = z.object({
  categories: z.array(
    z.object({
      id: z.string().min(1).max(100),
      name: z.string().min(1),
      parent: z.string().min(1),
    }),
  ),
  assignments: z.array(z.object({ entryId: z.string(), category: z.string() })),
});
export type Classification = z.infer<typeof schema>;
/** Reject cycles, top-level additions, omissions and unknown entry references. */
export function validateClassification(input: unknown): Classification {
  const result = schema.parse(input),
    s = store.getSnapshot(),
    categories = new Map(s.categories.map((c) => [c.id, c]));
  for (const c of result.categories) {
    if (categories.has(c.id)) throw Error("新分类 ID 与已有分类冲突");
    categories.set(c.id, c);
  }
  for (const c of result.categories) {
    const seen = new Set([c.id]);
    let parent = c.parent;
    while (parent) {
      if (seen.has(parent)) throw Error("分类包含循环");
      seen.add(parent);
      const p = categories.get(parent);
      if (!p) throw Error("未知父分类");
      parent = p.parent;
    }
  }
  const assigned = new Set<string>();
  for (const a of result.assignments) {
    if (
      assigned.has(a.entryId) ||
      !s.entries.some((e) => e.id === a.entryId) ||
      !categories.has(a.category)
    )
      throw Error("分类分配不完整或包含未知ID");
    assigned.add(a.entryId);
  }
  if (assigned.size !== s.entries.length)
    throw Error("AI 遗漏部分词条，请重试");
  return result;
}
