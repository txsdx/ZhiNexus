/** Search, stable references and real activity data remain deterministic under renames, exclusions and incomplete history. */
import { expect, it } from "vitest";
import { searchKnowledge, parseKnowledgeQuery } from "./knowledge-search";
import {
  entryLinks,
  hasEntryImage,
  entryLinkTarget,
  entryLinkMarkdown,
  entryReferenceIndex,
} from "./entry-links";
import { studyActivity, studyDayKey } from "./study-activity";
import { rememberedCard } from "./review";
import type { Entry, Doc } from "./types";
const now = new Date("2026-10-30T12:00:00Z");
const entries: Entry[] = [
  {
    id: "a",
    title: "安全过滤器 Safety Filter",
    content: "控制约束\n\n[屏障](entry:b)",
    category: "child",
    tags: ["机器人"],
    starred: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    card: rememberedCard(now),
  },
  {
    id: "b",
    title: "控制屏障函数",
    content: "机器人与数学\n\n不包含这段短语",
    category: "root",
    tags: ["数学"],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    card: rememberedCard(now),
  },
].map((entry) => ({ ...entry, prerequisites: [] }));
const categories = [
  { id: "root", name: "控制理论", parent: "" },
  { id: "child", name: "机器人安全", parent: "root" },
];
it("Chinese filters combine with descendants, exclusions, quoted phrases and synchronized bookmarks", () => {
  expect(
    searchKnowledge(
      entries,
      categories,
      "category:控制理论 tag:机器人 is:starred -body:数学",
      0.9,
      now,
    ).map((entry) => entry.id),
  ).toEqual(["a"]);
  expect(
    searchKnowledge(
      entries,
      categories,
      'title:"Safety Filter" has:link',
      0.9,
      now,
    ).map((entry) => entry.id),
  ).toEqual(["a"]);
  expect(
    searchKnowledge(
      entries,
      categories,
      '"机器人与数学" -tag:机器人',
      0.9,
      now,
    ).map((entry) => entry.id),
  ).toEqual(["b"]);
  expect(parseKnowledgeQuery("https://example.test is:unknown")[0].field).toBe(
    "text",
  );
  expect(
    searchKnowledge(entries, categories, "is:unknown", 0.9, now),
  ).toHaveLength(0);
  expect(searchKnowledge(entries, categories, "is:due", 0.9, now)).toHaveLength(
    0,
  );
});
it("Markdown references ignore code, images, escapes and raw HTML while resolving definitions", () => {
  const source =
    "[正确](entry:b) [重复](entry:b) ![图片](entry:c) ` [代码](entry:d) `\n\n```md\n[x](entry:e)\n```\n\n[引用][ref]\n\n[ref]: entry:f\n\n\\[转义](entry:g)\n\n<!-- [注释](entry:h) -->";
  expect(entryLinks(source).map((link) => link.id)).toEqual(["b", "f"]);
  expect(
    entryLinks(entryLinkMarkdown({ id: "b", title: "[复杂] \\ 名称" }))[0],
  ).toEqual({ id: "b", label: "[复杂] \\ 名称" });
  expect(entryLinkTarget("ENTRY:b")).toBe("b");
  for (const target of [
    "entry://host/a",
    "entry:a?token=x",
    "entry:%0A",
    "https://example.test",
    "entry:%GG",
  ])
    expect(entryLinkTarget(target)).toBeNull();
});
it("renaming keeps IDs linked, and deleting sources removes backlinks without mutating the graph", () => {
  const original = entryReferenceIndex(entries);
  expect(original.incoming.get("b")).toEqual(["a"]);
  const renamed = entryReferenceIndex(
    entries.map((entry) =>
      entry.id === "b" ? { ...entry, title: "重命名" } : entry,
    ),
  );
  expect(renamed.incoming.get("b")).toEqual(["a"]);
  expect(
    entryReferenceIndex(entries.slice(1)).incoming.get("b"),
  ).toBeUndefined();
});
it("activity counts only real completed reviews; created card priors and pending/cancelled sessions do not count", () => {
  const document = (
    collection: string,
    id: string,
    fields: unknown,
    history: unknown[] = [],
  ) => ({ collection, id, fields, history, conflicts: {} }) as Doc;
  const docs = [
    document("entry", "a", { title: "概念", createdAt: now.toISOString() }),
    document(
      "review",
      "done",
      { entryId: "a", phase: "done", startedAt: "2026-10-01T00:00:00Z" },
      [{ op: { patch: { phase: "done" }, at: now.toISOString() } }],
    ),
    document("review", "pending", {
      entryId: "a",
      phase: "graded",
      completedAt: now.toISOString(),
    }),
    document("review", "cancel", {
      entryId: "a",
      phase: "cancelled",
      completedAt: now.toISOString(),
    }),
    document("review", "future", {
      entryId: "a",
      phase: "done",
      completedAt: "2027-01-01T00:00:00Z",
    }),
  ];
  const activity = studyActivity(docs, now);
  expect(activity.created).toBe(1);
  expect(activity.reviewed).toBe(1);
  expect(activity.days.at(-1)?.key).toBe(studyDayKey(now));
  expect(activity.streak).toBe(1);
  const deleted = studyActivity(
    [{ ...docs[0], fields: { ...docs[0].fields, deleted: true } }, docs[1]],
    now,
  );
  expect(deleted.days.at(-1)?.events.every((event) => event.deleted)).toBe(
    true,
  );
  expect(
    studyActivity(
      [
        document("review", "legacy", {
          entryId: "a",
          phase: "done",
          startedAt: now.toISOString(),
        }),
      ],
      now,
    ).reviewed,
  ).toBe(0);
});

it("image filters detect real inline/reference attachments while excluding examples and escapes", () => {
  const url = "asset:" + "a".repeat(64);
  expect(hasEntryImage("![图](" + url + ")")).toBe(true);
  expect(hasEntryImage("![图][img]\n\n[img]: " + url)).toBe(true);
  expect(
    hasEntryImage("`![图](" + url + ")`\n\n```md\n![图](" + url + ")\n```"),
  ).toBe(false);
  expect(hasEntryImage("\\![图](" + url + ")")).toBe(false);
});

it("Markdown reference definitions keep the first valid destination, matching CommonMark rendering", () => {
  expect(
    entryLinks("[目标][same]\n\n[same]: entry:b\n[same]: entry:c").map(
      (link) => link.id,
    ),
  ).toEqual(["b"]);
  expect(
    hasEntryImage(
      "![图][same]\n\n[same]: https://example.test/image.png\n[same]: asset:" +
        "a".repeat(64),
    ),
  ).toBe(false);
});
