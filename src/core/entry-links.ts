/** Standard Markdown links identify entries by stable IDs; references never silently create semantic graph edges. */
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Entry } from "./types";
/** A reference keeps authored link text even if its destination was renamed or deleted. */
export interface EntryLink {
  id: string;
  label: string;
}
/** Accept only a bounded single entry identifier, without hosts, query parameters, fragments or control characters. */
export function entryLinkTarget(url: string): string | null {
  if (!/^entry:/i.test(url)) return null;
  try {
    const id = decodeURIComponent(url.slice(6));
    return id && id.length <= 200 && !/[\s/?#\\\x00-\x1f]/.test(id) ? id : null;
  } catch {
    return null;
  }
}
/** Produce portable, escaped Markdown source instead of title-based ambiguous lookups. */
export function entryLinkMarkdown(entry: Pick<Entry, "id" | "title">) {
  if (entryLinkTarget("entry:" + encodeURIComponent(entry.id)) !== entry.id)
    throw Error("Invalid entry reference");
  return `[${entry.title
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]])/g, "\\$1")
    .replace(/[\r\n]/g, " ")}](entry:${encodeURIComponent(entry.id)})`;
}
/** Check real image nodes, including reference-style images, without mistaking code examples for attachments. */
export function hasEntryImage(content: string): boolean {
  const root = fromMarkdown(content),
    definitions = new Map<string, string>();
  const images: string[] = [];
  type Node = {
    type: string;
    identifier?: string;
    url?: string;
    children?: Node[];
  };
  const walk = (node: Node) => {
    if (node.type === "definition" && node.identifier && node.url) {
      const key = node.identifier.toLowerCase();
      if (!definitions.has(key)) definitions.set(key, node.url);
    }
    if (node.type === "image" && node.url) images.push(node.url);
    if (node.type === "imageReference" && node.identifier)
      images.push("ref:" + node.identifier.toLowerCase());
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return images.some((url) =>
    /^asset:[a-f0-9]{64}$/.test(
      url.startsWith("ref:") ? (definitions.get(url.slice(4)) ?? "") : url,
    ),
  );
}
/** Parse actual links/references, excluding code, image targets, HTML and escaped literal Markdown. */
export function entryLinks(content: string): EntryLink[] {
  type Node = {
    type: string;
    url?: string;
    identifier?: string;
    value?: string;
    children?: Node[];
  };
  const root: Node = fromMarkdown(content),
    definitions = new Map<string, string>(),
    links = new Map<string, EntryLink>();
  const walk = (node: Node, visit: (node: Node) => void) => {
    visit(node);
    for (const child of node.children ?? []) walk(child, visit);
  };
  walk(root, (node) => {
    if (node.type === "definition" && node.identifier && node.url) {
      const key = node.identifier.toLowerCase();
      if (!definitions.has(key)) definitions.set(key, node.url);
    }
  });
  const label = (node: Node): string =>
    node.value ?? (node.children ?? []).map(label).join("");
  walk(root, (node) => {
    if (!["link", "linkReference"].includes(node.type)) return;
    const url =
        node.url ?? definitions.get(node.identifier?.toLowerCase() ?? ""),
      id = url ? entryLinkTarget(url) : null;
    if (id && !links.has(id)) links.set(id, { id, label: label(node) });
  });
  return [...links.values()];
}
const referenceCache = new Map<
  string,
  { content: string; links: EntryLink[] }
>();
/** Build one index per committed entry snapshot; unresolved links remain visible for repair. */
export function entryReferenceIndex(entries: Entry[]) {
  const outgoing = new Map<string, EntryLink[]>(),
    incoming = new Map<string, string[]>();
  for (const entry of entries) {
    const cached = referenceCache.get(entry.id);
    const links =
      cached?.content === entry.content
        ? cached.links
        : entryLinks(entry.content);
    referenceCache.set(entry.id, { content: entry.content, links });
    outgoing.set(entry.id, links);
    for (const link of links) {
      if (link.id === entry.id) continue;
      incoming.set(link.id, [...(incoming.get(link.id) ?? []), entry.id]);
    }
  }
  const live = new Set(entries.map((entry) => entry.id));
  for (const id of referenceCache.keys())
    if (!live.has(id)) referenceCache.delete(id);
  return { outgoing, incoming };
}
