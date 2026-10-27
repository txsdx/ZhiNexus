/** React/Tiptap rich block editing with scoped zoom, safe attachments and editable diagram source. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { Copy, Highlighter, MessageSquare, Eraser, Bold } from "lucide-react";
import CodeBlock from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import { Modal, useT } from "../common";
import { Diagram, AssetImage } from "../Markdown";
import { documentExtensions } from "./extensions";
import {
  documentBlocks,
  documentMarkdown,
  scopedRange,
  replaceScoped,
  type BlockFocus,
} from "./document";
import "./editor.css";
/** Only content-addressed images are resolved, so remote Markdown never performs a tracking request. */
function ImageView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper data-blockid={node.attrs.blockId}>
      <AssetImage src={node.attrs.src} alt={node.attrs.alt} />
    </NodeViewWrapper>
  );
}
/** Mermaid is rendered through the existing strict sanitizer; its source remains a real editable code block. */
function CodeView({ node, editor }: NodeViewProps) {
  const t = useT(),
    diagram = node.attrs.language === "mermaid";
  return (
    <NodeViewWrapper
      className="rich-code-block"
      data-blockid={node.attrs.blockId}
    >
      {diagram && (
        <div contentEditable={false}>
          <Diagram code={node.textContent} />
        </div>
      )}
      <div
        className={diagram && !editor.isEditable ? "diagram-source-hidden" : ""}
      >
        <label contentEditable={false}>
          {diagram
            ? t("Mermaid 源码", "Mermaid source")
            : node.attrs.language || t("代码", "Code")}
        </label>
        <pre>
          <NodeViewContent<"code"> as="code" />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}
/** Mount one visible document slice; all transformations merge back into the complete document. */
export function BlockEditor({
  document,
  editable,
  focus,
  onChange,
  onFocus,
  onChat,
  onAnnotate,
  onFeedback,
}: {
  document: JSONContent;
  editable: boolean;
  focus: BlockFocus | null;
  onChange: (json: JSONContent, markdown: string) => void;
  onFocus: (id: string) => void;
  onChat?: (text: string) => void;
  onAnnotate?: (json: JSONContent, markdown: string) => void;
  onFeedback?: (message: string) => void;
}) {
  const t = useT(),
    full = useRef(document),
    onChangeRef = useRef(onChange),
    focusRef = useRef(focus),
    [selected, setSelected] = useState(""),
    [formula, setFormula] = useState<{
      latex: string;
      pos?: number;
      inline: boolean;
    } | null>(null);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  full.current = document;
  onChangeRef.current = onChange;
  focusRef.current = focus;
  const extensions = useMemo(
    () =>
      documentExtensions({
        onMathClick: (latex, pos, inline) => {
          if (editableRef.current) setFormula({ latex, pos, inline });
        },
        image: Image.extend({
          addNodeView() {
            return ReactNodeViewRenderer(ImageView);
          },
        }),
        codeBlock: CodeBlock.extend({
          addNodeView() {
            return ReactNodeViewRenderer(CodeView);
          },
        }),
      }),
    [],
  );
  const range = scopedRange(document, focus),
    visible: JSONContent = {
      type: "doc",
      content: document.content?.slice(range.from, range.to),
    };
  const initialized = useRef(false);
  const editor = useEditor(
    {
      extensions,
      content: visible,
      editable,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "block-document",
          role: "textbox",
          "aria-label": t("所见即所得编辑器", "WYSIWYG editor"),
          spellcheck: "false",
        },
      },
      onBeforeCreate() {
        initialized.current = false;
      },
      onCreate() {
        initialized.current = true;
      },
      onUpdate({ editor, transaction }) {
        if (
          !initialized.current ||
          !editor.isEditable ||
          !transaction.docChanged
        )
          return;
        const merged = replaceScoped(
          full.current,
          focusRef.current,
          editor.getJSON(),
        );
        full.current = merged;
        onChangeRef.current(merged, documentMarkdown(merged));
      },
      onSelectionUpdate({ editor }) {
        const { $from } = editor.state.selection;
        setSelected(
          String(
            ($from.depth ? $from.node(1) : editor.state.doc.firstChild)?.attrs
              .blockId ?? "",
          ),
        );
      },
    },
    [focus?.key],
  );
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable);
  }, [editor, editable]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const r = scopedRange(document, focus),
      incoming = {
        type: "doc",
        content: document.content?.slice(r.from, r.to),
      };
    if (
      JSON.stringify(editor.getJSON()) !==
      JSON.stringify(editor.schema.nodeFromJSON(incoming).toJSON())
    )
      editor.commands.setContent(incoming, { emitUpdate: false });
  }, [document, focus, editor]);
  if (!editor || editor.isDestroyed)
    return <p>{t("加载编辑器…", "Loading editor…")}</p>;
  if (!scopedRange(document, focus).valid)
    return (
      <p role="alert">
        {t(
          "聚焦边界已改变，请返回完整文档。",
          "Focus boundaries changed. Return to the full document.",
        )}
      </p>
    );
  const block = documentBlocks(document).find((b) => b.id === selected);
  /** An explicit annotation can enter draft editing from reading mode without changing saved knowledge. */
  const annotate = (kind: "highlight" | "clear" | "bold") => {
    if (kind === "highlight") editor.chain().focus().setHighlight().run();
    else if (kind === "clear") editor.chain().focus().unsetHighlight().run();
    else editor.chain().focus().toggleBold().run();
    const merged = replaceScoped(
      full.current,
      focusRef.current,
      editor.getJSON(),
    );
    full.current = merged;
    onAnnotate?.(merged, documentMarkdown(merged));
  };
  const selectionText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, "\n");
  };
  /** Reorder only the visible slice; undo can restore the previous block ordering. */
  const move = (direction: number) => {
    const json = editor.getJSON(),
      nodes = [...(json.content ?? [])],
      index = nodes.findIndex((n) => n.attrs?.blockId === selected),
      target = index + direction;
    if (index < 0 || target < 0 || target >= nodes.length) return;
    [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
    editor.commands.setContent({ ...json, content: nodes });
  };
  return (
    <>
      <BubbleMenu
        editor={editor}
        options={{ placement: "top", offset: 8 }}
        shouldShow={({ state }) =>
          !state.selection.empty &&
          !!state.doc
            .textBetween(state.selection.from, state.selection.to)
            .trim()
        }
      >
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label={t("划词工具", "Selection tools")}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            title={t("AI 对话", "Ask AI")}
            onClick={() => onChat?.(selectionText())}
          >
            <MessageSquare size={16} />
            {t("AI 对话", "Ask AI")}
          </button>
          <button
            title={t("黄色高亮", "Yellow highlight")}
            aria-label={t("黄色高亮", "Yellow highlight")}
            onClick={() => annotate("highlight")}
          >
            <Highlighter size={16} />
          </button>
          <button
            title={t("取消高亮", "Remove highlight")}
            aria-label={t("取消高亮", "Remove highlight")}
            onClick={() => annotate("clear")}
          >
            <Eraser size={16} />
          </button>
          <button
            title={t("加粗选区", "Bold selection")}
            aria-label={t("加粗选区", "Bold selection")}
            onClick={() => annotate("bold")}
          >
            <Bold size={16} />
          </button>
          <button
            title={t("复制选区", "Copy selection")}
            aria-label={t("复制选区", "Copy selection")}
            onClick={() => {
              const text = selectionText();
              void (async () => {
                if ("__TAURI_INTERNALS__" in window) {
                  const { writeText } =
                    await import("@tauri-apps/plugin-clipboard-manager");
                  await writeText(text);
                } else await navigator.clipboard.writeText(text);
              })().then(
                () => onFeedback?.(t("已复制选区", "Selection copied")),
                () =>
                  onFeedback?.(
                    t(
                      "复制失败，请检查剪贴板权限",
                      "Copy failed; check clipboard permissions",
                    ),
                  ),
              );
            }}
          >
            <Copy size={16} />
          </button>
        </div>
      </BubbleMenu>
      {editable && (
        <div
          className="block-toolbar"
          role="toolbar"
          aria-label={t("块编辑工具", "Block editing tools")}
        >
          <select
            aria-label={t("块类型", "Block type")}
            value={
              editor.isActive("heading")
                ? String(editor.getAttributes("heading").level)
                : "paragraph"
            }
            onChange={(e) => {
              if (e.target.value === "paragraph")
                editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: Number(e.target.value) as 1 | 2 | 3 })
                  .run();
            }}
          >
            <option value="paragraph">{t("段落", "Paragraph")}</option>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                H{n}
              </option>
            ))}
          </select>
          <button
            aria-label={t("加粗", "Bold")}
            aria-pressed={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <strong>B</strong>
          </button>
          <button
            aria-label={t("斜体", "Italic")}
            aria-pressed={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <em>I</em>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            {t("列表", "List")}
          </button>
          <button onClick={() => editor.chain().focus().toggleTaskList().run()}>
            {t("待办", "Tasks")}
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            {t("引用", "Quote")}
          </button>
          <button
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            {t("表格", "Table")}
          </button>
          <button onClick={() => setFormula({ latex: "", inline: false })}>
            {t("公式", "Formula")}
          </button>
          <button
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "codeBlock",
                  attrs: { language: "mermaid" },
                  content: [{ type: "text", text: "flowchart LR\n  A --> B" }],
                })
                .run()
            }
          >
            Mermaid
          </button>
          <button
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            {t("撤销", "Undo")}
          </button>
          <button
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            {t("重做", "Redo")}
          </button>
          <button disabled={!selected} onClick={() => move(-1)}>
            {t("块上移", "Move block up")}
          </button>
          <button disabled={!selected} onClick={() => move(1)}>
            {t("块下移", "Move block down")}
          </button>
          <button disabled={!block} onClick={() => onFocus(selected)}>
            {t("聚焦当前块", "Focus block")}
          </button>
        </div>
      )}
      <EditorContent editor={editor} className="rich-editor markdown" />
      {formula !== null && (
        <Modal
          title={t("编辑 LaTeX 公式", "Edit LaTeX formula")}
          onClose={() => setFormula(null)}
        >
          <label>
            LaTeX
            <input
              autoFocus
              value={formula.latex}
              onChange={(e) =>
                setFormula({ ...formula, latex: e.target.value })
              }
            />
          </label>
          {formula.pos === undefined && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={formula.inline}
                onChange={(e) =>
                  setFormula({ ...formula, inline: e.target.checked })
                }
              />
              {t("行内公式", "Inline formula")}
            </label>
          )}
          <button
            className="primary"
            disabled={!formula.latex.trim()}
            onClick={() => {
              const chain = editor.chain().focus();
              if (formula.pos !== undefined) {
                if (formula.inline)
                  chain
                    .updateInlineMath({
                      latex: formula.latex,
                      pos: formula.pos,
                    })
                    .run();
                else
                  chain
                    .updateBlockMath({ latex: formula.latex, pos: formula.pos })
                    .run();
              } else if (formula.inline)
                chain.insertInlineMath({ latex: formula.latex }).run();
              else chain.insertBlockMath({ latex: formula.latex }).run();
              setFormula(null);
            }}
          >
            {t("应用公式", "Apply formula")}
          </button>
        </Modal>
      )}
    </>
  );
}
