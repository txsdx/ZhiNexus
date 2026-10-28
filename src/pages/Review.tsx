/** Resumable review controls backed by the global streamed AI queue and explicit FSRS result commits. */
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
import { AIJobStream, useAIJobs } from "../components/AIJobView";
import { aiJobs, submitAIJob } from "../services/ai-jobs";
import { diagnostics } from "../services/diagnostics";
import { store, json } from "../core/store";
import type { Collection, Json } from "../core/types";
import { schedule } from "../core/review";
import { useConfirmation } from "../hooks/useConfirmation";
/** Continue review state across navigation; queue requests stay alive until explicitly stopped. */
export function Review({
  notify,
  initialSession = "",
}: {
  notify: (text: string) => void;
  initialSession?: string;
}) {
  const s = useKnowledge(),
    t = useT(),
    jobs = useAIJobs();
  const [selected, setSelected] = useState(initialSession),
    [busy, setBusy] = useState("");
  const working = useRef(false);
  const confirmation = useConfirmation(notify, {
    title: t("确认复习操作", "Confirm review action"),
    confirmLabel: t("确认", "Confirm"),
  });
  useEffect(() => {
    if (initialSession) setSelected(initialSession);
  }, [initialSession]);
  const unfinished = s.reviews.filter(
    (r) => !["done", "cancelled"].includes(r.phase),
  );
  const session = unfinished.find((r) => r.id === selected) ?? unfinished[0];
  const entry = s.entries.find((e) => e.id === session?.entryId);
  const activeJobs = jobs.jobs.filter(
    (j) =>
      j.target.page === "review" &&
      ["queued", "running", "approval"].includes(j.state),
  );
  const active =
    activeJobs.find((j) => j.target.sessionId === (session?.id ?? selected)) ??
    (!session ? activeJobs[0] : undefined);
  const due = s.entries
    .filter((e) => e.card.due <= new Date())
    .sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
  const act = async (label: string, work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    try {
      await work();
    } catch (error) {
      diagnostics.error("app", "复习操作失败 / Review action failed", error);
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      working.current = false;
      setBusy("");
    }
  };
  const currentQuestion = (id: string, question: unknown) => {
    const r = store.getSnapshot().reviews.find((r) => r.id === id);
    return (
      !!r &&
      !["done", "cancelled"].includes(r.phase) &&
      JSON.stringify(r.question) === JSON.stringify(question)
    );
  };
  const start = async (id: string) => {
    const r = store
      .getSnapshot()
      .reviews.find(
        (r) => r.entryId === id && !["done", "cancelled"].includes(r.phase),
      );
    if (r) {
      setSelected(r.id);
      return;
    }
    const sessionId = crypto.randomUUID();
    setSelected(sessionId);
    await submitAIJob(
      "question",
      { page: "review", entryId: id, sessionId },
      { replace: false },
      false,
    );
  };
  const newQuestion = () => {
    if (!session || !entry) return;
    const submit = async () => {
      await act(t("正在加入出题队列…", "Queueing question…"), async () => {
        await submitAIJob(
          "question",
          { page: "review", entryId: entry.id, sessionId: session.id },
          { replace: true },
          false,
        );
      });
    };
    return session.answer || session.grade
      ? confirmation.request(
          t(
            "重新出题会清空本次回答和评分，复习次数保持不变。继续？",
            "Replace this question and clear its answer and score? Your review count stays the same.",
          ),
          submit,
        )
      : submit();
  };
  const cancel = () =>
    session &&
    confirmation.request(
      t(
        "结束本次复习？本次回答和评分不会计入复习次数，也不会修改词条或下次复习时间。",
        "End this session? Its answer and score will not affect your entry or review schedule.",
      ),
      async () => {
        await act(t("取消复习…", "Cancelling review…"), async () => {
          for (const job of aiJobs
            .getSnapshot()
            .jobs.filter(
              (j) =>
                j.target.sessionId === session.id &&
                ["queued", "running", "approval"].includes(j.state),
            ))
            await aiJobs.cancel(job.id);
          const saved = await store.patchWhen(
            "review",
            session.id,
            { phase: "cancelled" },
            "review-cancel",
            () => currentQuestion(session.id, session.question),
          );
          if (saved) {
            setSelected("");
            notify(t("本次复习已取消", "Review cancelled"));
          }
        });
      },
    );
  const saveAnswer = (answer: string) => {
    if (!session || active || busy) return;
    void store
      .patchWhen(
        "review",
        session.id,
        { answer, phase: "answer" },
        "review-answer",
        () =>
          currentQuestion(session.id, session.question) &&
          store.getSnapshot().reviews.find((r) => r.id === session.id)
            ?.phase !== "graded",
      )
      .catch((error) => notify(String(error)));
  };
  const finish = async () => {
    if (!session?.grade || !entry) return;
    const patch: Record<string, Json> = {
      card: json(schedule(entry.card, session.grade.score)),
      updatedAt: new Date().toISOString(),
    };
    if (session.grade.missing.trim())
      patch.content =
        entry.content +
        "\n\n## 复习补充 · " +
        new Date().toLocaleDateString() +
        "\n\n" +
        session.grade.missing +
        "\n\n" +
        session.grade.lesson;
    const patches: {
      collection: Collection;
      id: string;
      patch: Record<string, Json>;
    }[] = [
      { collection: "entry", id: entry.id, patch },
      { collection: "review", id: session.id, patch: { phase: "done" } },
    ];
    const saved = await store.batchWhen(patches, "review-assessment", () => {
      const current = store.getSnapshot(),
        r = current.reviews.find((r) => r.id === session.id),
        e = current.entries.find((e) => e.id === entry.id);
      return (
        r?.phase === "graded" &&
        JSON.stringify(r.grade) === JSON.stringify(session.grade) &&
        JSON.stringify(r.question) === JSON.stringify(session.question) &&
        JSON.stringify(e?.card) === JSON.stringify(entry.card) &&
        e?.content === entry.content
      );
    });
    if (!saved)
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
      <div className="page-heading">
        <div>
          <h1>{t("今日复习", "Your review space")}</h1>
        </div>
        <span className="pill">
          <Clock3 size={15} />
          {due.length} {t("个待复习", "due")}
        </span>
      </div>
      {busy && (
        <div className="notice">
          <Busy label={busy} />
        </div>
      )}
      {active && (
        <section className="notice review-live-task">
          <Busy
            label={
              active.state === "queued"
                ? t("AI 任务排队中…", "AI task queued…")
                : t("AI 正在输出…", "AI is streaming…")
            }
          />
          <button
            onClick={() =>
              void act(t("停止请求…", "Stopping…"), () =>
                aiJobs.cancel(active.id),
              )
            }
          >
            {t("停止本次请求", "Stop request")}
          </button>
          <AIJobStream job={active} />
        </section>
      )}
      {session && entry ? (
        <section className="review-workspace">
          <div className="section-heading">
            <span className="category-dot">{entry.title}</span>
            <small>
              {t(
                "上下文自动保存 · 由 AI 出题和评估",
                "Context saved automatically · AI assessment",
              )}
            </small>
          </div>
          <div className="actions">
            <button
              disabled={!!busy || !!active}
              onClick={() => void newQuestion()}
            >
              <RefreshCw size={16} />
              {t("重新出题", "New question")}
            </button>
            <button disabled={!!busy} onClick={() => void cancel()}>
              <X size={16} />
              {t("取消本次复习", "Cancel review")}
            </button>
          </div>
          <h2>{session.question.question}</h2>
          {session.question.type === "choice" ? (
            <div className="choices">
              {session.question.choices.map((choice, index) => (
                <button
                  key={index}
                  disabled={!!busy || !!active || session.phase === "graded"}
                  className={session.answer === choice ? "selected" : ""}
                  onClick={() => saveAnswer(choice)}
                >
                  <span>{String.fromCharCode(65 + index)}</span>
                  {choice}
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
              disabled={!!busy || !!active || session.phase === "graded"}
              onChange={(event) => saveAnswer(event.target.value)}
            />
          )}
          {session.phase !== "graded" ? (
            <button
              className="primary"
              disabled={!!busy || !!active || !session.answer.trim()}
              onClick={() =>
                void act(
                  t("加入评估队列…", "Queueing assessment…"),
                  async () => {
                    await submitAIJob(
                      "grade",
                      {
                        page: "review",
                        entryId: entry.id,
                        sessionId: session.id,
                      },
                      {},
                      false,
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
                    disabled={!!busy || !!active}
                    onClick={() =>
                      void act(
                        t("准备重新作答…", "Preparing retry…"),
                        async () => {
                          await store.patchWhen(
                            "review",
                            session.id,
                            { phase: "answer", answer: "", grade: null },
                            "review-retry",
                            () => currentQuestion(session.id, session.question),
                          );
                        },
                      )
                    }
                  >
                    {t("重新作答", "Try again")}
                  </button>
                  <button
                    className="primary"
                    disabled={!!busy || !!active}
                    onClick={() =>
                      void act(t("保存复习…", "Saving review…"), finish)
                    }
                  >
                    <CheckCircle2 size={17} />
                    {t("记录结果并继续", "Save result and continue")}
                  </button>
                </div>
                <p>
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
          {due.map((e, index) => (
            <button
              key={e.id}
              disabled={
                !!busy || activeJobs.some((j) => j.target.entryId === e.id)
              }
              onClick={() =>
                void act(t("准备理解题…", "Preparing question…"), () =>
                  start(e.id),
                )
              }
            >
              <span className="queue-number">
                {String(index + 1).padStart(2, "0")}
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
