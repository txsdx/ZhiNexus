/** Learning-table invariants: genuine recall estimates, faithful summaries and taxonomy rows that never hide entries. */
import { describe, it, expect } from "vitest";
import {
  knowledgeTree,
  entrySummary,
  memoryEstimate,
  memoryColor,
  type KnowledgeBranch,
} from "./knowledge-view";
import { newCard, schedule } from "./review";
import type { Entry } from "./types";
const entry = (id: string, category = ""): Entry => ({
  id,
  title: id,
  content:
    "# " + id + "\n\n## 一句话解释\n**一个可测试的定义。**\n\n## 例子\nother",
  category,
  tags: [],
  prerequisites: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  card: newCard(),
});
describe("knowledge table", () => {
  it("uses FSRS recall rather than lateness and keeps never-reviewed entries unknown", () => {
    const e = entry("memory");
    expect(memoryEstimate(e)).toBeNull();
    const start = new Date("2026-01-01T12:00:00Z");
    e.card = schedule(e.card, 95, start);
    expect(memoryEstimate(e, start)).toBeCloseTo(1);
    expect(memoryEstimate(e, new Date("2026-02-01"))!).toBeLessThan(
      memoryEstimate(e, new Date("2026-01-02"))!,
    );
    expect(memoryColor(1)).toContain("100%");
    expect(memoryColor(0.5)).toContain("memory-yellow");
    expect(memoryColor(0)).toBe(
      "color-mix(in srgb, var(--memory-yellow) 0%, var(--memory-red))",
    );
    expect(memoryColor(0.75)).toBe(
      "color-mix(in srgb, var(--memory-neutral) 50%, var(--memory-yellow))",
    );
    expect(memoryColor(0.25)).toBe(
      "color-mix(in srgb, var(--memory-yellow) 50%, var(--memory-red))",
    );
    expect(memoryColor(null)).toBe("var(--memory-neutral)");
  });
  it("extracts the explicit one-line section and accepts an authored override", () => {
    const e = entry("A");
    expect(entrySummary(e)).toBe("一个可测试的定义。");
    expect(entrySummary({ ...e, summary: "用户摘要" })).toBe("用户摘要");
  });
  it("retains descendants, uncategorized entries and all entries under malformed imported category cycles", () => {
    const entries = [
      entry("one", "a"),
      entry("two", "b"),
      entry("three", "missing"),
      entry("four", "cycle1"),
    ];
    const tree = knowledgeTree(
      [
        { id: "a", name: "A", parent: "" },
        { id: "b", name: "B", parent: "a" },
        { id: "cycle1", name: "C1", parent: "cycle2" },
        { id: "cycle2", name: "C2", parent: "cycle1" },
      ],
      entries,
    );
    const all = (nodes: KnowledgeBranch[]): Entry[] =>
      nodes.flatMap((n) => [...n.entries, ...all(n.children)]);
    expect(
      all(tree)
        .map((e) => e.id)
        .sort(),
    ).toEqual(entries.map((e) => e.id).sort());
    expect(tree.find((n) => n.id === "a")?.count).toBe(2);
  });
});
