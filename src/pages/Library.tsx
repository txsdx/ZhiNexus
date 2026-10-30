/** Searchable knowledge library and a live, local-first learning overview. */
import { needsReview, reviewTarget } from "../core/review-policy";
import { useReviewClock } from "../hooks/useReviewClock";
import { useMemo } from "react";
import { searchKnowledge } from "../core/knowledge-search";
import { StudyActivity } from "../components/StudyActivity";
import { ReviewForecast } from "../components/ReviewForecast";
import {
  importanceLevel,
  importanceLevels,
  importanceLabels,
  type ImportanceLevel,
} from "../core/importance";
import { useState } from "react";
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
  const now = useReviewClock();
  const due = s.entries.filter((e) =>
    needsReview(e, reviewTarget(s.docs), now),
  );
  const [starredOnly, setStarredOnly] = useState(false),
    [levelFilter, setLevelFilter] = useState<ImportanceLevel | "all">("all"),
    [searchHelp, setSearchHelp] = useState(false);
  const results = useMemo(
    () =>
      searchKnowledge(
        s.entries.filter(
          (entry) =>
            (!starredOnly || entry.starred) &&
            (dashboard ||
              levelFilter === "all" ||
              importanceLevel(entry) === levelFilter),
        ),
        s.categories,
        query,
        reviewTarget(s.docs),
        now,
      ),
    [
      s.entries,
      s.categories,
      query,
      starredOnly,
      levelFilter,
      dashboard,
      now,
      s.docs,
    ],
  );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>
            {dashboard
              ? t("学习概览", "Overview")
              : t("我的知识库", "Your knowledge library")}
          </h1>
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
              <h2>{t("复习队列", "Review queue")}</h2>
              <p>
                {t(`${due.length} 个待复习词条`, `${due.length} entries due`)}
              </p>
            </div>
            <button onClick={onReview}>
              {t("开始复习", "Start reviewing")}
              <ArrowUpRight size={18} />
            </button>
          </section>
        </>
      )}
      {!dashboard && (
        <div className="library-filters">
          <label className="library-level-filter">
            {t("重要等级", "Importance")}
            <select
              aria-label={t("筛选重要等级", "Filter by importance")}
              value={levelFilter}
              onChange={(event) =>
                setLevelFilter(event.target.value as typeof levelFilter)
              }
            >
              <option value="all">{t("全部等级", "All levels")}</option>
              {importanceLevels.map((level) => (
                <option key={level} value={level}>
                  {t(...importanceLabels[level])} (
                  {
                    s.entries.filter(
                      (entry) => importanceLevel(entry) === level,
                    ).length
                  }
                  )
                </option>
              ))}
            </select>
          </label>
          <button
            aria-pressed={starredOnly}
            onClick={() => setStarredOnly((value) => !value)}
          >
            {t("收藏", "Starred")}
          </button>
          <button
            aria-expanded={searchHelp}
            onClick={() => setSearchHelp((value) => !value)}
          >
            {t("检索语法", "Search filters")}
          </button>
        </div>
      )}
      {searchHelp && !dashboard && (
        <p className="notice">
          {t(
            "支持 tag:标签、category:分类、title:标题、body:正文、importance:high/normal/low、is:due、is:starred、has:image、has:link；双引号精确短语，-词语排除。",
            "Filters: tag:, category:, title:, body:, importance:high/normal/low, is:due, is:starred, has:image, has:link. Quotes match phrases; -term excludes.",
          )}
        </p>
      )}
      {dashboard && (
        <>
          <ReviewForecast onOpen={onOpen} />
          <StudyActivity onOpen={onOpen} />
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
          searchOrder={!!query.trim() || starredOnly}
        />
      ) : (
        <Empty
          title={
            starredOnly
              ? t("暂无匹配的收藏", "No matching starred entries")
              : query
                ? t("没有匹配的词条", "No matching entries")
                : t("暂无词条", "No entries")
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
    </div>
  );
}
