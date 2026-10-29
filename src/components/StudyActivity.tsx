/** Accessible activity calendar offers real per-day records and keyboard navigation without an extra global page. */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { studyActivity } from "../core/study-activity";
import { useKnowledge, useT, Modal } from "./common";
import { useReviewClock } from "../hooks/useReviewClock";
/** Keep history derived and bounded; viewing a day never writes knowledge or marks a review complete. */
export function StudyActivity({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useKnowledge(),
    t = useT(),
    now = useReviewClock(),
    activity = useMemo(() => studyActivity(s.docs, new Date()), [s.docs, now]);
  const [selectedKey, setSelected] = useState<string | null>(null),
    [active, setActive] = useState(""),
    grid = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null);
  const selected = activity.days.find((day) => day.key === selectedKey);
  const today = activity.days.at(-1)!.key;
  const focusKey = activity.days.some((day) => day.key === active)
    ? active
    : today;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    // Show recent activity on narrow screens; manual horizontal panning does not resize the container.
    const showRecent = () => {
      node.scrollLeft = node.scrollWidth;
    };
    const observer = new ResizeObserver(showRecent);
    observer.observe(node);
    showRecent();
    return () => observer.disconnect();
  }, [today]);
  return (
    <section
      className="study-activity"
      aria-label={t("学习活动", "Learning activity")}
    >
      <header className="section-heading">
        <h2>{t("学习活动", "Learning activity")}</h2>
        <span>{t("近26周", "Last 26 weeks")}</span>
      </header>
      <div className="study-activity-stats">
        <span>
          {t("新增", "Created")} <b>{activity.created}</b>
        </span>
        <span>
          {t("完成复习", "Reviews")} <b>{activity.reviewed}</b>
        </span>
        <span>
          {t("记录天数", "Active days")} <b>{activity.activeDays}</b>
        </span>
        <span>
          {t("连续记录", "Streak")} <b>{activity.streak}</b> {t("天", "days")}
        </span>
      </div>
      <div className="study-calendar-scroll" ref={scroller}>
        <div
          ref={grid}
          className="study-calendar"
          role="group"
          aria-label={t(
            "按日期查看记录，方向键移动",
            "Browse dates with arrow keys",
          )}
        >
          {activity.days.map((day, index) => {
            const created = day.events.filter(
                (event) => event.kind === "created",
              ).length,
              reviewed = day.events.length - created;
            const label =
              day.date.toLocaleDateString() +
              t(
                `，新增${created}，复习${reviewed}`,
                `, ${created} created, ${reviewed} reviewed`,
              );
            return (
              <button
                key={day.key}
                data-day={day.key}
                data-level={Math.min(4, day.events.length)}
                title={label}
                aria-label={label}
                tabIndex={focusKey === day.key ? 0 : -1}
                onFocus={() => setActive(day.key)}
                onClick={() => setSelected(day.key)}
                onKeyDown={(event) => {
                  const offset: Record<string, number> = {
                    ArrowLeft: -7,
                    ArrowRight: 7,
                    ArrowUp: -1,
                    ArrowDown: 1,
                    Home: -index % 7,
                    End: 6 - (index % 7),
                  };
                  if (!(event.key in offset)) return;
                  event.preventDefault();
                  const next = Math.max(
                    0,
                    Math.min(
                      activity.days.length - 1,
                      index + offset[event.key],
                    ),
                  );
                  grid.current
                    ?.querySelector<HTMLButtonElement>(
                      `[data-day="${activity.days[next].key}"]`,
                    )
                    ?.focus();
                }}
              />
            );
          })}
        </div>
      </div>
      <footer>
        <time>{activity.days[0].date.toLocaleDateString()}</time>
        <span>
          {t("少", "Less")} <i data-level="0" />
          <i data-level="1" />
          <i data-level="2" />
          <i data-level="3" />
          <i data-level="4" /> {t("多", "More")}
        </span>
        <time>{activity.days.at(-1)!.date.toLocaleDateString()}</time>
      </footer>
      {selected && (
        <Modal
          title={selected.date.toLocaleDateString() + t("的记录", " activity")}
          onClose={() => setSelected(null)}
        >
          {selected.events.length ? (
            <ul className="study-day-events">
              {selected.events.map((event) => (
                <li key={event.id}>
                  <span>
                    {event.kind === "created"
                      ? t("新增", "Created")
                      : t("复习", "Reviewed")}
                  </span>
                  <button
                    disabled={event.deleted}
                    onClick={() => {
                      flushSync(() => setSelected(null));
                      onOpen(event.entryId);
                    }}
                  >
                    {event.title}
                    {event.deleted && t("（已删除）", " (deleted)")}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("本日暂无记录", "No activity on this day")}</p>
          )}
        </Modal>
      )}
    </section>
  );
}
