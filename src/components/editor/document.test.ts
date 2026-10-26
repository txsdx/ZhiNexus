/** Block document contracts cover Markdown constructs, stable identities and focused edits that preserve hidden siblings. */
import { describe, it, expect } from "vitest";
import {
  entryDocument,
  documentMarkdown,
  storedDocument,
  documentBlocks,
  replaceFocused,
  focusRange,
} from "./document";
describe("block documents", () => {
  it("round-trips formulas, diagrams, tables, tasks and content-addressed images", () => {
    const source =
      "# 概念\n\n一句话 **解释** 和 $x^2$。\n\n$$\nE=mc^2\n$$\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] 完成\n\n![示意](asset:" +
      "a".repeat(64) +
      ")";
    const json = entryDocument({ content: source }),
      output = documentMarkdown(json);
    for (const text of [
      "x^2",
      "E=mc^2",
      "```mermaid",
      "A --> B",
      "[x]",
      "asset:" + "a".repeat(64),
    ])
      expect(output).toContain(text);
    expect(output).toMatch(/\|\s*A\s*\|\s*B\s*\|/);
    expect(documentBlocks(json).some((b) => b.type === "blockMath")).toBe(true);
    const loaded = entryDocument({
      content: output,
      editorDocument: storedDocument(output, json),
    });
    expect(documentBlocks(loaded).map((b) => b.id)).toEqual(
      documentBlocks(json).map((b) => b.id),
    );
  });
  it("focuses a heading section and cannot delete the preceding or following section", () => {
    const json = entryDocument({
        content:
          "# A\n\nkeep before\n\n## B\n\nedit here\n\n### C\n\nchild\n\n## D\n\nkeep after",
      }),
      blocks = documentBlocks(json),
      b = blocks.find((x) => x.text === "B")!;
    expect(focusRange(json, b.id)).toEqual({ from: 2, to: 6 });
    const merged = replaceFocused(
        json,
        b.id,
        entryDocument({ content: "replacement" }),
      ),
      text = documentMarkdown(merged);
    expect(text).toContain("keep before");
    expect(text).toContain("keep after");
    expect(text).toContain("replacement");
    expect(text).not.toContain("edit here");
  });
  it("invalidates a stale rich cache when AI or another device replaces Markdown", () => {
    const old = entryDocument({ content: "# old" });
    const current = entryDocument({
      content: "# new",
      editorDocument: storedDocument("# old", old),
    });
    expect(documentMarkdown(current)).toContain("new");
  });
  it("retains raw HTML as inert text when serializing rich edits", () => {
    const source = '<script>alert("untrusted")</script>\n\nnormal';
    expect(documentMarkdown(entryDocument({ content: source }))).toContain(
      "<script>",
    );
  });
});

it("frozen focus survives deleting its heading and repeated full replacements", async () => {
  const { createBlockFocus, replaceScoped, scopedRange } =
    await import("./document");
  const json = entryDocument({
    content:
      "# Before\n\npreserve before\n\n## Focus\n\nreplace\n\n## After\n\npreserve after",
  });
  const focus = createBlockFocus(
    json,
    documentBlocks(json).find((b) => b.text === "Focus")!.id,
  )!;
  const first = replaceScoped(
    json,
    focus,
    entryDocument({ content: "first replacement" }),
  );
  const second = replaceScoped(
    first,
    focus,
    entryDocument({ content: "second replacement\n\nnew paragraph" }),
  );
  expect(documentMarkdown(second)).toContain("preserve before");
  expect(documentMarkdown(second)).toContain("preserve after");
  expect(documentMarkdown(second)).toContain("second replacement");
  expect(scopedRange(second, focus).to - scopedRange(second, focus).from).toBe(
    2,
  );
  const broken = {
    ...second,
    content: second.content?.filter((n) => n.attrs?.blockId !== focus.after),
  };
  expect(() =>
    replaceScoped(broken, focus, entryDocument({ content: "must not erase" })),
  ).toThrow(/Focus boundaries changed/);
});
it("invalid rich cache falls back to authoritative Markdown and complex source is detected conservatively", async () => {
  const { sourceOnlyMarkdown } = await import("./document");
  const current = entryDocument({
    content: "# authoritative",
    editorDocument: {
      schema: 1,
      markdown: "# authoritative",
      json: { type: "doc", content: 123 },
    },
  });
  expect(documentMarkdown(current)).toContain("authoritative");
  expect(sourceOnlyMarkdown("footnote[^1]\n\n[^1]: keep")).toBe(true);
  expect(sourceOnlyMarkdown("<script>inert</script>")).toBe(true);
  expect(sourceOnlyMarkdown("```html\n<div>code</div>\n```")).toBe(false);
  expect(sourceOnlyMarkdown("inline `<div>` code")).toBe(false);
});
