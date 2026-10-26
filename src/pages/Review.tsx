/** Resumable AI review sessions with answer persistence, teaching feedback and FSRS commits. */
import { diagnostics } from "../services/diagnostics";
import { useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, Sparkles } from "lucide-react";
import { useKnowledge, useT, Busy, Empty } from "../components/common";
import { Markdown } from "../components/Markdown";
import type { Collection, Json } from "../core/types";
import { store, json } from "../core/store";
import { gradeSchema, questionSchema, schedule } from "../core/review";
import { runTask, parseJson } from "../services/ai";
/** Resume unfinished sessions before presenting the due queue; never auto-award a passing score. */
export function Review({ notify }: { notify: (s: string) => void }) {
  const s = useKnowledge(),
    t = useT(),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState("");
  const unfinished = s.reviews.filter((r) => r.phase !== "done"),
    session = s.reviews.find((r) => r.id === selected) ?? unfinished[0],
    entry = s.entries.find((e) => e.id === session?.entryId),
    due = s.entries
      .filter((e) => e.card.due <= new Date())
      .sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      diagnostics.error("ai", "AI 任务失败 / AI task failed", e);
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const start = async (id: string) => {
    const e = s.entries.find((e) => e.id === id)!;
    const existing = unfinished.find((r) => r.entryId === id);
    if (existing) {
      setSelected(existing.id);
      return;
    }
    const question = questionSchema.parse(
        parseJson(
          await runTask("question", { title: e.title, content: e.content }),
        ),
      ),
      rid = crypto.randomUUID();
    await store.patch(
      "review",
      rid,
      json({
        entryId: id,
        phase: "question",
        question,
        answer: "",
        grade: null,
        startedAt: new Date().toISOString(),
      }) as Record<string, import("../core/types").Json>,
      "review",
    );
    setSelected(rid);
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
    await store.batch(patches, "review-assessment");
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
          <h2>{session.question.question}</h2>
          {session.question.type === "choice" ? (
            <div className="choices">
              {session.question.choices.map((c, i) => (
                <button
                  disabled={session.phase === "graded"}
                  className={session.answer === c ? "selected" : ""}
                  key={i}
                  onClick={() =>
                    void store.patch("review", session.id, {
                      answer: c,
                      phase: "answer",
                    })
                  }
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
              disabled={session.phase === "graded"}
              onChange={(e) =>
                void store.patch("review", session.id, {
                  answer: e.target.value,
                  phase: "answer",
                })
              }
            />
          )}{" "}
          {session.phase !== "graded" ? (
            <button
              className="primary"
              disabled={!!busy || !session.answer.trim()}
              onClick={() =>
                void act(
                  t("评估理解并整理薄弱点…", "Assessing your understanding…"),
                  async () => {
                    const grade = gradeSchema.parse(
                      parseJson(
                        await runTask("grade", {
                          title: entry.title,
                          content: entry.content,
                          question: JSON.stringify(session.question),
                          answer: session.answer,
                        }),
                      ),
                    );
                    await store.patch(
                      "review",
                      session.id,
                      { grade: json(grade), phase: "graded" },
                      "ai-grade",
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
                  {session.grade.score < 60 && (
                    <button
                      onClick={() =>
                        void store.patch("review", session.id, {
                          phase: "answer",
                          answer: "",
                          grade: null,
                        })
                      }
                    >
                      {t("重新作答", "Try again")}
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={() =>
                      void act(t("保存复习…", "Saving review…"), finish)
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
                void act(t("正在准备理解题…", "Preparing your question…"), () =>
                  start(e.id),
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
