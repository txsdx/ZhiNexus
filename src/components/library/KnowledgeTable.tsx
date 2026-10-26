/** Dense, keyboard-accessible taxonomy table with real memory estimates and per-column sorting. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
}: {
  entries: Entry[];
  categories: Category[];
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  const t = useT(),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [sort, setSort] = useState("memory"),
    [ascending, setAscending] = useState(false),
    [now, setNow] = useState(() => new Date());
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
    [...rows].sort((a, b) => {
      let diff =
        sort === "title"
          ? a.title.localeCompare(b.title)
          : sort === "created"
            ? a.createdAt.localeCompare(b.createdAt)
            : sort === "review"
              ? (a.card.last_review?.getTime() ?? 0) -
                (b.card.last_review?.getTime() ?? 0)
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
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
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
        role="row"
        aria-level={depth + 1}
        tabIndex={0}
        onClick={() => onOpen(e.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onOpen(e.id);
          }
        }}
      >
        <td
          className="entry-title-cell"
          style={{ paddingInlineStart: 16 + depth * 18 }}
        >
          <button
            style={{ color: memoryColor(r) }}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(e.id);
            }}
          >
            {e.title}
          </button>
        </td>
        <td className="entry-summary-cell" title={entrySummary(e)}>
          {entrySummary(e) || (
            <span className="muted">{t("待补充解释", "Add a summary")}</span>
          )}
        </td>
        <td>{date(e.createdAt)}</td>
        <td>{date(e.card.last_review)}</td>
        <td
          className="memory-cell"
          style={{ color: memoryColor(r) }}
          title={
            r === null
              ? t(
                  "首次复习后才有可靠的记忆估计",
                  "Recall can be estimated after the first review",
                )
              : t(
                  `FSRS 预计记得 ${(r * 100).toFixed(1)}%，遗忘 ${((1 - r) * 100).toFixed(1)}%`,
                  `FSRS estimated recall ${(r * 100).toFixed(1)}%, forgotten ${((1 - r) * 100).toFixed(1)}%`,
                )
          }
          data-retention={r ?? "unknown"}
        >
          <span className="memory-dot" />
          {r === null
            ? t("待首次复习", "First review due")
            : t(
                `遗忘 ${Math.round((1 - r) * 100)}%`,
                `${Math.round((1 - r) * 100)}% forgotten`,
              )}
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
        key={"category-" + branch.id}
        role="row"
        aria-level={depth + 1}
        aria-expanded={!closed}
      >
        <td colSpan={5}>
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
          {t("遗忘程度：黑 → 红 → 紫", "Forgetting: neutral → red → purple")}
        </label>
      </div>
      <div className="knowledge-table-scroll">
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
              <th>{header("review", t("上次复习", "Last review"))}</th>
              <th>{header("memory", t("记忆状态", "Memory"))}</th>
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
