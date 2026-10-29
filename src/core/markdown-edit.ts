/** Bounded Markdown source transformations preserve all text outside the user's selected range. */
/** Toolbar commands operate on source, never rendered HTML or background AI output. */
export type MarkdownAction =
  "bold" | "italic" | "heading" | "list" | "code" | "link";
/** Selection offsets use textarea UTF-16 positions and are restored after one native undoable edit. */
export interface MarkdownEdit {
  value: string;
  start: number;
  end: number;
}
/** Apply one familiar formatting action, expanding partial surrogate selections rather than breaking an emoji. */
export function formatMarkdown(
  value: string,
  start: number,
  end: number,
  action: MarkdownAction,
  placeholder = "text",
): MarkdownEdit {
  start = Math.max(0, Math.min(value.length, start));
  end = Math.max(start, Math.min(value.length, end));
  const split = (index: number) =>
    index > 0 &&
    index < value.length &&
    /[\uD800-\uDBFF]/.test(value[index - 1]) &&
    /[\uDC00-\uDFFF]/.test(value[index]);
  if (split(start)) start--;
  if (split(end)) end++;
  const selected = value.slice(start, end),
    insert = (
      from: number,
      to: number,
      replacement: string,
      a: number,
      b: number,
    ): MarkdownEdit => ({
      value: value.slice(0, from) + replacement + value.slice(to),
      start: from + a,
      end: from + b,
    });
  if (action === "bold" || action === "italic") {
    const markers = action === "bold" ? ["**", "__"] : ["*", "_"];
    for (const marker of markers) {
      const n = marker.length,
        character = marker[0];
      const countLeft = (source: string) => {
        let count = 0;
        while (source[source.length - 1 - count] === character) count++;
        return count;
      };
      const countRight = (source: string) => {
        let count = 0;
        while (source[count] === character) count++;
        return count;
      };
      const valid = (left: number, right: number) =>
        left >= n &&
        right >= n &&
        (action === "bold" || (left % 2 === 1 && right % 2 === 1));
      if (valid(countLeft(value.slice(0, start)), countRight(value.slice(end))))
        return insert(start - n, end + n, selected, 0, selected.length);
      if (
        selected.length >= 2 * n &&
        valid(countRight(selected), countLeft(selected))
      ) {
        const inner = selected.slice(n, -n);
        return insert(start, end, inner, 0, inner.length);
      }
    }
    const marker = markers[0],
      inner = selected || placeholder;
    return insert(
      start,
      end,
      marker + inner + marker,
      marker.length,
      marker.length + inner.length,
    );
  }
  if (action === "link") {
    const label = (selected || placeholder).replace(/[\[\]\\\n\r]/g, " "),
      url = "https://";
    return insert(
      start,
      end,
      `[${label}](${url})`,
      label.length + 3,
      label.length + 3 + url.length,
    );
  }
  if (action === "code") {
    const inner = selected || placeholder,
      fence = "`".repeat(
        Math.max(
          3,
          ...(inner.match(/`+/g) ?? []).map((part) => part.length + 1),
        ),
      );
    const before = start && value[start - 1] !== "\n" ? "\n\n" : "",
      after = end < value.length && value[end] !== "\n" ? "\n\n" : "";
    const prefix = before + fence + "\n";
    return insert(
      start,
      end,
      prefix + inner + "\n" + fence + after,
      prefix.length,
      prefix.length + inner.length,
    );
  }
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1,
    breakAt = value.indexOf("\n", end > start ? end - 1 : end),
    to = breakAt < 0 ? value.length : breakAt;
  const lines = value.slice(from, to).split("\n"),
    pattern = action === "heading" ? /^#{1,6}\s+/ : /^\s*[-+*]\s+/;
  const remove =
    lines.filter((line) => line.trim()).length > 0 &&
    lines.filter((line) => line.trim()).every((line) => pattern.test(line));
  const replacement = lines
    .map((line) => {
      if (remove) return line.replace(pattern, "");
      const content =
        action === "heading"
          ? line.replace(/^#{1,6}\s+/, "")
          : line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "");
      return (action === "heading" ? "## " : "- ") + content;
    })
    .join("\n");
  return insert(from, to, replacement, 0, replacement.length);
}
/** Reduce a transformation to one replacement so browser textarea undo retains the complete edit. */
export function markdownReplacement(before: string, after: string) {
  let start = 0,
    endBefore = before.length,
    endAfter = after.length;
  while (
    start < endBefore &&
    start < endAfter &&
    before[start] === after[start]
  )
    start++;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  return { start, end: endBefore, text: after.slice(start, endAfter) };
}
