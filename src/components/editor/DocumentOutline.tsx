/** Independent heading outline and block navigation, supporting section or single-block zoom. */
import type { JSONContent } from "@tiptap/core";
import { documentBlocks } from "./document";
import { useT } from "../common";
/** Navigate by durable block ID; focus creates an editable slice without removing sibling content. */
export function DocumentOutline({
  document,
  focusId,
  onFocus,
  onLocate,
  allowFocus = true,
}: {
  allowFocus?: boolean;
  document: JSONContent;
  focusId: string | null;
  onFocus: (id: string | null) => void;
  onLocate: (id: string) => void;
}) {
  const t = useT(),
    blocks = documentBlocks(document),
    headings = blocks.filter((b) => b.level > 0);
  return (
    <section className="document-outline">
      <h3>{t("文档大纲", "Document outline")}</h3>
      {focusId && (
        <button className="full" onClick={() => onFocus(null)}>
          {t("返回完整文档", "Show full document")}
        </button>
      )}
      {headings.length ? (
        headings.map((h) => (
          <div
            className="outline-row"
            key={h.id}
            style={{ paddingInlineStart: (h.level - 1) * 10 }}
          >
            <button title={h.text} onClick={() => onLocate(h.id)}>
              {h.text || t("空标题", "Empty heading")}
            </button>
            <button
              className="outline-focus"
              disabled={!allowFocus}
              aria-label={t("聚焦：", "Focus: ") + h.text}
              onClick={() => onFocus(h.id)}
            >
              ↗
            </button>
          </div>
        ))
      ) : (
        <p className="muted">
          {t("添加标题即可生成大纲", "Add headings to build an outline")}
        </p>
      )}
      <details>
        <summary>
          {t("全部内容块", "All content blocks")} · {blocks.length}
        </summary>
        {blocks.map((b, i) => (
          <div className="outline-row" key={b.id}>
            <button onClick={() => onLocate(b.id)}>
              {i + 1}. {b.text || b.type}
            </button>
            <button
              className="outline-focus"
              disabled={!allowFocus}
              aria-label={t("聚焦块 ", "Focus block ") + (i + 1)}
              onClick={() => onFocus(b.id)}
            >
              ↗
            </button>
          </div>
        ))}
      </details>
    </section>
  );
}
