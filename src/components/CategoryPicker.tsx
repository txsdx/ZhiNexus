/** Shared searchable category-tree dialog for capture and entry property editing. */
import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Pencil,
} from "lucide-react";
import { Modal, useKnowledge, useT } from "./common";
import { categoryPath } from "../services/categories";
import type { Category } from "../core/types";
/** Selecting a node commits exactly one choice; cancel, Escape and failed persistence retain the previous value. */
export function CategoryPicker({
  value,
  onChange,
  categories: suppliedCategories,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void | Promise<void>;
  categories?: Category[];
  disabled?: boolean;
}) {
  const s = useKnowledge(),
    t = useT(),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    choosing = useRef(false);
  const categories = suppliedCategories ?? s.categories;
  const path = categoryPath(categories, value);
  const pathLabel = path.length
    ? path.join(" / ")
    : t("未分类", "Uncategorized");
  const choose = async (id: string) => {
    if (choosing.current || disabled) return;
    choosing.current = true;
    setBusy(true);
    setError("");
    try {
      await onChange(id);
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      choosing.current = false;
      setBusy(false);
    }
  };
  const matches = new Set(
    categories
      .filter((c) =>
        c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      )
      .map((c) => c.id),
  );
  if (query)
    for (const id of [...matches]) {
      const visited = new Set<string>();
      let current = categories.find((c) => c.id === id);
      while (current?.parent && !visited.has(current.parent)) {
        visited.add(current.parent);
        matches.add(current.parent);
        current = categories.find((c) => c.id === current!.parent);
      }
    }
  const visited = new Set<string>();
  const render = (parent: string, depth = 1): React.ReactNode =>
    categories
      .filter(
        (c) =>
          c.parent === parent &&
          !visited.has(c.id) &&
          (!query || matches.has(c.id)),
      )
      .map((c) => {
        visited.add(c.id);
        const children = categories.some((child) => child.parent === c.id),
          closed = !query && collapsed.has(c.id);
        return (
          <li key={c.id}>
            <div className="category-picker-row">
              {children ? (
                <button
                  type="button"
                  className="icon"
                  aria-label={
                    t(
                      closed ? "展开 " : "收起 ",
                      closed ? "Expand " : "Collapse ",
                    ) + c.name
                  }
                  onClick={() =>
                    setCollapsed((previous) => {
                      const next = new Set(previous);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                >
                  {closed ? (
                    <ChevronRight size={15} />
                  ) : (
                    <ChevronDown size={15} />
                  )}
                </button>
              ) : (
                <span className="picker-spacer" />
              )}
              <button
                type="button"
                role="treeitem"
                aria-level={depth}
                data-category-id={c.id}
                aria-expanded={children ? !closed : undefined}
                aria-selected={value === c.id}
                disabled={busy}
                onClick={() => void choose(c.id)}
              >
                {closed ? <Folder size={16} /> : <FolderOpen size={16} />}
                <span>{c.name}</span>
                {value === c.id && <b aria-hidden="true">✓</b>}
              </button>
            </div>
            {!closed && <ul role="group">{render(c.id, depth + 1)}</ul>}
          </li>
        );
      });
  const tree = render("");
  return (
    <>
      <div className="category-path-control">
        <span
          className="category-path"
          aria-label={t("完整分类路径", "Full category path")}
          title={pathLabel}
        >
          <Folder size={16} aria-hidden="true" />
          <span>{pathLabel}</span>
        </span>
        <button
          type="button"
          className="category-picker-trigger"
          aria-label={t("选择所属分类", "Choose category")}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => {
            setQuery("");
            setError("");
            setOpen(true);
          }}
        >
          <Pencil size={14} aria-hidden="true" />
          {t("修改分类", "Change category")}
        </button>
      </div>
      {open && (
        <Modal
          title={t("选择分类", "Choose category")}
          className="category-picker-modal"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <input
            autoFocus
            type="search"
            aria-label={t("搜索分类", "Search categories")}
            placeholder={t("搜索分类…", "Search categories…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                !e.repeat
              ) {
                e.preventDefault();
                e.stopPropagation();
                const first = categories.find((c) =>
                  c.name
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                );
                if (query && first) void choose(first.id);
              }
            }}
          />
          <ul
            className="category-picker-tree"
            role="tree"
            aria-label={t("可选分类树", "Available category tree")}
            onKeyDown={(event) => {
              if (
                ![
                  "ArrowDown",
                  "ArrowUp",
                  "ArrowLeft",
                  "ArrowRight",
                  "Home",
                  "End",
                ].includes(event.key)
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              const rows = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="treeitem"]:not(:disabled)',
                  ),
                ],
                index = rows.indexOf(
                  document.activeElement as HTMLButtonElement,
                ),
                current = rows[index],
                id = current?.dataset.categoryId;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                if (!id || query) return;
                const hasChildren = categories.some((c) => c.parent === id);
                if (
                  event.key === "ArrowLeft" &&
                  hasChildren &&
                  !collapsed.has(id)
                )
                  setCollapsed((previous) => new Set([...previous, id]));
                else if (
                  event.key === "ArrowRight" &&
                  hasChildren &&
                  collapsed.has(id)
                )
                  setCollapsed(
                    (previous) =>
                      new Set([...previous].filter((key) => key !== id)),
                  );
                else if (event.key === "ArrowRight" && hasChildren)
                  rows[index + 1]?.focus();
                else if (event.key === "ArrowLeft") {
                  const parent = categories.find((c) => c.id === id)?.parent;
                  rows
                    .find((row) => row.dataset.categoryId === parent)
                    ?.focus();
                }
                return;
              }
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? rows.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        rows.length) %
                      rows.length;
              rows[next]?.focus();
            }}
          >
            <li>
              <button
                type="button"
                role="treeitem"
                aria-selected={!value}
                disabled={busy}
                onClick={() => void choose("")}
              >
                {t("未分类", "Uncategorized")}
                {!value && <span aria-hidden="true"> ✓</span>}
              </button>
            </li>
            {tree}
            {categories
              .filter((c) => {
                if (visited.has(c.id) || (query && !matches.has(c.id)))
                  return false;
                const seen = new Set<string>([c.id]);
                let parent = c.parent;
                while (parent) {
                  if (seen.has(parent)) return true;
                  seen.add(parent);
                  const ancestor = categories.find(
                    (category) => category.id === parent,
                  );
                  if (!ancestor) return true;
                  if (!query && collapsed.has(parent)) return false;
                  parent = ancestor.parent;
                }
                return true;
              })
              .map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="treeitem"
                    disabled={busy}
                    aria-selected={value === c.id}
                    onClick={() => void choose(c.id)}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
          </ul>
          {error && <p role="alert">{error}</p>}
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            {t("取消", "Cancel")}
          </button>
        </Modal>
      )}
    </>
  );
}
