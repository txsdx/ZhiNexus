/** Language-independent structured knowledge search shares filters and ranking across the library and quick switcher. */
import { entryLinks, hasEntryImage } from "./entry-links";
import Fuse from "fuse.js";
import type { Category, Entry } from "./types";
import { needsReview } from "./review-policy";
import { importanceLevel } from "./importance";
/** A quoted phrase is literal; recognized filters and exclusions never become executable queries. */
export interface SearchTerm {
  field: string;
  value: string;
  negative: boolean;
  exact: boolean;
}
/** Preserve unknown operators as searchable text, including URLs and partially typed filters. */
export function parseKnowledgeQuery(query: string): SearchTerm[] {
  const tokens = query.match(/(?:[^\s"]+|"[^"]*"|"[^"]*$)+/g) ?? [];
  return tokens.map((raw) => {
    const negative = raw.startsWith("-") && raw.length > 1;
    const text = negative ? raw.slice(1) : raw;
    const match = /^(title|body|tag|category|is|has|id|importance):(.+)$/i.exec(
      text,
    );
    const value = (match?.[2] ?? text).replace(/"/g, "");
    let field = match?.[1].toLowerCase() ?? "text";
    if (
      (field === "importance" &&
        !["high", "normal", "low", "高", "普通", "中", "低"].includes(
          value.toLowerCase(),
        )) ||
      (field === "is" && !["due", "starred"].includes(value.toLowerCase())) ||
      (field === "has" &&
        !["image", "tag", "link"].includes(value.toLowerCase()))
    )
      field = "text";
    return {
      field,
      value: field === "text" && match ? text.replace(/"/g, "") : value,
      negative,
      exact: text.includes('"'),
    };
  });
}
/** Filter all text in Unicode without relying on Latin FTS boundaries; rank positive fuzzy terms instead of discarding relevance. */
export function searchKnowledge(
  entries: Entry[],
  categories: Category[],
  query: string,
  retention = 0.9,
  now = new Date(),
) {
  const terms = parseKnowledgeQuery(query),
    normalized = (value: string) => value.toLocaleLowerCase(),
    scores = new Map<string, number>();
  const createFuzzy = () =>
    new Fuse(entries, {
      keys: [
        { name: "title", weight: 3 },
        { name: "tags", weight: 2 },
        "summary",
        "content",
      ],
      threshold: 0.35,
      ignoreLocation: true,
      includeScore: true,
    });
  const path = (id: string) => {
    const parts: string[] = [],
      seen = new Set<string>();
    let category = categories.find((c) => c.id === id);
    while (category && !seen.has(category.id)) {
      seen.add(category.id);
      parts.unshift(category.name);
      category = categories.find((c) => c.id === category!.parent);
    }
    return parts.join(" / ");
  };
  let results = [...entries],
    fuzzy: Fuse<Entry> | undefined;
  for (const term of terms) {
    const value = normalized(term.value);
    let matches: (entry: Entry) => boolean;
    if (term.field === "text" && !term.negative && !term.exact) {
      const found = new Map(
        (fuzzy ??= createFuzzy())
          .search(term.value)
          .map((result) => [result.item.id, result.score ?? 1]),
      );
      matches = (entry) => found.has(entry.id);
      for (const [id, score] of found)
        scores.set(id, (scores.get(id) ?? 0) + score);
    } else
      matches = (entry) => {
        const contains = (text: string) => normalized(text).includes(value);
        switch (term.field) {
          case "title":
            return contains(entry.title);
          case "body":
            return contains(entry.content);
          case "tag":
            return entry.tags.some(contains);
          case "category":
            return ["uncategorized", "未分类"].includes(value)
              ? !entry.category
              : contains(path(entry.category));
          case "id":
            return entry.id === term.value;
          case "importance":
            return (
              importanceLevel(entry) ===
              (
                {
                  high: "high",
                  高: "high",
                  normal: "normal",
                  普通: "normal",
                  中: "normal",
                  low: "low",
                  低: "low",
                } as Record<string, string>
              )[value]
            );
          case "is":
            return value === "starred"
              ? entry.starred === true
              : needsReview(entry, retention, now);
          case "has":
            return value === "tag"
              ? entry.tags.length > 0
              : value === "image"
                ? hasEntryImage(entry.content)
                : entryLinks(entry.content).length > 0;
          default:
            return [
              entry.title,
              entry.summary ?? "",
              entry.content,
              ...entry.tags,
            ].some(contains);
        }
      };
    results = results.filter((entry) =>
      term.negative ? !matches(entry) : matches(entry),
    );
  }
  return results.sort((a, b) =>
    scores.size
      ? (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0) ||
        b.updatedAt.localeCompare(a.updatedAt)
      : Number(!!b.starred) - Number(!!a.starred) ||
        b.updatedAt.localeCompare(a.updatedAt),
  );
}
