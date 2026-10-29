/** Global task streams, durable proposal reviews and reviewable external-tool approvals. */
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, RefreshCw, Square, X } from "lucide-react";
import { aiJobs } from "../services/ai-jobs";
import { aiJobIsStale, applyAIJob } from "../services/ai-apply";
import type { AIJob, AITarget } from "../core/ai-jobs";
import { useKnowledge, useT, Modal, Busy } from "./common";
import { Markdown, AssetImage } from "./Markdown";
import { CategoryTree } from "../pages/settings/shared";
import { useConfirmation } from "../hooks/useConfirmation";
import type { Json } from "../core/types";
import { entryWorkspace } from "../core/workspace";
import { useAIJobs } from "../hooks/useAIJobs";
import { graphEdges, type GraphRelation } from "../services/knowledge-graph";
export { useAIJobs } from "../hooks/useAIJobs";
/** Human states are separate from raw model IDs and provider protocol details. */
function useStateLabel() {
  const t = useT();
  return {
    queued: t("排队中", "Queued"),
    running: t("正在生成", "Generating"),
    approval: t("等待操作确认", "Awaiting approval"),
    review: t("待审阅", "Ready for review"),
    error: t("失败，结果保留", "Failed; output retained"),
    cancelled: t("已停止", "Stopped"),
  };
}
/** Show genuine received deltas; reasoning and tool arguments remain distinct from the answer. */
export function AIJobStream({ job }: { job: AIJob }) {
  const t = useT();
  const tasks = {
    explain: t("生成详解", "Explanation"),
    relations: t("分析关联", "Relationships"),
    graph: t("分析星图关系", "Graph relationships"),
    classify: t("整理分类", "Classification"),
    agent: t("AI 对话", "AI chat"),
    question: t("生成题目", "Question"),
    grade: t("评阅答案", "Answer grading"),
    ocr: t("识别截图", "Screenshot recognition"),
    image: t("生成配图", "Image generation"),
  };
  return (
    <div className="ai-job-stream">
      {job.stages.map((stage, index) => (
        <section key={index} className="ai-job-stage">
          <div className="tags">
            <span>{tasks[stage.task]}</span>
            {stage.model && <span>{stage.model}</span>}
            {!stage.streaming && (
              <span>{t("完整响应模式", "Full response")}</span>
            )}
          </div>
          {stage.reasoning && (
            <details>
              <summary>{t("思考内容", "Reasoning")}</summary>
              <pre>{stage.reasoning}</pre>
            </details>
          )}
          {stage.content && (
            <pre className="ai-stream-content">{stage.content}</pre>
          )}
          {!!stage.calls.length && (
            <details>
              <summary>{t("工具调用", "Tool calls")}</summary>
              <pre>{JSON.stringify(stage.calls, null, 2)}</pre>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
/** Device-local FIFO task center with links into the entry, conversation, review or settings page. */
export function AITaskCenter({
  onOpen,
  notify,
}: {
  onOpen: (job: AIJob) => void;
  notify: (text: string) => void;
}) {
  const state = useAIJobs(),
    labels = useStateLabel(),
    t = useT();
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const matches = (job: AIJob) =>
    (filter === "all" || job.state === filter) &&
    [job.title, job.error, job.target.entryId]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase().trim());
  const visible = state.jobs.filter(matches);
  const confirmation = useConfirmation(notify, {
    title: t("确认移除任务", "Confirm task removal"),
    confirmLabel: t("移除任务", "Remove task"),
  });
  const action = (work: () => Promise<unknown>) =>
    void work().catch((error) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
  return (
    <div className="page ai-task-center">
      <div className="page-heading">
        <div>
          <h1>{t("AI 任务队列", "AI task queue")}</h1>
          <p>
            {t(
              "实时查看生成内容，打开相关页面审阅；确认应用后任务会移出队列。",
              "Watch output live, review it at its destination, then apply to clear the task.",
            )}
          </p>
        </div>
        <span className="pill">
          {state.jobs.length} {t("项任务", "tasks")}
        </span>
      </div>
      {state.storageError && (
        <div className="warning" role="alert">
          {state.storageError}
          <button
            disabled={state.readOnly}
            onClick={() => action(() => aiJobs.flush())}
          >
            {t("重试保存队列", "Retry queue save")}
          </button>
        </div>
      )}
      <p>
        {t("本设备 AI 并发上限", "AI concurrency on this device")}:{" "}
        {aiJobs.limiter.counts.limit}
      </p>
      <div className="task-filters">
        <input
          type="search"
          aria-label={t("搜索任务", "Search tasks")}
          placeholder={t("搜索任务…", "Search tasks…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label={t("任务状态", "Task status")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">
            {t("全部", "All")} ({state.jobs.length})
          </option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label} ({state.jobs.filter((job) => job.state === value).length})
            </option>
          ))}
        </select>
        <span role="status">
          {visible.length}/{state.jobs.length}
        </span>
      </div>
      {state.jobs.length > 0 && !visible.length && (
        <p>{t("没有匹配任务", "No matching tasks")}</p>
      )}
      {!state.jobs.length && (
        <p>{t("暂无待处理任务。", "No pending tasks.")}</p>
      )}
      <div className="ai-job-list">
        {visible.map((job) => (
          <article
            className="ai-job-card"
            data-ai-job={job.id}
            data-job-state={job.state}
            key={job.id}
          >
            <div className="section-heading">
              <button className="ai-job-link" onClick={() => onOpen(job)}>
                <strong>{job.title}</strong>
                <ArrowUpRight size={17} />
              </button>
              <span className={"pill " + job.state}>{labels[job.state]}</span>
            </div>
            <time>{new Date(job.createdAt).toLocaleString()}</time>
            <AIJobStream job={job} />
            {job.error && (
              <p className="warning" role="alert">
                {job.error}
              </p>
            )}
            <div className="actions">
              <button onClick={() => onOpen(job)}>
                {t("打开相关页面并审阅", "Open destination and review")}
              </button>
              {["queued", "running", "approval"].includes(job.state) && (
                <button
                  disabled={state.readOnly}
                  onClick={() => action(() => aiJobs.cancel(job.id))}
                >
                  <Square size={15} />
                  {t("停止任务", "Stop task")}
                </button>
              )}
              {["error", "cancelled"].includes(job.state) && (
                <button
                  disabled={state.readOnly}
                  onClick={() => action(() => aiJobs.retry(job.id))}
                >
                  <RefreshCw size={15} />
                  {t("重试", "Retry")}
                </button>
              )}
              <button
                className="icon danger"
                disabled={state.readOnly}
                aria-label={t("移除任务", "Remove task")}
                onClick={() =>
                  void confirmation.request(
                    t(
                      "移除此任务及未应用结果？已保存的知识不会被删除。",
                      "Remove this task and its unapplied result? Saved knowledge remains.",
                    ),
                    async () => {
                      if (["queued", "running", "approval"].includes(job.state))
                        await aiJobs.cancel(job.id);
                      await aiJobs.remove(job.id);
                    },
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {confirmation.dialog}
    </div>
  );
}
/** Shared review dialog survives navigation and leaves closed proposals in the queue. */
export function AIJobReview({
  id,
  onClose,
  onNavigate,
  notify,
}: {
  id: string;
  onClose: () => void;
  onNavigate: (target: AITarget) => void;
  notify: (text: string) => void;
}) {
  const state = useAIJobs(),
    s = useKnowledge(),
    t = useT(),
    labels = useStateLabel();
  const closeGeneration = useRef(0),
    closing = useRef(false);
  useEffect(() => {
    closeGeneration.current++;
    closing.current = false;
    setBusy(false);
    return () => {
      closeGeneration.current++;
    };
  }, [id]);
  const job = state.jobs.find((j) => j.id === id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [force, setForce] = useState(false);
  useEffect(() => {
    setForce(false);
    setError("");
  }, [id, s.revision]);
  if (!job) return null;
  const value = (job.reviewData ?? job.result) as
    Record<string, Json> | undefined;
  const alreadyApplied =
    (job.kind === "image" &&
      entryWorkspace.getSnapshot().aiApplied.includes(job.id)) ||
    s.docs.some(
      (d) =>
        d.collection === "setting" &&
        d.id === "ai-applied-" + job.id &&
        d.fields.status === "applied",
    );
  const stale = !alreadyApplied && job.state === "review" && aiJobIsStale(job);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const close = (after?: () => void) => {
    if (closing.current || busy) return;
    const generation = closeGeneration.current;
    closing.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        if (!state.readOnly) await aiJobs.flush();
        // A completed save may only close the view that requested it, never a newer review.
        if (generation === closeGeneration.current) {
          onClose();
          after?.();
        }
      } catch (error) {
        if (generation === closeGeneration.current)
          setError(
            t(
              "AI任务保存失败，输入已保留，请重试关闭：",
              "AI task save failed; input retained. Retry closing: ",
            ) + String(error instanceof Error ? error.message : error),
          );
      } finally {
        if (generation === closeGeneration.current) {
          closing.current = false;
          setBusy(false);
        }
      }
    })();
  };
  const edit = (key: string, value: Json) => {
    const current = aiJobs.find(id);
    aiJobs.editReview(id, {
      ...((current.reviewData ?? current.result) as Record<string, Json>),
      [key]: value,
    });
  };
  const classification =
    !alreadyApplied && job.kind === "classification" && job.state === "review"
      ? (value as unknown as {
          categories: typeof s.categories;
          assignments: { entryId: string; category: string }[];
        })
      : undefined;
  const current = s.entries.find((e) => e.id === job.target.entryId);
  const graphRows =
    job.kind === "graph"
      ? ((job.result as { relations?: GraphRelation[] })?.relations ?? [])
      : [];
  const selectedRelations = new Set(
    ((value?.relations ?? []) as GraphRelation[]).map((r) =>
      JSON.stringify([r.source, r.target, r.type]),
    ),
  );
  const reviewDestination = job.kind === "question" || job.kind === "grade";
  return (
    <Modal
      wide
      title={
        job.kind === "classification" && job.state === "review"
          ? t("确认知识分类变更", "Confirm taxonomy changes")
          : job.title
      }
      onClose={() => close()}
      onConfirm={
        job.state === "approval" && !state.readOnly && !busy
          ? () => void run(() => aiJobs.decide(id, true))
          : undefined
      }
    >
      <div className="ai-review-status">
        <span className="pill">{labels[job.state]}</span>
        <button
          onClick={() => {
            close(() => onNavigate(job.target));
          }}
        >
          <ArrowUpRight size={15} />
          {t("前往相关页面", "Go to destination")}
        </button>
      </div>
      {job.state !== "review" && <AIJobStream job={job} />}{" "}
      {["queued", "running"].includes(job.state) && (
        <div className="notice">
          <Busy label={labels[job.state]} />
          <button
            disabled={state.readOnly || busy}
            onClick={() => void run(() => aiJobs.cancel(id))}
          >
            {t("停止任务", "Stop task")}
          </button>
        </div>
      )}
      {job.state === "approval" && (
        <section className="ai-tool-approval">
          <h3>{t("确认 Agent 操作", "Confirm agent action")}</h3>
          <pre>{job.approval}</pre>
          <div className="actions">
            <button
              disabled={state.readOnly || busy}
              onClick={() => void run(() => aiJobs.decide(id, false))}
            >
              {t("拒绝", "Deny")}
            </button>
            <button
              className="primary"
              autoFocus
              data-confirm
              disabled={state.readOnly || busy}
              onClick={() => void run(() => aiJobs.decide(id, true))}
            >
              {t("允许本次", "Allow once")}
            </button>
          </div>
        </section>
      )}
      {job.error && (
        <p role="alert" className="warning">
          {job.error}
        </p>
      )}
      {["error", "cancelled"].includes(job.state) && (
        <button
          disabled={state.readOnly || busy}
          onClick={() => void run(() => aiJobs.retry(id))}
        >
          {t("重试任务", "Retry task")}
        </button>
      )}
      {job.state === "review" && (
        <fieldset
          className="ai-result-review"
          disabled={state.readOnly || busy}
        >
          {alreadyApplied ? (
            <p>
              {t(
                "结果已应用，清除任务即可；不会再次写入。",
                "Result already applied. Clear this task without applying it again.",
              )}
            </p>
          ) : classification ? (
            <>
              <div className="compare-trees">
                <section>
                  <h3>{t("变更前", "Before")}</h3>
                  <CategoryTree
                    categories={s.categories}
                    assignments={s.entries}
                  />
                </section>
                <section>
                  <h3>{t("变更后", "After")}</h3>
                  <CategoryTree
                    categories={[...s.categories, ...classification.categories]}
                    assignments={classification.assignments}
                  />
                </section>
              </div>
              <details>
                <summary>{t("逐条分配变化", "Entry-by-entry changes")}</summary>
                {classification.assignments.map((a) => (
                  <p key={a.entryId}>
                    {s.entries.find((e) => e.id === a.entryId)?.title} →{" "}
                    {
                      [...s.categories, ...classification.categories].find(
                        (c) => c.id === a.category,
                      )?.name
                    }
                  </p>
                ))}
              </details>
            </>
          ) : job.kind === "graph" ? (
            <section className="graph-proposal-review">
              <h3>
                {t("知识关系预览", "Relationship preview")} ·{" "}
                {selectedRelations.size}/{graphRows.length}
              </h3>
              <p>
                {t(
                  "依赖：起点是终点的前置知识；递进：基础到进阶。普通关联升级会单独标明，原有有向关系保留。",
                  "Prerequisite: source comes before target. Progression: basic to advanced. Upgrades of ordinary associations are marked; existing directed relationships are retained.",
                )}
              </p>
              {!graphRows.length && (
                <p>
                  {t(
                    "未发现需要新增或升级的关系。",
                    "No new relationships or upgrades were found.",
                  )}
                </p>
              )}
              {graphRows.map((r, index) => {
                const key = JSON.stringify([r.source, r.target, r.type]);
                const upgrade =
                  r.type !== "related" &&
                  graphEdges().some(
                    (e) =>
                      e.type === "related" &&
                      ((e.source === r.source && e.target === r.target) ||
                        (e.source === r.target && e.target === r.source)),
                  );
                return (
                  <label className="graph-proposal-item" key={key}>
                    <input
                      type="checkbox"
                      checked={selectedRelations.has(key)}
                      onChange={(e) => {
                        const next = new Set(selectedRelations);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        void run(async () =>
                          edit(
                            "relations",
                            graphRows.filter((row) =>
                              next.has(
                                JSON.stringify([
                                  row.source,
                                  row.target,
                                  row.type,
                                ]),
                              ),
                            ) as unknown as Json,
                          ),
                        );
                      }}
                      aria-label={
                        t("应用关系 ", "Apply relationship ") + (index + 1)
                      }
                    />
                    <span>
                      <strong>
                        {s.entries.find((e) => e.id === r.source)?.title ??
                          r.source}{" "}
                        {r.type === "related" ? "↔" : "→"}{" "}
                        {s.entries.find((e) => e.id === r.target)?.title ??
                          r.target}
                      </strong>
                      <small>
                        {upgrade
                          ? t("普通关联升级 → ", "Upgrade association → ")
                          : ""}
                        {r.type === "prerequisite"
                          ? t("依赖", "Prerequisite")
                          : r.type === "progression"
                            ? t("递进", "Progression")
                            : t("关联", "Related")}
                        {r.reason ? " · " + r.reason : ""}
                      </small>
                    </span>
                  </label>
                );
              })}
            </section>
          ) : job.kind === "ocr" ? (
            <>
              <AssetImage src={"asset:" + String(value?.imageHash)} />
              <label>
                {t("词条标题", "Entry title")}
                <input
                  value={String(value?.title ?? "")}
                  onChange={(e) => edit("title", e.target.value)}
                />
              </label>
              <label>
                {t("识别文字（可编辑）", "Recognized text (editable)")}
                <textarea
                  rows={10}
                  value={String(value?.text ?? "")}
                  onChange={(e) => edit("text", e.target.value)}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={value?.keepImage === true}
                  onChange={(e) => edit("keepImage", e.target.checked)}
                />
                {t("保留截图", "Keep screenshot")}
              </label>
            </>
          ) : job.kind === "image" ? (
            <>
              <AssetImage src={"asset:" + String(value?.hash)} />
              <p>
                {t(
                  "确认后插入当前词条的最新本机草稿；保存词条后参与同步。",
                  "Insert into the latest local entry draft; save the entry to synchronize it.",
                )}
              </p>
            </>
          ) : job.kind === "chat" ? (
            <AIJobStream job={job} />
          ) : reviewDestination ? (
            <>
              <AIJobStream job={job} />
              <p>
                {t(
                  "题目与评估已在复习页准备好。“记录结果并继续”后相关任务自动移出队列；也可取消本次复习。",
                  "Review at the destination. Saving the result or cancelling the session clears its related tasks.",
                )}
              </p>
            </>
          ) : (
            <>
              {typeof value?.content === "string" && (
                <>
                  <h3>{t("生成内容", "Generated content")}</h3>
                  <Markdown>{value.content}</Markdown>
                </>
              )}
              {Array.isArray(value?.prerequisites) && (
                <p>
                  {t("前置知识", "Prerequisites")}:{" "}
                  {value.prerequisites.map(String).join("、")}
                </p>
              )}
              {Array.isArray(value?.relatedIds) && (
                <p>
                  {t("关联条目", "Related entries")}:{" "}
                  {value.relatedIds
                    .map(
                      (id) =>
                        s.entries.find((e) => e.id === id)?.title ?? String(id),
                    )
                    .join("、")}
                </p>
              )}
              {typeof value?.category === "string" && (
                <p>
                  {t("所属分类", "Category")}:{" "}
                  {s.categories.find((c) => c.id === value.category)?.name ??
                    value.category}
                </p>
              )}
            </>
          )}
          {stale && (
            <div className="warning">
              <p>
                {t(
                  "生成后词条或分类已改变，请先比较当前内容。",
                  "The entry or taxonomy changed after generation. Compare the current content first.",
                )}
              </p>
              {current && (
                <details>
                  <summary>
                    {t("当前已保存内容", "Current saved content")}
                  </summary>
                  <Markdown>{current.content}</Markdown>
                </details>
              )}
              {job.kind === "graph" ? (
                <p>
                  {t(
                    "请重新生成分析，避免应用过时的星图建议。",
                    "Regenerate the graph analysis before applying it.",
                  )}
                </p>
              ) : (
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={force}
                    onChange={(e) => setForce(e.target.checked)}
                  />
                  {t(
                    "我已比较当前内容，确认应用该结果",
                    "I compared the current content and accept this result",
                  )}
                </label>
              )}
            </div>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy || (stale && (job.kind === "graph" || !force))}
              onClick={() =>
                void run(async () => {
                  const target = await applyAIJob(id, force);
                  onNavigate(target);
                  onClose();
                  if (!reviewDestination)
                    notify(
                      t("已确认，任务已移出队列", "Confirmed; task cleared"),
                    );
                })
              }
            >
              <Check size={16} />
              {alreadyApplied
                ? t("确认清除任务", "Confirm task cleanup")
                : reviewDestination
                  ? t("前往复习审阅", "Review at destination")
                  : job.kind === "chat" || job.kind === "title"
                    ? t("已阅并清除任务", "Reviewed; clear task")
                    : job.kind === "image"
                      ? t("确认插入草稿", "Insert into draft")
                      : t("确认并应用", "Confirm and apply")}
            </button>
          </div>
        </fieldset>
      )}
      {state.storageError && (
        <p role="alert" className="warning">
          {state.storageError}
        </p>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
    </Modal>
  );
}
