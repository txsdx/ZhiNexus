/** Models configuration panel with explicit persistence and verification. */
import { useSyncExternalStore } from "react";
import { keySyncStatus } from "../../services/key-sync";
import { KeyRound, RefreshCw } from "lucide-react";
import { discoverModels } from "../../services/models";
import { useSettings } from "./context";
import { useAIJobs } from "../../components/AIJobView";
/** ModelsPanel exposes one focused settings workflow. */
export function ModelsPanel() {
  const { readOnly } = useAIJobs();
  const keyStatus = useSyncExternalStore(
    keySyncStatus.subscribe,
    keySyncStatus.getSnapshot,
  );
  const { t, ai, setAI, device, setDevice, busy, act, notify, flushSettings } =
    useSettings();
  return (
    <>
      <h2>{t("连接你的 AI", "Connect your AI")}</h2>
      <label>
        {t("AI 并发任务上限（本设备）", "AI concurrency limit (this device)")}
        <input
          type="number"
          disabled={readOnly}
          min="1"
          max="16"
          value={device.aiConcurrency ?? 2}
          onChange={(e) =>
            setDevice({ ...device, aiConcurrency: Number(e.target.value) })
          }
        />
      </label>
      <p>
        {t(
          "默认 2，最多 16；等待审阅和确认的任务不占用请求名额。",
          "Default 2, maximum 16. Reviews and approvals do not occupy request slots.",
        )}
      </p>
      <p className="muted">
        {t(
          "支持 OpenAI 兼容的 Chat Completions 和 CPA 扩展模型目录。仅使用普通 API Key，不访问管理接口。",
          "Supports OpenAI-compatible Chat Completions and extended CPA catalogs. Uses only the ordinary API key, never admin endpoints.",
        )}
      </p>
      <p className="muted">
        {t(
          "支持 HTTPS 和本机/局域网 HTTP 接口；WebDAV 仍强制 HTTPS。可填写 Base URL 或完整 chat/completions 地址。",
          "HTTPS and HTTP AI endpoints are supported. WebDAV still requires HTTPS. A base URL or full chat/completions URL is accepted.",
        )}
      </p>
      <label>
        API Base URL
        <input
          placeholder="https://api.example.com/v1"
          value={ai.baseUrl}
          onChange={(e) => setAI({ ...ai, baseUrl: e.target.value })}
        />
      </label>
      <label>
        <KeyRound size={15} />
        {t("API Key（加密保存与同步）", "API key (encrypted storage & sync)")}
        <input
          autoComplete="off"
          type="password"
          value={device.apiKey}
          onChange={(e) => setDevice({ ...device, apiKey: e.target.value })}
        />
      </label>
      <p className="muted">
        {t(
          "API Key 自动加密保存并同步，默认使用程序提供的密钥；可在“数据库与云同步”中设置自定义同步密钥（可选）。",
          "The API key is encrypted and synchronized automatically using the default key. An optional custom synchronization key is available under Database & cloud sync.",
        )}
      </p>
      {keyStatus.message && <p role="status">{keyStatus.message}</p>}
      <label>
        {t("全局默认模型", "Global default model")}
        <select
          value={ai.defaultModel}
          onChange={(e) => setAI({ ...ai, defaultModel: e.target.value })}
        >
          <option value="">{t("未配置", "Not configured")}</option>
          {ai.defaultModel &&
            !ai.models.some((m) => m.id === ai.defaultModel) && (
              <option value={ai.defaultModel}>{ai.defaultModel}</option>
            )}
          {ai.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        {t(
          "任务和助手选择“默认模型”时，动态使用此模型；单独指定的模型保持不变。",
          "Tasks and assistants set to Default model follow this setting dynamically; explicit selections stay unchanged.",
        )}
      </p>
      <div className="actions">
        <button
          disabled={!!busy}
          onClick={() =>
            void act(t("读取模型目录…", "Discovering models…"), async () => {
              const models = await discoverModels(ai.baseUrl, device.apiKey);
              setAI((previous) => ({ ...previous, models }));
              await flushSettings();
              notify(
                t(
                  `发现 ${models.length} 个模型，已自动保存，可分配给任务`,
                  `Discovered ${models.length} models; automatically saved and ready for tasks`,
                ),
              );
            })
          }
        >
          <RefreshCw size={16} />
          {t("读取模型与能力", "Discover models & capabilities")}
        </button>
      </div>
      <div className="model-list">
        {ai.models.map((m) => (
          <div key={m.id}>
            <strong>{m.id}</strong>
            <div className="tags">
              <span>Tools: {m.tools === null ? "?" : m.tools ? "✓" : "—"}</span>
              <span>
                Vision: {m.vision === null ? "?" : m.vision ? "✓" : "—"}
              </span>
              <span>Thinking: {m.efforts.join(" / ") || "?"}</span>
              {m.context && <span>Context: {m.context.toLocaleString()}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="notice">
        {t(
          "? 表示服务端未声明能力。Tools 未知时允许尝试，仅明确不支持时禁用；不会发送未声明的 reasoning_effort。",
          "? means the server did not declare a capability. Unknown tool support allows an attempt; only explicit lack of support disables tools. Undeclared reasoning_effort is never sent.",
        )}
      </div>
    </>
  );
}
