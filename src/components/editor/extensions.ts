/** Shared Tiptap schema and Markdown codecs; source-only syntax stays an opaque block rather than being erased. */
import { Extension, Node, type Extensions } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Mathematics from "@tiptap/extension-mathematics";
import UniqueID from "@tiptap/extension-unique-id";
/** Retain raw HTML as visible source; it never becomes executable editor HTML. */
export const RawMarkdown = Node.create({
  name: "rawMarkdown",
  group: "block",
  atom: true,
  addAttributes() {
    return { raw: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "pre[data-raw-markdown]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      { ...HTMLAttributes, "data-raw-markdown": "", class: "raw-markdown" },
      node.attrs.raw,
    ];
  },
  markdownTokenName: "html",
  parseMarkdown(token) {
    return {
      type: "rawMarkdown",
      attrs: { raw: token.raw ?? token.text ?? "" },
    };
  },
  renderMarkdown(node) {
    return node.attrs?.raw ?? "";
  },
});
/** Attach stable block anchors even to third-party math and image node views. */
const BlockAnchors = Extension.create({
  name: "blockAnchors",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const anchors: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (typeof node.attrs.blockId === "string")
                anchors.push(
                  Decoration.node(offset, offset + node.nodeSize, {
                    "data-blockid": node.attrs.blockId,
                  }),
                );
            });
            return DecorationSet.create(state.doc, anchors);
          },
        },
      }),
    ];
  },
});
/** Keep one schema for rich editing, source parsing, snapshots and outline calculation. */
export function documentExtensions(
  overrides: {
    image?: typeof Image;
    codeBlock?: Extensions[number];
    onMathClick?: (latex: string, pos: number, inline: boolean) => void;
  } = {},
): Extensions {
  return [
    StarterKit.configure({
      codeBlock: overrides.codeBlock ? false : undefined,
      link: { openOnClick: false, autolink: false },
    }),
    ...(overrides.codeBlock ? [overrides.codeBlock] : []),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    overrides.image ?? Image,
    Mathematics.configure({
      inlineOptions: {
        onClick: (node, pos) =>
          overrides.onMathClick?.(String(node.attrs.latex ?? ""), pos, true),
      },
      blockOptions: {
        onClick: (node, pos) =>
          overrides.onMathClick?.(String(node.attrs.latex ?? ""), pos, false),
      },
      katexOptions: { trust: false, throwOnError: false },
    }),
    RawMarkdown,
    UniqueID.configure({
      attributeName: "blockId",
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "bulletList",
        "orderedList",
        "listItem",
        "taskList",
        "taskItem",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        "image",
        "horizontalRule",
        "blockMath",
        "rawMarkdown",
      ],
    }),
    BlockAnchors,
    Markdown,
  ];
}
