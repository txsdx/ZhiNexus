/** Three knowledge priorities are independent of taxonomy, bookmarks and measured recall. */
import { z } from "zod";
import type { Entry } from "./types";
/** Stable serialized levels; normal is the non-mutating default for unclassified knowledge. */
export const importanceLevels = ["high", "normal", "low"] as const;
/** A whole register keeps the chosen level and its override policy causally consistent. */
export const importanceSchema = z
  .object({
    level: z.enum(importanceLevels),
    mode: z.enum(["auto", "manual"]),
    reason: z.string().max(600).optional(),
  })
  .strict();
/** The AI proposes a bounded, reviewable rationale rather than fabricating a memory measurement. */
export const importanceSuggestionSchema = z
  .object({
    level: z.enum(importanceLevels),
    reason: z.string().trim().min(1).max(600),
  })
  .strict();
/** Synchronized priority and user override, stored together in one CRDT field. */
export type EntryImportance = z.infer<typeof importanceSchema>;
/** One of the three user-facing knowledge priorities. */
export type ImportanceLevel = EntryImportance["level"];
/** Labels are deliberately separate from forgetting colors and category names. */
export const importanceLabels: Record<ImportanceLevel, [string, string]> = {
  high: ["高", "High"],
  normal: ["普通", "Normal"],
  low: ["低 · 免复习", "Low · No review"],
};
/** Missing metadata means ordinary review, without writing a migration or rewriting old cards. */
export function importanceLevel(
  entry: Pick<Entry, "importance">,
): ImportanceLevel {
  return entry.importance?.level ?? "normal";
}
/** Low-priority knowledge keeps its entire learning history but is excluded from every review path. */
export function reviewEnabled(entry: Pick<Entry, "importance">): boolean {
  return importanceLevel(entry) !== "low";
}
/** A user gesture locks its choice until the user explicitly opts into AI assessment again. */
export function manualImportance(level: ImportanceLevel): EntryImportance {
  return importanceSchema.parse({ level, mode: "manual" });
}
/** Stable priority rank only orders eligible work; it never changes an FSRS probability or interval. */
export function importanceRank(entry: Pick<Entry, "importance">): number {
  return importanceLevels.indexOf(importanceLevel(entry));
}
