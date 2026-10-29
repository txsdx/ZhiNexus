import { CategoryPicker } from "../CategoryPicker";
import { useConfirmation } from "../../hooks/useConfirmation";
import {
  entrySelectionSnapshot,
  changeEntrySelection,
} from "../../services/entry-selection";
import { useKnowledge } from "../common";
import { reviewTarget, nextReviewAt } from "../../core/review-policy";
/** Dense, keyboard-accessible taxonomy table with real memory estimates and per-column sorting. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { Entry, Category } from "../../core/types";
import {
  entrySummary,
  knowledgeTree,
  memoryColor,
  memoryEstimate,
  type KnowledgeBranch,
} from "../../core/knowledge-view";
import { useT } from "../common";
import "./library.css";
/** Show title, one-line explanation, creation/review times and the FSRS forgetting gradient in one row. */
export function KnowledgeTable({
  entries,
  categories,
  onOpen,
  compact = false,
  searchOrder = false,
}: {
  entries: Entry[];
  categories: Category[];
  onOpen: (id: string) => void;
  compact?: boolean;
  searchOrder?: boolean;
}) {
  const [selecting, setSelecting] = useState(false),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [selectionError, setSelectionError] = useState(""),
    [changing, setChanging] = useState(false);
  const deletion = useConfirmation(setSelectionError);
  const selected = selectedIds.filter((id) =>
    entries.some((entry) => entry.id === id),
  );
  const moveBaseline = useMemo(
    () => entrySelectionSnapshot(selected),
    [selected.join("\0")],
  );
  useEffect(() => {
    setSelectedIds((ids) =>
      ids.filter((id) => entries.some((entry) => entry.id === id)),
    );
  }, [entries]);
  const targetRetention = reviewTarget(useKnowledge().docs);
  const scroller = useRef<HTMLDivElement>(null),
    [horizontalOverflow, setHorizontalOverflow] = useState(false);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () =>
      setHorizontalOverflow(node.scrollWidth > node.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, []);
  const t = useT(),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [chosenSort, setSort] = useState<string | null>(null),
    [ascending, setAscending] = useState(true),
    [now, setNow] = useState(() => new Date());
  const sort = chosenSort ?? (searchOrder ? "relevance" : "review");
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const retention = useMemo(
    () => new Map(entries.map((e) => [e.id, memoryEstimate(e, now)])),
    [entries, now],
  );
  /** Sort inside each branch, keeping the taxonomy hierarchy intact. */
  const order = (rows: Entry[]) =>
    sort === "relevance"
      ? rows
      : [...rows].sort((a, b) => {
          let diff =
            sort === "title"
              ? a.title.localeCompare(b.title)
              : sort === "created"
                ? a.createdAt.localeCompare(b.createdAt)
                : sort === "review"
                  ? nextReviewAt(a, targetRetention).getTime() -
                    nextReviewAt(b, targetRetention).getTime()
                  : sort === "memory"
                    ? 1 -
                      (retention.get(a.id) ?? 2) -
                      (1 - (retention.get(b.id) ?? 2))
                    : a.updatedAt.localeCompare(b.updatedAt);
          return (ascending ? diff : -diff) || a.title.localeCompare(b.title);
        });
  /** Keep dates compact while showing the actual local review and creation times. */
  const date = (value: Date | string | undefined) =>
    value ? (
      <time
        dateTime={new Date(value).toISOString()}
        title={new Date(value).toLocaleString()}
      >
        {new Date(value).toLocaleString(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })}
      </time>
    ) : (
      <span className="muted">{t("尚未复习", "Not reviewed")}</span>
    );
  /** Both the title and explicit estimate show memory severity without coloring the whole table. */
  const entryRow = (e: Entry, depth: number) => {
    const r = retention.get(e.id) ?? null;
    return (
      <tr
        key={e.id}
        className="entry-row"
        data-entry-id={e.id}
        data-entry-color={e.color ?? "none"}
        role="row"
        aria-level={depth + 1}
        tabIndex={0}
        onClick={() => onOpen(e.id)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            event.target === event.currentTarget &&
            !event.nativeEvent.isComposing &&
            !event.repeat
          ) {
            event.preventDefault();
            onOpen(e.id);
          }
        }}
      >
        <td
          className="entry-title-cell"
          style={{ paddingInlineStart: 16 + depth * 18 }}
        >
          <div className="entry-select-title">
            {!compact && selecting && (
              <input
                type="checkbox"
                aria-label={t("选择 ", "Select ") + e.title}
                checked={selected.includes(e.id)}
                disabled={changing}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) =>
                  setSelectedIds((ids) =>
                    event.target.checked
                      ? [...ids, e.id]
                      : ids.filter((id) => id !== e.id),
                  )
                }
              />
            )}
            <button
              onClick={(event) => {
                event.stopPropagation();
                onOpen(e.id);
              }}
            >
              {e.title}
            </button>
          </div>
        </td>
        <td className="entry-summary-cell" title={entrySummary(e)}>
          {entrySummary(e) || (
            <span className="muted">{t("待补充解释", "Add a summary")}</span>
          )}
        </td>
        <td className="entry-created-cell">{date(e.createdAt)}</td>
        <td
          className="next-review-cell"
          style={{ color: memoryColor(r) }}
          title={nextReviewAt(e, targetRetention).toLocaleString()}
          data-retention={r ?? "unknown"}
        >
          <strong>
            {(() => {
              const difference =
                (nextReviewAt(e, targetRetention).getTime() - now.getTime()) /
                86400000;
              const value = Math.round(difference * 100) / 100;
              return difference < 0 && value === 0 ? -0.01 : value;
            })()}{" "}
            {t("天", "days")}
          </strong>
        </td>
      </tr>
    );
  };
  /** Collapse hides descendants visually without excluding them from recursive counts. */
  const branchRows = (branch: KnowledgeBranch, depth: number): ReactNode => {
    const closed = collapsed.has(branch.id);
    return [
      <tr
        className="category-row"
        data-category-id={branch.id}
        key={"category-" + branch.id}
        role="row"
        aria-level={depth + 1}
        aria-expanded={!closed}
      >
        <td colSpan={4}>
          <button
            style={{ paddingInlineStart: 10 + depth * 18 }}
            onClick={() =>
              setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(branch.id)) next.delete(branch.id);
                else next.add(branch.id);
                return next;
              })
            }
            aria-expanded={!closed}
          >
            {closed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}{" "}
            {closed ? <Folder size={16} /> : <FolderOpen size={16} />}
            {branch.name || t("未分类", "Uncategorized")}{" "}
            <span className="count">{branch.count}</span>
          </button>
        </td>
      </tr>,
      ...(!closed
        ? [
            ...order(branch.entries).map((e) => entryRow(e, depth + 1)),
            ...branch.children.map((c) => branchRows(c, depth + 1)),
          ]
        : []),
    ];
  };
  /** Keyboard-accessible headers toggle stable per-branch sorting. */
  const header = (key: string, label: string) => (
    <button
      onClick={() => {
        if (sort === key) setAscending(!ascending);
        else {
          setSort(key);
          setAscending(key === "title");
        }
      }}
    >
      {label}
      {sort === key ? (ascending ? " ↑" : " ↓") : ""}
    </button>
  );
  return (
    <section className="knowledge-table-section">
      <div className="knowledge-table-tools">
        <span>
          {t(`${entries.length} 个词条`, `${entries.length} entries`)}
        </span>
        {!compact && (
          <>
            <button
              disabled={changing}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((value) => !value);
                setSelectedIds([]);
              }}
            >
              {t(
                selecting ? "退出选择" : "选择词条",
                selecting ? "Exit selection" : "Select entries",
              )}
            </button>
            <button onClick={() => setCollapsed(new Set())}>
              {t("展开全部", "Expand all")}
            </button>
            <button
              onClick={() =>
                setCollapsed(
                  new Set([
                    ...categories.map((c) => c.id),
                    "__uncategorized__",
                  ]),
                )
              }
            >
              {t("折叠全部", "Collapse all")}
            </button>
          </>
        )}
        <label className="memory-legend">
          <span />
          {t("遗忘程度：黑 → 黄 → 红", "Forgetting: black → yellow → red")}
        </label>
      </div>
      {!compact && selecting && (
        <div className="knowledge-selection-bar">
          <label className="toggle">
            <input
              type="checkbox"
              disabled={changing || !entries.length}
              checked={entries.length > 0 && selected.length === entries.length}
              onChange={(event) =>
                setSelectedIds(
                  event.target.checked ? entries.map((entry) => entry.id) : [],
                )
              }
            />
            {t("全选当前结果", "Select all results")} ({selected.length}/
            {entries.length})
          </label>
          {selected.length > 0 && (
            <>
              <span>{t("批量移动到", "Move selected to")}</span>
              <CategoryPicker
                value=""
                disabled={changing}
                onChange={async (category) => {
                  const ids = [...selected],
                    before = moveBaseline;
                  setChanging(true);
                  try {
                    await changeEntrySelection(ids, before, { category });
                    setSelectedIds([]);
                  } finally {
                    setChanging(false);
                  }
                }}
              />
              <button
                className="danger"
                disabled={changing}
                onClick={() => {
                  const ids = [...selected],
                    before = entrySelectionSnapshot(ids);
                  void deletion.request(
                    t(
                      `删除选中的 ${ids.length} 个词条？可从回收站恢复。`,
                      `Delete ${ids.length} selected entries? They can be restored from Trash.`,
                    ),
                    async () => {
                      setChanging(true);
                      try {
                        await changeEntrySelection(ids, before, {
                          deleted: true,
                        });
                        setSelectedIds([]);
                      } finally {
                        setChanging(false);
                      }
                    },
                  );
                }}
              >
                {t("删除所选", "Delete selected")}
              </button>
            </>
          )}
        </div>
      )}
      {selectionError && (
        <p role="alert" className="warning">
          {selectionError}
        </p>
      )}
      {deletion.dialog}
      <div
        ref={scroller}
        className={
          "knowledge-table-scroll" +
          (horizontalOverflow ? " horizontal-overflow" : "")
        }
      >
        <table
          role="treegrid"
          aria-label={t("分类知识树", "Knowledge taxonomy")}
          className="knowledge-table"
        >
          <thead>
            <tr>
              <th>{header("title", t("条目标题", "Title"))}</th>
              <th>{t("一句话解释", "One-line explanation")}</th>
              <th>{header("created", t("创建时间", "Created"))}</th>
              <th>{header("review", t("下次复习", "Next review"))}</th>
            </tr>
          </thead>
          <tbody>
            {compact
              ? order(entries).map((e) => entryRow(e, 0))
              : knowledgeTree(categories, entries).map((c) => branchRows(c, 0))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
