/** Regression contracts for taxonomy safety and OS reminder planning. */
import { describe, it, expect } from "vitest";
import { validateCategoryMove, categoryCount } from "../services/categories";
import { reminderPlan } from "./reminders";
import { newCard } from "./review";
describe("taxonomy edits", () => {
  const categories = [
    { id: "a", name: "A", parent: "" },
    { id: "b", name: "B", parent: "a" },
    { id: "c", name: "C", parent: "b" },
  ];
  it("rejects moving a category below its descendants or a missing node", () => {
    expect(() => validateCategoryMove(categories, "a", "c")).toThrow();
    expect(() => validateCategoryMove(categories, "b", "missing")).toThrow();
    expect(() => validateCategoryMove(categories, "c", "a")).not.toThrow();
  });
  it("counts descendants once even if malformed remote data contains a cycle", () => {
    expect(
      categoryCount(
        categories,
        [{ category: "a" }, { category: "b" }, { category: "c" }],
        "a",
      ),
    ).toBe(3);
    expect(
      categoryCount(
        [
          { id: "x", name: "X", parent: "y" },
          { id: "y", name: "Y", parent: "x" },
        ],
        [{ category: "x" }],
        "x",
      ),
    ).toBe(1);
  });
});
describe("notification planning", () => {
  it("groups due concepts and schedules overdue knowledge for the next morning", () => {
    const now = new Date("2026-10-26T04:00:00Z"),
      future = new Date(now.getTime() + 120000);
    const rows = [
      { title: "a", card: { ...newCard(), due: future } },
      { title: "b", card: { ...newCard(), due: future } },
      { title: "overdue", card: { ...newCard(), due: new Date(0) } },
    ];
    const plan = reminderPlan(rows, now);
    expect(plan).toHaveLength(2);
    expect(plan[0].count).toBe(2);
    expect(plan.every((p) => p.at > now)).toBe(true);
    expect(plan[1].at.getHours()).toBe(9);
  });
  it("limits OS alarms and assigns collision-free signed 32-bit identifiers", () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({
      title: String(i),
      card: { ...newCard(), due: new Date(Date.now() + i * 120000 + 120000) },
    }));
    const p = reminderPlan(rows);
    expect(p).toHaveLength(48);
    expect(new Set(p.map((x) => x.id)).size).toBe(48);
    expect(Math.max(...p.map((x) => x.id))).toBeLessThan(2147483647);
  });
});
