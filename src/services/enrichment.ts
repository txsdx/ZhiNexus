/** Capture enrichment pipeline: preserve raw material, avoid stale overwrites and link only known concepts. */
import { z } from "zod";
import { entryTemplate } from "../core/defaults";
import { store, json } from "../core/store";
import { runTask, parseJson } from "./ai";
/** Enrich only configured tasks and report partial success without rolling back the captured note. */
export async function enrichEntry(id: string): Promise<void> {
  let s = store.getSnapshot(),
    entry = s.entries.find((e) => e.id === id);
  if (!entry || !s.device.apiKey) return;
  const original = entry.content;
  if (s.ai.tasks.explain.model) {
    const explanation = await runTask("explain", {
      title: entry.title,
      content: original,
    });
    const current = store.getSnapshot().entries.find((e) => e.id === id);
    if (current && current.content === original)
      await store.patch(
        "entry",
        id,
        {
          content:
            explanation +
            (original.trim() && original !== entryTemplate
              ? "\n\n## 原始材料 / Captured source\n\n" + original
              : ""),
          updatedAt: new Date().toISOString(),
        },
        "auto-explanation",
      );
  }
  s = store.getSnapshot();
  entry = s.entries.find((e) => e.id === id);
  if (!entry) return;
  if (s.ai.tasks.relations.model) {
    const r = z
      .object({
        prerequisites: z.array(z.string()).max(8),
        relatedIds: z.array(z.string()),
      })
      .parse(
        parseJson(
          await runTask("relations", {
            title: entry.title,
            content: entry.content,
            entries: JSON.stringify(
              s.entries.map((e) => ({ id: e.id, title: e.title })),
            ),
          }),
        ),
      );
    await store.patch(
      "entry",
      id,
      { prerequisites: json(r.prerequisites) },
      "auto-relations",
    );
    for (const target of new Set(r.relatedIds))
      if (target !== id && s.entries.some((e) => e.id === target))
        await store.patch(
          "edge",
          crypto.randomUUID(),
          { source: id, target, label: "related" },
          "auto-relations",
        );
  }
  if (s.ai.tasks.classify.model && s.categories.length) {
    const r = z
      .object({
        categories: z.array(z.object({ id: z.string(), parent: z.string() })),
        assignments: z.array(
          z.object({ entryId: z.string(), category: z.string() }),
        ),
      })
      .parse(
        parseJson(
          await runTask("classify", {
            categories: JSON.stringify(s.categories),
            entries: JSON.stringify([
              { id, title: entry.title, content: entry.content.slice(0, 2000) },
            ]),
          }),
        ),
      );
    const assignment = r.assignments.find((a) => a.entryId === id);
    if (assignment) {
      const category =
        s.categories.find((c) => c.id === assignment.category) ??
        s.categories.find(
          (c) =>
            c.id ===
            r.categories.find((n) => n.id === assignment.category)?.parent,
        );
      if (category)
        await store.patch(
          "entry",
          id,
          { category: category.id },
          "auto-category",
        );
    }
  }
}
