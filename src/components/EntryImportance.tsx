/** Compact knowledge-priority labels and a guarded editor preserve manual choices across AI generations. */
import { useState } from "react";
import { useT, Modal } from "./common";
import type { Entry } from "../core/types";
import {
  importanceLevel,
  importanceLabels,
  importanceLevels,
  type ImportanceLevel,
} from "../core/importance";
import {
  entrySelectionSnapshot,
  changeEntrySelection,
} from "../services/entry-selection";
import { submitAIJob } from "../services/ai-jobs";
/** Short labels fit inside the title cell without adding another metadata column. */
export function ImportanceBadge({
  entry,
}: {
  entry: Pick<Entry, "importance">;
}) {
  const t = useT(),
    level = importanceLevel(entry);
  return (
    <span
      className="importance-badge"
      data-importance={level}
      title={t("重要等级：", "Importance: ") + t(...importanceLabels[level])}
      aria-label={
        t("重要等级：", "Importance: ") + t(...importanceLabels[level])
      }
    >
      {t(
        level === "high" ? "高" : level === "low" ? "低" : "普",
        level === "high" ? "H" : level === "low" ? "L" : "N",
      )}
    </span>
  );
}
/** Editing opens a small reviewable form; cancellation and failed persistence leave the entry intact. */
export function EntryImportanceControl({
  entry,
  disabled,
  notify,
}: {
  entry: Entry;
  disabled?: boolean;
  notify: (message: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<{
      level: ImportanceLevel;
      auto: boolean;
      before: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      await changeEntrySelection([entry.id], draft.before, {
        importance: {
          level: draft.level,
          mode: draft.auto ? "auto" : "manual",
          ...(draft.auto &&
          draft.level === importanceLevel(entry) &&
          entry.importance?.reason
            ? { reason: entry.importance.reason }
            : {}),
        },
      });
      setDraft(null);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="importance-control"
        disabled={disabled}
        aria-label={t("修改重要等级", "Change importance")}
        title={entry.importance?.reason}
        onClick={() => {
          setError("");
          setDraft({
            level: importanceLevel(entry),
            auto: entry.importance?.mode !== "manual",
            before: entrySelectionSnapshot([entry.id]),
          });
        }}
      >
        <ImportanceBadge entry={entry} />
        <span>{t(...importanceLabels[importanceLevel(entry)])}</span>
      </button>
      {draft && (
        <Modal
          title={t("词条重要等级", "Entry importance")}
          onClose={() => {
            if (!busy) setDraft(null);
          }}
          onConfirm={() => void save()}
        >
          <fieldset className="importance-options" disabled={busy}>
            <legend>{t("重要等级", "Importance")}</legend>
            {importanceLevels.map((level, index) => (
              <label key={level}>
                <input
                  type="radio"
                  name="entry-importance"
                  value={level}
                  checked={draft.level === level}
                  onChange={() => setDraft({ ...draft, level, auto: false })}
                />
                <span>
                  <strong>{t(...importanceLabels[level])}</strong>
                  <small>
                    {t(
                      [
                        "核心、常用知识，到期后优先复习",
                        "按正常记忆计划复习",
                        "仅作参考，不进入复习或提醒",
                      ][index],
                      [
                        "Core knowledge; prioritize when due",
                        "Follow the normal memory schedule",
                        "Reference only; no reviews or reminders",
                      ][index],
                    )}
                  </small>
                </span>
              </label>
            ))}
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.auto}
                onChange={(event) =>
                  setDraft({ ...draft, auto: event.target.checked })
                }
              />
              {t(
                "允许 AI 在下次生成解释时调整等级",
                "Allow AI to adjust priority when generating explanations",
              )}
            </label>
          </fieldset>
          {entry.importance?.reason && (
            <p className="importance-reason">
              {t("上次 AI 依据：", "Previous AI rationale: ")}
              {entry.importance.reason}
            </p>
          )}
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setDraft(null);
              }}
            >
              {t("取消", "Cancel")}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void submitAIJob("importance", {
                  page: "entry",
                  entryId: entry.id,
                })
                  .then(
                    () => setDraft(null),
                    (error) => {
                      setError(
                        String(error instanceof Error ? error.message : error),
                      );
                      notify(
                        t(
                          "重要等级建议未能提交",
                          "Could not queue importance assessment",
                        ),
                      );
                    },
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {t("请 AI 单独评估", "Ask AI for a suggestion")}
            </button>
            <button
              className="primary"
              data-confirm
              disabled={busy}
              onClick={() => void save()}
            >
              {t("保存等级", "Save importance")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
