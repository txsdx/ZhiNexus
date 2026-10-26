/** Translate physical keyboard events into the stable Tauri/global-hotkey accelerator syntax. */
export interface ShortcutStroke {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}
const names: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Minus: "Minus",
  Equal: "Equal",
  BracketLeft: "BracketLeft",
  BracketRight: "BracketRight",
  Backslash: "Backslash",
  Semicolon: "Semicolon",
  Quote: "Quote",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backquote: "Backquote",
};
/** Ignore incomplete/IME/repeated strokes and reserve bare Escape for cancelling capture. */
export function shortcutFromStroke(e: ShortcutStroke): string | null {
  if (e.repeat || e.isComposing || e.code === "Escape") return null;
  const key = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3)
    : /^Digit[0-9]$/.test(e.code)
      ? e.code.slice(5)
      : /^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)
        ? e.code
        : names[e.code];
  if (!key || (!(e.ctrlKey || e.altKey || e.metaKey) && !/^F\d+$/.test(key)))
    return null;
  return [
    ...(e.ctrlKey ? ["Control"] : []),
    ...(e.altKey ? ["Alt"] : []),
    ...(e.shiftKey ? ["Shift"] : []),
    ...(e.metaKey ? ["Super"] : []),
    key,
  ].join("+");
}
