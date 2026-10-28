/** Inspectable local AI requests, provider responses and errors, with plain-text rendering and explicit clearing. */
import { useState, useSyncExternalStore } from "react";
import { diagnostics } from "../../services/diagnostics";
import { useSettings } from "./context";
import { useConfirmation } from "../../hooks/useConfirmation";
import { native } from "../../core/database";

/** Browse diagnostic history without exposing credentials or replicating private prompts to other devices. */
export function LogsPanel() {
  const { t, notify } = useSettings();
  const rows = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.getSnapshot,
  );
  const [level, setLevel] = useState("all"),
    [query, setQuery] = useState("");
  const confirmation = useConfirmation(notify, {
    title: t("确认清空日志", "Clear diagnostic logs"),
    confirmLabel: t("清空日志", "Clear logs"),
  });
  const filtered = rows.filter(
    (row) =>
      (level === "all" || row.level === level) &&
      JSON.stringify(row).toLowerCase().includes(query.toLowerCase()),
  );
  const exportLogs = async () => {
    await diagnostics.flush();
    const text = JSON.stringify(rows, null, 2),
      name = `ZhiNexus-logs-${new Date().toISOString().slice(0, 10)}.json`;
    if (native) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: name,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) {
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        await writeTextFile(path, text);
      }
    } else {
      const url = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        ),
        link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  };
  return (
    <>
      <h2>{t("日志", "Logs")}</h2>
      <p>
        {t(
          "记录 AI 请求的提示词、模型、拼接后的完整输出、耗时和错误。仅保存在本设备，最多保留最近 100 条（总量 32 MiB）；密钥和图片二进制不记录，过长内容会标明截断。导出前请检查是否包含私人学习内容。",
          "AI prompts, models, assembled complete output, timing and errors are stored on this device only. Keeps up to 100 recent records (32 MiB). Keys and binary images are excluded; long content is marked as truncated. Review private learning content before sharing an export.",
        )}
      </p>
      {diagnostics.storageError && (
        <p role="alert">
          {t("日志保存失败：", "Log storage failed: ")}
          {diagnostics.storageError}
        </p>
      )}
      <div className="form-grid">
        <label>
          {t("筛选日志", "Filter logs")}
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">{t("全部", "All")}</option>
            <option value="error">{t("错误", "Errors")}</option>
            <option value="pending">{t("进行中", "Pending")}</option>
            <option value="info">{t("完成", "Completed")}</option>
          </select>
        </label>
        <label>
          {t("搜索日志", "Search logs")}
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button
          onClick={() =>
            void exportLogs().catch((error) => {
              diagnostics.error(
                "app",
                "导出日志失败 / Log export failed",
                error,
              );
              notify(String(error));
            })
          }
        >
          {t("导出日志", "Export logs")}
        </button>
        <button
          className="danger"
          disabled={!rows.length}
          onClick={() =>
            void confirmation.request(
              t(
                "清空本设备全部诊断日志？知识库数据不受影响。",
                "Clear all local diagnostic logs? Knowledge data is retained.",
              ),
              () => diagnostics.clear(),
            )
          }
        >
          {t("清空日志", "Clear logs")}
        </button>
      </div>
      {!filtered.length && <p>{t("没有符合条件的日志", "No matching logs")}</p>}
      {filtered.map((row) => (
        <details
          className="diagnostic-record"
          data-log-id={row.id}
          data-level={row.level}
          key={row.id}
        >
          <summary>
            {new Date(row.at).toLocaleString()} · {row.level} · {row.message}
            {row.model ? ` · ${row.model}` : ""}
            {row.status ? ` · HTTP ${row.status}` : ""}
            {row.durationMs !== undefined ? ` · ${row.durationMs} ms` : ""}
          </summary>
          {row.request && (
            <>
              <h3>{t("请求与提示词", "Request and prompts")}</h3>
              <pre>{row.request}</pre>
            </>
          )}
          {row.response && (
            <>
              <h3>{t("拼接后的完整输出", "Complete output")}</h3>
              <pre>{row.response}</pre>
            </>
          )}
          {row.error && (
            <>
              <h3>{t("错误详情", "Error details")}</h3>
              <pre>{row.error}</pre>
            </>
          )}
        </details>
      ))}
      {confirmation.dialog}
    </>
  );
}
