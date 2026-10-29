/** A persistent offline recall card reveals the explanation only after an explicit attempt. */
import { useEffect, useState, useRef } from "react";
import type { Entry, ReviewSession } from "../core/types";
import { sha256 } from "../core/crypto";
import { selfReviewSource } from "../services/self-review";
import { scheduleRecall } from "../core/review";
import { revealSelfReview, finishSelfReview } from "../services/self-review";
import { Markdown } from "./Markdown";
import { useT } from "./common";
/** Numeric keys select a rating; only the Save button changes the card. Cancel preserves the original schedule. */
export function SelfReview({
  session,
  entry,
  retention,
  onDone,
  onCancel,
  notify,
}: {
  session: ReviewSession;
  entry: Entry;
  retention: number;
  onDone: () => void;
  onCancel: () => void;
  notify: (message: string) => void;
}) {
  const t = useT(),
    [rating, setRating] = useState<1 | 2 | 3 | 4>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const revealed = session.phase === "graded";
  const [valid, setValid] = useState<boolean | null>(null),
    running = useRef(false);
  useEffect(() => {
    let live = true;
    setValid(null);
    void sha256(selfReviewSource(entry, retention))
      .then((hash) => {
        if (live) setValid(hash === session.referenceHash);
      })
      .catch(() => {
        if (live) setValid(false);
      });
    return () => {
      live = false;
    };
  }, [entry, retention, session.referenceHash]);
  useEffect(() => {
    const rate = (event: KeyboardEvent) => {
      if (
        !revealed ||
        valid !== true ||
        busy ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        document.querySelector('[role="dialog"]') ||
        (event.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      if (/^[1-4]$/.test(event.key)) {
        event.preventDefault();
        setRating(Number(event.key) as 1 | 2 | 3 | 4);
      }
    };
    document.addEventListener("keydown", rate);
    return () => document.removeEventListener("keydown", rate);
  }, [revealed, busy, valid]);
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="self-review review-workspace"
      aria-label={t("自主回忆", "Offline recall")}
    >
      <header className="section-heading">
        <h2>{entry.title}</h2>
        <span className="pill">{t("离线自主回忆", "Offline recall")}</span>
      </header>
      {valid === false && (
        <p className="warning" role="alert">
          {t(
            "词条或复习设置已改变，请取消后重新开始。",
            "Entry or review settings changed. Cancel and start again.",
          )}
        </p>
      )}
      {!revealed ? (
        <div className="recall-prompt">
          <p>
            {t(
              "不看解释，试着说出含义、适用条件和一个例子。",
              "Without looking, recall its meaning, conditions and an example.",
            )}
          </p>
          <button
            className="primary"
            disabled={busy || valid !== true}
            onClick={() => void run(() => revealSelfReview(session.id))}
          >
            {t("揭示解释", "Reveal explanation")}
          </button>
        </div>
      ) : (
        <>
          <div className="self-review-answer">
            <Markdown>{entry.content}</Markdown>
          </div>
          <fieldset className="recall-rating">
            <legend>
              {t("刚才实际回忆得怎么样？", "How did recall actually feel?")}
            </legend>
            {([1, 2, 3, 4] as const).map((value, index) => (
              <button
                key={value}
                type="button"
                disabled={busy || valid !== true}
                aria-pressed={rating === value}
                onClick={() => setRating(value)}
              >
                {t(
                  ["忘记", "困难", "记得", "轻松"][index],
                  ["Again", "Hard", "Good", "Easy"][index],
                )}
                <kbd aria-hidden="true">{value}</kbd>
                <small>
                  {(() => {
                    const due = scheduleRecall(
                        entry.card,
                        value,
                        new Date(),
                        retention,
                      ).due,
                      minutes = Math.max(
                        1,
                        Math.round((due.getTime() - Date.now()) / 60000),
                      );
                    return minutes < 60
                      ? t(`${minutes}分钟`, `${minutes} min`)
                      : minutes < 1440
                        ? t(
                            `${Math.round(minutes / 60)}小时`,
                            `${Math.round(minutes / 60)} h`,
                          )
                        : t(
                            `${Math.round(minutes / 1440)}天`,
                            `${Math.round(minutes / 1440)} d`,
                          );
                  })()}
                </small>
              </button>
            ))}
          </fieldset>
          <button
            className="primary"
            disabled={busy || valid !== true || !rating}
            onClick={() =>
              void run(async () => {
                if (!rating) return;
                await finishSelfReview(session.id, rating);
                notify(t("复习已记录", "Review saved"));
                onDone();
              })
            }
          >
            {t("记录结果并继续", "Save and continue")}
          </button>
        </>
      )}
      <button disabled={busy} onClick={onCancel}>
        {t("取消本次复习", "Cancel review")}
      </button>
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
