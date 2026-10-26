/** Stable block identifiers, heading outlines and scoped document replacement without touching hidden blocks. */
import { getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Entry, Json } from "../../core/types";
import { documentExtensions } from "./extensions";
const codec = new MarkdownManager({ extensions: documentExtensions() });
const schema = getSchema(documentExtensions());
const inline = new Set(["text", "inlineMath", "hardBreak"]);
/** Attach IDs to structural blocks; IDs survive rich editing, synchronization and undo. */
export function identifyBlocks(json: JSONContent): JSONContent {
  const used = new Set<string>();
  const visit = (node: JSONContent): JSONContent => {
    const attrs = { ...node.attrs };
    if (node.type !== "doc" && !inline.has(node.type ?? "")) {
      let id = typeof attrs.blockId === "string" ? attrs.blockId : "";
      if (!id || used.has(id)) id = crypto.randomUUID();
      attrs.blockId = id;
      used.add(id);
    }
    return {
      ...node,
      ...(Object.keys(attrs).length ? { attrs } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
  };
  return visit(json);
}
/** Reuse a rich document only when its embedded Markdown exactly matches the authoritative content register. */
export function entryDocument(
  entry: Pick<Entry, "content" | "editorDocument">,
): JSONContent {
  const cached = entry.editorDocument;
  const json =
    cached?.schema === 1 && cached.markdown === entry.content
      ? (cached.json as JSONContent)
      : null;
  if (json?.type === "doc") {
    try {
      const node = schema.nodeFromJSON(json);
      node.check();
      return identifyBlocks(node.toJSON());
    } catch {
      /* A derived cache never overrides authoritative Markdown. */
    }
  }
  return identifyBlocks(codec.parse(entry.content));
}
/** Serialize through the maintained Markdown codec, keeping formulas, tasks, tables, diagrams and local assets. */
export function documentMarkdown(document: JSONContent): string {
  return codec.serialize(document);
}
/** Convert the editor JSON to the replicated JSON boundary. */
export function storedDocument(
  markdown: string,
  json: JSONContent,
): NonNullable<Entry["editorDocument"]> {
  return {
    schema: 1,
    markdown,
    json: JSON.parse(JSON.stringify(json)) as Json,
  };
}
/** A navigable top-level block; headings retain their semantic nesting level. */
export interface DocumentBlock {
  id: string;
  index: number;
  type: string;
  level: number;
  text: string;
}
/** Produce plain block labels without rendering or executing imported content. */
export function documentBlocks(document: JSONContent): DocumentBlock[] {
  const text = (node: JSONContent): string =>
    node.text ??
    node.attrs?.latex ??
    node.attrs?.alt ??
    (node.content ?? []).map(text).join(" ");
  return (document.content ?? []).map((node, index) => ({
    id: String(node.attrs?.blockId ?? ""),
    index,
    type: node.type ?? "paragraph",
    level: node.type === "heading" ? Number(node.attrs?.level ?? 1) : 0,
    text: text(node).trim().slice(0, 100),
  }));
}
/** Zooming a heading includes its section; another block includes only that block. */
export function focusRange(
  document: JSONContent,
  id: string | null,
): { from: number; to: number } {
  const blocks = documentBlocks(document),
    from = id ? blocks.findIndex((b) => b.id === id) : -1;
  if (from < 0) return { from: 0, to: blocks.length };
  let to = from + 1;
  if (blocks[from].level)
    while (
      to < blocks.length &&
      (!blocks[to].level || blocks[to].level > blocks[from].level)
    )
      to++;
  return { from, to };
}
/** Replace the visible subdocument only: Ctrl+A/delete in focused mode cannot erase hidden siblings. */
export function replaceFocused(
  document: JSONContent,
  id: string | null,
  replacement: JSONContent,
): JSONContent {
  const { from, to } = focusRange(document, id),
    nodes = document.content ?? [];
  return identifyBlocks({
    ...document,
    content: [
      ...nodes.slice(0, from),
      ...(replacement.content ?? []),
      ...nodes.slice(to),
    ],
  });
}

/** Stable sibling boundaries keep a focused editing region safe even when its original heading is deleted. */
export interface BlockFocus {
  id: string;
  key: string;
  before: string | null;
  after: string | null;
}
/** Capture the section's outside siblings once; editing inside it never broadens its scope. */
export function createBlockFocus(
  document: JSONContent,
  id: string,
): BlockFocus | null {
  const blocks = documentBlocks(document),
    index = blocks.findIndex((b) => b.id === id);
  if (index < 0) return null;
  const { from, to } = focusRange(document, id);
  return {
    id,
    key: crypto.randomUUID(),
    before: blocks[from - 1]?.id ?? null,
    after: blocks[to]?.id ?? null,
  };
}
/** Missing boundaries fail closed rather than exposing hidden content to a later select-all operation. */
export function scopedRange(
  document: JSONContent,
  focus: BlockFocus | null,
): { from: number; to: number; valid: boolean } {
  const nodes = document.content ?? [];
  if (!focus) return { from: 0, to: nodes.length, valid: true };
  const before =
    focus.before === null
      ? -1
      : nodes.findIndex((n) => n.attrs?.blockId === focus.before);
  const after =
    focus.after === null
      ? nodes.length
      : nodes.findIndex((n) => n.attrs?.blockId === focus.after);
  if (
    (focus.before !== null && before < 0) ||
    (focus.after !== null && after < 0) ||
    after <= before
  )
    return { from: 0, to: 0, valid: false };
  return { from: before + 1, to: after, valid: true };
}
/** Replace only nodes between frozen boundaries, retaining all outside JSON byte-for-byte. */
export function replaceScoped(
  document: JSONContent,
  focus: BlockFocus | null,
  replacement: JSONContent,
): JSONContent {
  const { from, to, valid } = scopedRange(document, focus);
  if (!valid)
    throw Error(
      "聚焦区域的边界已变化，请返回完整文档 / Focus boundaries changed; return to the full document",
    );
  const nodes = document.content ?? [];
  return identifyBlocks({
    ...document,
    content: [
      ...nodes.slice(0, from),
      ...(replacement.content ?? []),
      ...nodes.slice(to),
    ],
  });
}

/** Footnotes and embedded HTML keep their original source instead of undergoing a lossy rich-text conversion. */
export function sourceOnlyMarkdown(markdown: string): boolean {
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,}|\${2})/);
    if (marker) {
      const char = marker[1][0];
      if (!fence) fence = char;
      else if (fence === char) fence = null;
      continue;
    }
    if (fence) continue;
    const prose = line.replace(/(`+).*?\1/g, "").replace(/\$[^$]+\$/g, "");
    if (/^\s*\[\^[^\]]+\]:/.test(prose) || /<\/?[a-z][^>]*>/i.test(prose))
      return true;
  }
  return false;
}
