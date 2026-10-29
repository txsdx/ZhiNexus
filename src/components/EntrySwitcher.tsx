/** Quick entry navigation searches content and structured filters without submitting AI or altering a draft. */
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { ActionPicker } from "./ActionPicker";
import { useKnowledge, useT } from "./common";
import { searchKnowledge } from "../core/knowledge-search";
import { reviewTarget } from "../core/review-policy";
import { store } from "../core/store";
import { categoryPath } from "../services/categories";
import { rememberPickerAction } from "../core/action-picker";
/** Reuse the accessible picker for navigation and insertion; cancellation never changes knowledge. */
export function EntrySwitcher({
  onClose,
  onChoose,
  exclude = "",
  insert = false,
}: {
  onClose: () => void;
  onChoose: (id: string) => void;
  exclude?: string;
  insert?: boolean;
}) {
  const s = useKnowledge(),
    t = useT(),
    [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    void store.db
      .local<string[]>("recent-entries-v1", [])
      .then((value) =>
        setRecent(
          Array.isArray(value)
            ? value.filter((id) => typeof id === "string").slice(0, 8)
            : [],
        ),
      )
      .catch(() => {});
  }, []);
  const entries = useMemo(
    () =>
      s.entries
        .filter((entry) => entry.id !== exclude)
        .sort(
          (a, b) =>
            Number(!!b.starred) - Number(!!a.starred) ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
    [s.entries, exclude],
  );
  const titleCounts = new Map<string, number>();
  for (const entry of entries)
    titleCounts.set(entry.title, (titleCounts.get(entry.title) ?? 0) + 1);
  return (
    <ActionPicker
      title={
        insert
          ? t("插入词条引用", "Insert entry reference")
          : t("快速切换词条", "Go to entry")
      }
      placeholder={t(
        "标题、正文或 tag:标签 / is:starred…",
        "Title, content, tag:name / is:starred…",
      )}
      items={entries.map((entry) => ({
        id: entry.id,
        label: (entry.starred ? "★ " : "") + entry.title,
        detail: [
          categoryPath(s.categories, entry.category).join(" / "),
          (titleCounts.get(entry.title) ?? 0) > 1 ? entry.id.slice(0, 8) : "",
        ]
          .filter(Boolean)
          .join(" · "),
      }))}
      recent={recent}
      searchItems={(items, query) => {
        const ids = searchKnowledge(
            entries,
            s.categories,
            query,
            reviewTarget(s.docs),
          ).map((entry) => entry.id),
          byId = new Map(items.map((item) => [item.id, item]));
        return ids.map((id) => byId.get(id)!);
      }}
      onClose={onClose}
      onChoose={(id) => {
        flushSync(onClose);
        onChoose(id);
        if (!insert)
          void store.db
            .setLocal("recent-entries-v1", rememberPickerAction(recent, id))
            .catch(() => {});
      }}
    />
  );
}
