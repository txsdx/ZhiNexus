/** An inspectable seven-day workload preview helps choose knowledge without changing any schedule. */
import { useState } from "react";
import { useKnowledge, useT, Modal } from "./common";
import { reviewForecast } from "../core/review-forecast";
import { reviewTarget } from "../core/review-policy";
import { useReviewClock } from "../hooks/useReviewClock";
import { ImportanceBadge } from "./EntryImportance";
/** The chart shows exact current next-due counts, with clickable day details rather than invented statistics. */
export function ReviewForecast({ onOpen }: { onOpen: (id: string) => void }) {
  const state = useKnowledge(),
    t = useT(),
    now = useReviewClock();
  const [selected, setSelected] = useState<number | null>(null);
  const days = reviewForecast(state.entries, reviewTarget(state.docs), now),
    maximum = Math.max(
      1,
      ...days.map((day) => day.high.length + day.normal.length),
    ),
    day = selected === null ? undefined : days[selected];
  return (
    <section
      className="review-forecast"
      aria-label={t("未来七天复习负荷", "Seven-day review workload")}
    >
      <div className="section-heading">
        <h2>{t("未来七天", "Next seven days")}</h2>
        <small>
          {t(
            "按当前计划 · 含今日逾期",
            "Current schedule · overdue work included today",
          )}
        </small>
      </div>
      <div className="review-forecast-days">
        {days.map((day, index) => (
          <button
            key={index}
            onClick={() => setSelected(index)}
            aria-label={
              day.date.toLocaleDateString() +
              t(
                `，${day.high.length + day.normal.length} 个待复习，高等级 ${day.high.length} 个`,
                `, ${day.high.length + day.normal.length} due, ${day.high.length} high importance`,
              )
            }
          >
            <span>
              {index === 0
                ? t("今天", "Today")
                : day.date.toLocaleDateString(undefined, {
                    month: "numeric",
                    day: "numeric",
                  })}
            </span>
            <strong>{day.high.length + day.normal.length}</strong>
            <span className="forecast-bar" aria-hidden="true">
              <i
                className="high"
                style={{ width: `${(day.high.length / maximum) * 100}%` }}
              />
              <i
                className="normal"
                style={{ width: `${(day.normal.length / maximum) * 100}%` }}
              />
            </span>
          </button>
        ))}
      </div>
      {day && (
        <Modal
          title={
            day.date.toLocaleDateString() +
            t(" · 预计待复习", " · Scheduled reviews")
          }
          onClose={() => setSelected(null)}
        >
          {!day.high.length && !day.normal.length && (
            <p>
              {t(
                "当前没有安排在这一天的条目。",
                "No entries are currently scheduled for this day.",
              )}
            </p>
          )}
          <div className="forecast-entries">
            {[...day.high, ...day.normal].map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  setSelected(null);
                  onOpen(entry.id);
                }}
              >
                <ImportanceBadge entry={entry} />
                {entry.title}
              </button>
            ))}
          </div>
          <small>
            {t(
              "仅统计每条知识当前的下次复习；真实复习后，后续安排会变化。",
              "Counts only each entry’s current next review. Completing a review changes later scheduling.",
            )}
          </small>
        </Modal>
      )}
    </section>
  );
}
