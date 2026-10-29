/** Apply toolbar changes through the browser's text editing operation so native undo/redo remains available. */
import type { MarkdownEdit } from "../core/markdown-edit";
import { markdownReplacement } from "../core/markdown-edit";
/** Reject stale or unsupported edits rather than replacing text typed after the formatting snapshot. */
export function editTextarea(
  field: HTMLTextAreaElement,
  before: string,
  edit: MarkdownEdit,
) {
  if (field.disabled || field.readOnly || field.value !== before)
    throw Error("内容已改变，请重新选择 / Text changed; select again");
  if (edit.value.length > 8 * 1024 * 1024)
    throw Error("正文超过8 MiB限制 / Text exceeds 8 MiB");
  const change = markdownReplacement(before, edit.value),
    scroll = field.scrollTop;
  field.focus({ preventScroll: true });
  field.setSelectionRange(change.start, change.end);
  if (
    !document.execCommand("insertText", false, change.text) ||
    field.value !== edit.value
  )
    throw Error(
      "当前环境无法应用格式，请保留原文后重试 / Formatting unavailable; retain your text and retry",
    );
  field.setSelectionRange(edit.start, edit.end);
  field.scrollTop = scroll;
}
