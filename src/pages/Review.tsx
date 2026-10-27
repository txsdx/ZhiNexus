/** Resumable AI review sessions with answer persistence, teaching feedback and FSRS commits. */
import { diagnostics } from "../services/diagnostics";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Sparkles,
  RefreshCw,
  X,
} from "lucide-react";
import { useKnowledge, useT, Busy, Empty } from "../components/common";
import { Markdown } from "../components/Markdown";
import type { Collection, Json } from "../core/types";
import { store, json } from "../core/store";
import { gradeSchema, questionSchema, schedule } from "../core/review";
import { runTask, parseJson } from "../services/ai";
import { useConfirmation } from "../hooks/useConfirmation";
/** Resume unfinished sessions before presenting the due queue; never auto-award a passing score. */
export function Review({ notify }: { notify: (s: string) => void }) {
  const s = useKnowledge(),
    t = useT(),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState("");
  const active = useRef<{
    controller: AbortController;
    cancellable: boolean;
  } | null>(null);
  const confirmation = useConfirmation(notify, {
    title: t("确认复习操作", "Confirm review action"),
    confirmLabel: t("确认", "Confirm"),
  });
  const cancellation = useConfirmation(notify, {
    title: t("确认复习操作", "Confirm review action"),
    confirmLabel: t("确认", "Confirm"),
  });
  useEffect(
    () => () => {
      active.current?.controller.abort();
      active.current = null;
    },
    [],
  );
  const unfinished = s.reviews.filter(
      (r) => r.phase !== "done" && r.phase !== "cancelled",
    ),
    session = unfinished.find((r) => r.id === selected) ?? unfinished[0],
    entry = s.entries.find((e) => e.id === session?.entryId),
    due = s.entries
      .filter((e) => e.card.due <= new Date())
      .sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
  /** Abort the request and invalidate late responses before returning control to the user. */
  const stop = () => {
    const task = active.current;
    if (!task?.cancellable) return;
    active.current = null;
    task.controller.abort();
    setBusy("");
  };
  const act = async (
    label: string,
    fn: (signal: AbortSignal) => Promise<void>,
    cancellable = true,
  ) => {
    if (active.current) return;
    const task = { controller: new AbortController(), cancellable };
    active.current = task;
    setBusy(label);
    try {
      await fn(task.controller.signal);
    } catch (e) {
      if (!task.controller.signal.aborted) {
        diagnostics.error("app", "复习操作失败 / Review action failed", e);
        notify(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (active.current === task) {
        active.current = null;
        setBusy("");
      }
    }
  };
  /** Reject answers and AI results after cancellation, replacement or completion of their original question. */
  const currentQuestion = (id: string, question: unknown) => {
    const current = store.getSnapshot().reviews.find((r) => r.id === id);
    return (
      current &&
      current.phase !== "done" &&
      current.phase !== "cancelled" &&
      JSON.stringify(current.question) === JSON.stringify(question)
    );
  };
  const start = async (id: string, signal: AbortSignal) => {
    const e = store.getSnapshot().entries.find((e) => e.id === id);
    if (!e) return;
    const existing = store
      .getSnapshot()
      .reviews.find(
        (r) =>
          r.entryId === id && r.phase !== "done" && r.phase !== "cancelled",
      );
    if (existing) {
      setSelected(existing.id);
      return;
    }
    const question = questionSchema.parse(
        parseJson(
          await runTask(
            "question",
            { title: e.title, content: e.content },
            signal,
          ),
        ),
      ),
      rid = crypto.randomUUID();
    const committed = await store.patchWhen(
      "review",
      rid,
      json({
        entryId: id,
        phase: "question",
        question,
        answer: "",
        grade: null,
        startedAt: new Date().toISOString(),
      }) as Record<string, Json>,
      "review",
      () =>
        !signal.aborted &&
        store.getSnapshot().entries.some((x) => x.id === id) &&
        !store
          .getSnapshot()
          .reviews.some(
            (r) =>
              r.entryId === id && r.phase !== "done" && r.phase !== "cancelled",
          ),
    );
    if (committed && !signal.aborted) setSelected(rid);
  };
  const regenerate = async (signal: AbortSignal) => {
    if (!session || !entry) return;
    const question = questionSchema.parse(
      parseJson(
        await runTask(
          "question",
          {
            title: entry.title,
            content:
              entry.content +
              "\n\n上一题（题目数据）：" +
              session.question.question +
              "\n请从不同角度生成另一道题，不重复上一题。",
          },
          signal,
        ),
      ),
    );
    if (question.question.trim() === session.question.question.trim())
      throw Error(
        t(
          "AI 返回了相同题目，请重试。原作答已保留。",
          "AI returned the same question. Retry; your answer was retained.",
        ),
      );
    await store.patchWhen(
      "review",
      session.id,
      { question: json(question), phase: "question", answer: "", grade: null },
      "review-new-question",
      () => !signal.aborted && !!currentQuestion(session.id, session.question),
    );
  };
  const cancel = () =>
    session &&
    cancellation.request(
      t(
        "结束本次复习？本次回答和评分不会计入复习次数，也不会修改词条或下次复习时间。",
        "End this session? Its answer and score will not affect your entry or review schedule.",
      ),
      async () => {
        stop();
        await act(
          t("取消复习…", "Cancelling review…"),
          async () => {
            const committed = await store.patchWhen(
              "review",
              session.id,
              { phase: "cancelled" },
              "review-cancel",
              () => !!currentQuestion(session.id, session.question),
            );
            if (committed) {
              setSelected("");
              notify(t("本次复习已取消", "Review cancelled"));
            }
          },
          false,
        );
      },
    );
  const newQuestion = () => {
    const generate = () =>
      act(t("正在重新出题…", "Preparing another question…"), regenerate);
    return session?.answer || session?.grade
      ? confirmation.request(
          t(
            "重新出题会清空本次回答和评分，复习次数保持不变。继续？",
            "Replace this question and clear its answer and score? Your review count stays the same.",
          ),
          async () => {
            void generate();
          },
        )
      : generate();
  };
  const saveAnswer = (answer: string) => {
    if (!session || busy) return;
    void store
      .patchWhen(
        "review",
        session.id,
        { answer, phase: "answer" },
        "review-answer",
        () =>
          !!currentQuestion(session.id, session.question) &&
          store.getSnapshot().reviews.find((r) => r.id === session.id)
            ?.phase !== "graded",
      )
      .catch((error) => {
        diagnostics.error("app", "复习作答保存失败", error);
        notify(String(error));
      });
  };
  const finish = async () => {
    if (!session?.grade || !entry) return;
    const patches: {
      collection: Collection;
      id: string;
      patch: Record<string, Json>;
    }[] = [
      {
        collection: "entry" as const,
        id: entry.id,
        patch: json({
          card: schedule(entry.card, session.grade.score),
          updatedAt: new Date().toISOString(),
        }) as Record<string, import("../core/types").Json>,
      },
      {
        collection: "review" as const,
        id: session.id,
        patch: { phase: "done" },
      },
    ];
    if (session.grade.missing.trim())
      patches[0].patch.content =
        entry.content +
        "\n\n## 复习补充 · " +
        new Date().toLocaleDateString() +
        "\n\n" +
        session.grade.missing +
        "\n\n" +
        session.grade.lesson;
    const committed = await store.batchWhen(
      patches,
      "review-assessment",
      () => {
        const current = store.getSnapshot(),
          r = current.reviews.find((r) => r.id === session.id),
          e = current.entries.find((e) => e.id === entry.id);
        return (
          r?.phase === "graded" &&
          JSON.stringify(r.grade) === JSON.stringify(session.grade) &&
          JSON.stringify(e?.card) === JSON.stringify(entry.card) &&
          e?.content === entry.content &&
          JSON.stringify(r.question) === JSON.stringify(session.question)
        );
      },
    );
    if (!committed)
      throw Error(
        t(
          "复习状态已更新，请检查当前结果后重试。",
          "Review state changed. Check the current result and retry.",
        ),
      );
    setSelected("");
    notify(
      t(
        "复习已记录，已更新下次复习时间",
        "Review saved; next session scheduled",
      ),
    );
  };
  return (
    <div className="page">
      {confirmation.dialog}
      {cancellation.dialog}
      <div className="page-heading">
        <div>
          <div className="eyebrow">REMEMBER WITH UNDERSTANDING</div>
          <h1>{t("今日复习", "Your review space")}</h1>
          <p>
            {t(
              "不是再读一遍，而是试着从记忆中找回。",
              "Don’t just read it again. Try bringing it back from memory.",
            )}
          </p>
        </div>
        <span className="pill">
          <Clock3 size={15} />
          {due.length} {t("个待复习", "due")}
        </span>
      </div>
      {busy && (
        <div className="notice">
          <Busy label={busy} />
          {active.current?.cancellable && (
            <button onClick={stop}>{t("停止本次请求", "Stop request")}</button>
          )}
        </div>
      )}
      {session && entry ? (
        <section className="review-workspace">
          <div className="section-heading">
            <span className="category-dot">{entry.title}</span>
            <small className="muted">
              {t(
                "上下文自动保存 · 由 AI 出题和评估",
                "Context saved automatically · AI assessment",
              )}
            </small>
          </div>
          <div className="actions">
            <button disabled={!!busy} onClick={() => void newQuestion()}>
              <RefreshCw size={16} />
              {t("重新出题", "New question")}
            </button>
            <button
              disabled={!!busy && !active.current?.cancellable}
              onClick={() => void cancel()}
            >
              <X size={16} />
              {t("取消本次复习", "Cancel review")}
            </button>
          </div>
          <h2>{session.question.question}</h2>
          {session.question.type === "choice" ? (
            <div className="choices">
              {session.question.choices.map((c, i) => (
                <button
                  disabled={!!busy || session.phase === "graded"}
                  className={session.answer === c ? "selected" : ""}
                  key={i}
                  onClick={() => saveAnswer(c)}
                >
                  <span>{String.fromCharCode(65 + i)}</span>
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              rows={6}
              placeholder={t(
                "用自己的话解释，尝试举一个例子…",
                "Explain in your own words. Try an example…",
              )}
              value={session.answer}
              disabled={!!busy || session.phase === "graded"}
              onChange={(e) => saveAnswer(e.target.value)}
            />
          )}{" "}
          {session.phase !== "graded" ? (
            <button
              className="primary"
              disabled={!!busy || !session.answer.trim()}
              onClick={() =>
                void act(
                  t("评估理解并整理薄弱点…", "Assessing your understanding…"),
                  async (signal) => {
                    const grade = gradeSchema.parse(
                      parseJson(
                        await runTask(
                          "grade",
                          {
                            title: entry.title,
                            content: entry.content,
                            question: JSON.stringify(session.question),
                            answer: session.answer,
                          },
                          signal,
                        ),
                      ),
                    );
                    await store.patchWhen(
                      "review",
                      session.id,
                      { grade: json(grade), phase: "graded" },
                      "ai-grade",
                      () =>
                        !signal.aborted &&
                        !!currentQuestion(session.id, session.question) &&
                        store
                          .getSnapshot()
                          .reviews.find((r) => r.id === session.id)?.phase !==
                          "graded" &&
                        store
                          .getSnapshot()
                          .reviews.find((r) => r.id === session.id)?.answer ===
                          session.answer,
                    );
                  },
                )
              }
            >
              <Sparkles size={17} />
              {t("检查我的理解", "Check my understanding")}
            </button>
          ) : (
            session.grade && (
              <div className="assessment">
                <div
                  className={"score " + (session.grade.score < 60 ? "low" : "")}
                >
                  <strong>{session.grade.score}</strong>
                  <span>/ 100</span>
                  <p>
                    {session.grade.score < 60
                      ? t("再给理解一点时间", "Let’s work on this together")
                      : t("理解在逐渐扎根", "Your understanding is growing")}
                  </p>
                </div>
                <Markdown>
                  {session.grade.feedback + "\n\n" + session.grade.lesson}
                </Markdown>
                {session.grade.missing && (
                  <div className="notice">
                    {t(
                      "将补充到词条的遗漏点：",
                      "The following will be added to your entry: ",
                    )}
                    {session.grade.missing}
                  </div>
                )}
                <div className="actions">
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void act(
                        t("准备重新作答…", "Preparing retry…"),
                        async () => {
                          await store.patchWhen(
                            "review",
                            session.id,
                            { phase: "answer", answer: "", grade: null },
                            "review-retry",
                            () =>
                              !!currentQuestion(session.id, session.question),
                          );
                        },
                        false,
                      )
                    }
                  >
                    {t("重新作答", "Try again")}
                  </button>
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={() =>
                      void act(t("保存复习…", "Saving review…"), finish, false)
                    }
                  >
                    <CheckCircle2 size={17} />
                    {t("记录结果并继续", "Save result and continue")}
                  </button>
                </div>
                <p className="muted">
                  {t(
                    "评分低于60会进入短期重学；你也可以先重新作答。AI 评分仅供学习参考。",
                    "Scores below 60 trigger short-term relearning. You may retry first. AI assessment is guidance.",
                  )}
                </p>
              </div>
            )
          )}
        </section>
      ) : due.length ? (
        <div className="queue">
          {due.map((e, i) => (
            <button
              key={e.id}
              disabled={!!busy}
              onClick={() =>
                void act(
                  t("正在准备理解题…", "Preparing your question…"),
                  (signal) => start(e.id, signal),
                )
              }
            >
              <span className="queue-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{e.title}</h3>
                <p>
                  {e.card.reps
                    ? t(
                        `已复习 ${e.card.reps} 次 · 稳定性 ${e.card.stability.toFixed(1)} 天`,
                        `${e.card.reps} reviews · stability ${e.card.stability.toFixed(1)} days`,
                      )
                    : t(
                        "第一次复习 · 建立记忆的起点",
                        "First review · A starting point for memory",
                      )}
                </p>
              </div>
              <ArrowRight size={19} />
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title={t("今天的记忆已经照顾好了", "Your memories are in good hands")}
          description={t(
            "没有到期词条。继续探索，新的连接正在等待你。",
            "No entries are due. Keep exploring; new connections await.",
          )}
        />
      )}
    </div>
  );
}
