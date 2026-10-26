/** Searchable knowledge library and a live, local-first learning overview. */
import { useMemo } from "react";
import Fuse from "fuse.js";
import {
  ArrowUpRight,
  BookOpen,
  Clock3,
  Layers3,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import { useKnowledge, useT, Empty } from "../components/common";
import { KnowledgeTable } from "../components/library/KnowledgeTable";
import { store } from "../core/store";
/** Display library results with fuzzy search, category filters and deterministic sorting. */
export function Library({
  onOpen,
  onCreate,
  query = "",
  dashboard = false,
  onReview,
}: {
  onOpen: (id: string) => void;
  onCreate: () => void;
  query?: string;
  dashboard?: boolean;
  onReview: () => void;
}) {
  const s = useKnowledge(),
    t = useT();
  const due = s.entries.filter((e) => e.card.due <= new Date());
  const results = useMemo(() => {
    let rows = query.trim()
      ? new Fuse(s.entries, {
          keys: [{ name: "title", weight: 3 }, "tags", "content", "summary"],
          threshold: 0.35,
          ignoreLocation: true,
        })
          .search(query)
          .map((r) => r.item)
      : [...s.entries];
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [s.entries, query]);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR SECOND BRAIN</div>
          <h1>
            {dashboard
              ? t("让知识，真正属于你。", "Make knowledge your own.")
              : t("我的知识库", "Your knowledge library")}
          </h1>
          <p>
            {dashboard
              ? t(
                  "记录每一次好奇，让理解在连接中生长。",
                  "Capture your curiosity. Build understanding through connections.",
                )
              : t(
                  "每一个被理解的概念，都是思维的一块拼图。",
                  "Every concept understood is another piece of the puzzle.",
                )}
          </p>
        </div>
        <button className="primary" onClick={onCreate}>
          <Plus size={17} />
          {t("新建词条", "New entry")}
        </button>
      </div>
      {dashboard && (
        <>
          <div className="stats">
            <div>
              <span className="stat-icon violet">
                <BookOpen size={21} />
              </span>
              <div>
                <small>{t("知识条目", "Knowledge entries")}</small>
                <strong>
                  {s.entries.length}
                  <em>{t("个概念", "concepts")}</em>
                </strong>
              </div>
            </div>
            <div>
              <span className="stat-icon amber">
                <Clock3 size={21} />
              </span>
              <div>
                <small>{t("等待复习", "Ready to review")}</small>
                <strong>
                  {due.length}
                  <em>{t("个待巩固", "due concepts")}</em>
                </strong>
              </div>
            </div>
            <div>
              <span className="stat-icon teal">
                <Layers3 size={21} />
              </span>
              <div>
                <small>{t("知识分类", "Knowledge categories")}</small>
                <strong>
                  {s.categories.length}
                  <em>{t("个领域", "categories")}</em>
                </strong>
              </div>
            </div>
            <div>
              <span className="stat-icon rose">
                <Target size={21} />
              </span>
              <div>
                <small>{t("已完成复习", "Reviews completed")}</small>
                <strong>
                  {s.reviews.filter((r) => r.phase === "done").length}
                  <em>{t("次练习", "sessions")}</em>
                </strong>
              </div>
            </div>
          </div>
          <section className="review-banner">
            <div className="orb">
              <Sparkles size={28} />
            </div>
            <div>
              <span className="eyebrow">A LITTLE EVERY DAY</span>
              <h2>
                {due.length
                  ? t("趁记忆还温热，再见一面。", "A good moment to remember.")
                  : t(
                      "给理解一点时间，给记忆一点空间。",
                      "Give understanding time to grow.",
                    )}
              </h2>
              <p>
                {t(
                  `今天有 ${due.length} 个概念等你唤醒。主动回忆，让知识留得更久。`,
                  `${due.length} concepts are ready. A little active recall goes a long way.`,
                )}
              </p>
            </div>
            <button onClick={onReview}>
              {t("开始复习", "Start reviewing")}
              <ArrowUpRight size={18} />
            </button>
          </section>
        </>
      )}
      <div className="section-heading">
        <div>
          <h2>
            {dashboard
              ? t("最近的知识", "Recent knowledge")
              : t("全部词条", "All entries")}
            <span className="count">{results.length}</span>
          </h2>
        </div>
      </div>
      {results.length ? (
        <KnowledgeTable
          entries={dashboard ? results.slice(0, 6) : results}
          categories={s.categories}
          onOpen={onOpen}
          compact={dashboard}
        />
      ) : (
        <Empty
          title={
            query
              ? t("没有匹配的词条", "No matching entries")
              : t("从一个好奇的问题开始", "Begin with a curious question")
          }
          description={t(
            "添加自己的知识，或载入三个示例，体验解释、公式和关系图。",
            "Add your knowledge, or explore three sample entries with formulas and diagrams.",
          )}
        >
          <button className="primary" onClick={onCreate}>
            <Plus size={16} />
            {t("创建词条", "Create entry")}
          </button>
          {!s.entries.length && (
            <button onClick={() => void store.seed()}>
              {t("载入示例", "Explore examples")}
            </button>
          )}
        </Empty>
      )}
      <div className="page-note">
        <span className="status-dot" />
        {t(
          "保存在本机 · 离线也能保持好奇",
          "Stored on this device · Stay curious, even offline",
        )}
      </div>
    </div>
  );
}
