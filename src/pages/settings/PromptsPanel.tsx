/** Prompts configuration panel with explicit persistence and verification. */
import { Save } from "lucide-react";
import { taskLabels, templates } from "../../core/defaults";
import { store } from "../../core/store";
import { resolveModel } from "../../core/ai-config";
import type { Task } from "../../core/types";
import { useSettings } from "./context";
/** PromptsPanel exposes one focused settings workflow. */
export function PromptsPanel() {
  const { t, task, setTask, ai, setAI, act } = useSettings();
  return (
    <>
      <h2>
        {t("每项任务，都有合适的思考方式", "The right model for each task")}
      </h2>
      <div className="filter-row">
        {(Object.keys(taskLabels) as Task[]).map((k) => (
          <button
            key={k}
            className={task === k ? "active" : ""}
            onClick={() => setTask(k)}
          >
            {t(...taskLabels[k])}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          {t("任务模型", "Task model")}
          <select
            value={ai.tasks[task].model}
            onChange={(e) =>
              setAI({
                ...ai,
                tasks: {
                  ...ai.tasks,
                  [task]: { ...ai.tasks[task], model: e.target.value },
                },
              })
            }
          >
            <option value="">
              {t("默认模型", "Default model")}
              {ai.defaultModel ? ` (${ai.defaultModel})` : ""}
            </option>
            {ai.tasks[task].model &&
              !ai.models.some((m) => m.id === ai.tasks[task].model) && (
                <option value={ai.tasks[task].model}>
                  {ai.tasks[task].model}
                </option>
              )}
            {ai.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("思考深度", "Reasoning effort")}
          <select
            value={ai.tasks[task].effort}
            onChange={(e) =>
              setAI({
                ...ai,
                tasks: {
                  ...ai.tasks,
                  [task]: { ...ai.tasks[task], effort: e.target.value },
                },
              })
            }
          >
            {[
              ...new Set([
                ai.tasks[task].effort,
                ...(ai.models.find((m) => m.id === resolveModel(ai, task))
                  ?.efforts ?? []),
              ]),
            ].map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t("提示词模板", "Prompt template")}
        <textarea
          className="prompt-editor"
          rows={13}
          value={ai.tasks[task].prompt}
          onChange={(e) =>
            setAI({
              ...ai,
              tasks: {
                ...ai.tasks,
                [task]: { ...ai.tasks[task], prompt: e.target.value },
              },
            })
          }
        />
      </label>
      <p className="muted">
        {
          "{{title}} {{content}} {{question}} {{answer}} {{entries}} {{categories}}"
        }
        <br />
        {t(
          "变量视任务而定。结构化任务需要保留模板规定的 JSON 字段。默认深度是偏好，只有模型明确支持时才发送。",
          "Variables depend on the task. Preserve the JSON contract for structured tasks. Default effort is a preference, sent only when explicitly supported.",
        )}
      </p>
      <div className="actions">
        <button
          onClick={() =>
            setAI({
              ...ai,
              tasks: {
                ...ai.tasks,
                [task]: { ...ai.tasks[task], prompt: templates[task] },
              },
            })
          }
        >
          {t("恢复默认模板", "Reset template")}
        </button>
        <button
          className="primary"
          onClick={() =>
            void act(t("保存模板", "Saving prompts"), () => store.saveAI(ai))
          }
        >
          <Save size={16} />
          {t("保存全部任务", "Save all tasks")}
        </button>
      </div>
    </>
  );
}
