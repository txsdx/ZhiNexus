/** Learning-table projections: readable summaries, real FSRS recall estimates and lossless taxonomy traversal. */
import { fsrs } from "ts-fsrs";
import type { Category, Entry } from "./types";
import { reviveCard } from "./review";
const scheduler = fsrs({ request_retention: 0.9 });
/** An unreviewed concept has no measured recall probability, rather than a fabricated forgetting score. */
export function memoryEstimate(entry: Entry, now = new Date()): number | null {
  if (!entry.card.last_review || entry.card.reps === 0) return null;
  const retention = scheduler.get_retrievability(
    reviveCard(entry.card),
    now,
    false,
  );
  return Number.isFinite(retention)
    ? Math.min(1, Math.max(0, retention))
    : null;
}
/** Interpolate neutral → yellow → red using the estimated forgotten proportion, keeping theme colors accessible. */
export function memoryColor(retention: number | null): string {
  if (retention === null) return "var(--memory-neutral)";
  const risk = 1 - retention;
  return risk <= 0.5
    ? `color-mix(in srgb, var(--memory-neutral) ${100 - risk * 200}%, var(--memory-yellow))`
    : `color-mix(in srgb, var(--memory-yellow) ${(1 - risk) * 200}%, var(--memory-red))`;
}
/** Strip presentation markup for a single plain-text sentence; never execute imported Markdown. */
function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/^[\s>#*\-]+/g, "")
    .replace(/[*_`]/g, "")
    .trim();
}
/** Prefer the authored summary, then the template's one-sentence section, then the first prose line. */
export function entrySummary(entry: Entry): string {
  if (entry.summary?.trim()) return entry.summary.trim();
  const lines = entry.content.split(/\r?\n/);
  const heading = lines.findIndex((line) =>
    /^#{1,6}\s+.*(一句话|one.?sentence|in a nutshell)/i.test(line),
  );
  const candidates = heading >= 0 ? lines.slice(heading + 1) : lines;
  let fenced = false;
  for (const line of candidates) {
    if (/^\s*(```|~~~|\$\$)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line.trim() || /^\s*(#{1,6}\s|\||---\s*$)/.test(line))
      continue;
    const value = plain(line);
    if (value && value !== entry.title) return value.slice(0, 300);
  }
  return "";
}
/** A category row and its descendants, with exact recursive entry counts. */
export interface KnowledgeBranch {
  id: string;
  name: string;
  entries: Entry[];
  children: KnowledgeBranch[];
  count: number;
}
/** Include every entry exactly once, even if imported categories contain dangling parents or cycles. */
export function knowledgeTree(
  categories: Category[],
  entries: Entry[],
): KnowledgeBranch[] {
  const nodes = new Map(
    categories.map((c) => [
      c.id,
      {
        id: c.id,
        name: c.name,
        entries: [] as Entry[],
        children: [] as KnowledgeBranch[],
        count: 0,
      },
    ]),
  );
  const parents = new Map(categories.map((c) => [c.id, c.parent]));
  const roots: KnowledgeBranch[] = [];
  for (const category of categories) {
    const seen = new Set([category.id]);
    let p = category.parent,
      cycle = false;
    while (p && parents.has(p)) {
      if (seen.has(p)) {
        cycle = true;
        break;
      }
      seen.add(p);
      p = parents.get(p)!;
    }
    const parent = !cycle ? nodes.get(category.parent) : undefined;
    if (parent) parent.children.push(nodes.get(category.id)!);
    else roots.push(nodes.get(category.id)!);
  }
  const loose: KnowledgeBranch = {
    id: "__uncategorized__",
    name: "",
    entries: [],
    children: [],
    count: 0,
  };
  for (const entry of entries)
    (nodes.get(entry.category) ?? loose).entries.push(entry);
  const total = (branch: KnowledgeBranch): number =>
    (branch.count =
      branch.entries.length +
      branch.children.reduce((sum, c) => sum + total(c), 0));
  if (loose.entries.length) roots.push(loose);
  roots.forEach(total);
  return roots;
}
