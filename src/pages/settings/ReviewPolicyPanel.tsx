/** Scientifically named FSRS target and concise guidance for learner-controlled recall ratings. */
import { useSettings } from "./context";
/** Save one shared review policy through the same independent, debounced settings editor. */
export function ReviewPolicyPanel() {
  const { t, reviewPolicy, setReviewPolicy } = useSettings();
  return (
    <>
      <h2>{t("复习与记忆", "Review & memory")}</h2>
      <label>
        {t("期望保留率（复习阈值）", "Desired retention (review threshold)")}
        <input
          type="number"
          min={50}
          max={99}
          step={1}
          value={Math.round(reviewPolicy.retention * 100)}
          onChange={(event) =>
            setReviewPolicy({ retention: Number(event.target.value) / 100 })
          }
        />
        <span>%</span>
      </label>
      <p>
        {t(
          "默认90%。更高的目标会增加复习量，通常建议低于97%。这是预计回忆概率，不是直接测得的记忆强度。",
          "Default: 90%. Higher targets increase review workload; staying below 97% is usually recommended. This is predicted recall, not a direct memory measurement.",
        )}
      </p>
      <p>
        {t(
          "调高目标会让较弱的词条提前进入复习队列；已有的到期任务保留，后续排程采用新目标。忘记时请选择“忘记”，只有想起来但费力时才选“困难”。",
          "Raising the target brings weaker entries forward. Existing due work is preserved, and subsequent schedules use the new target. Choose Again when you forgot; Hard means you recalled with effort.",
        )}
      </p>
      <a
        href="https://docs.ankiweb.net/manual/deck-options#desired-retention"
        target="_blank"
        rel="noreferrer"
      >
        {t("Anki / FSRS 官方说明", "Anki / FSRS documentation")} ↗
      </a>
    </>
  );
}
