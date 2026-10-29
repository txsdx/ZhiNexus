/** Stable fuzzy action ranking keeps unavailable actions out and preserves useful recent-command ordering. */
import Fuse from "fuse.js";
/** A display-only command descriptor; executing actions stays with the owning view. */
export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
}
/** Search labels and keywords without interpreting user input as commands or changing source ordering. */
export function rankPickerItems<T extends PickerItem>(
  items: T[],
  query: string,
  recent: string[] = [],
) {
  const available = items.filter((item) => !item.disabled);
  if (query.trim())
    return new Fuse(available, {
      keys: [{ name: "label", weight: 2 }, "keywords", "detail"],
      threshold: 0.36,
      ignoreLocation: true,
    })
      .search(query.trim())
      .map((result) => result.item);
  const positions = new Map(recent.map((id, index) => [id, index]));
  return available
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (positions.get(a.item.id) ?? 10000) -
          (positions.get(b.item.id) ?? 10000) || a.index - b.index,
    )
    .map(({ item }) => item);
}
/** Keep at most eight unique, recent action identities; never persist arbitrary search text or callbacks. */
export function rememberPickerAction(recent: unknown, id: string) {
  return [
    id,
    ...(Array.isArray(recent)
      ? recent.filter(
          (value): value is string => typeof value === "string" && value !== id,
        )
      : []),
  ].slice(0, 8);
}
/** Match visible keyboard hints to the platform's actual modifier key. */
export function shortcutModifier(platform = navigator.platform) {
  return /Mac|iPhone|iPad/i.test(platform) ? "⌘" : "Ctrl";
}
