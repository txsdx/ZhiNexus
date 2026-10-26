/** Models configuration panel with explicit persistence and verification. */
import { KeyRound, RefreshCw, Save } from "lucide-react";
import { store } from "../../core/store";
import { discoverModels } from "../../services/models";
import { useSettings } from "./context";
/** ModelsPanel exposes one focused settings workflow. */
export function ModelsPanel() {
  const { t, ai, setAI, device, setDevice, busy, act, notify } = useSettings();
  return (
    <>
      <h2>{t("连接你的 AI", "Connect your AI")}</h2>
      <p className="muted">
        {t(
          "支持 OpenAI 兼容的 Chat Completions 和 CPA 扩展模型目录。仅使用普通 API Key，不访问管理接口。",
          "Supports OpenAI-compatible Chat Completions and extended CPA catalogs. Uses only the ordinary API key, never admin endpoints.",
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
        {t("API Key（仅本设备）", "API key (this device only)")}
        <input
          autoComplete="off"
          type="password"
          value={device.apiKey}
          onChange={(e) => setDevice({ ...device, apiKey: e.target.value })}
        />
      </label>
      <div className="actions">
        <button
          disabled={!!busy}
          onClick={() =>
            void act(t("读取模型目录…", "Discovering models…"), async () => {
              const models = await discoverModels(ai.baseUrl, device.apiKey);
              setAI({ ...ai, models });
              notify(
                t(
                  `发现 ${models.length} 个模型，请保存后分配给任务`,
                  `Discovered ${models.length} models; save and assign them to tasks`,
                ),
              );
            })
          }
        >
          <RefreshCw size={16} />
          {t("读取模型与能力", "Discover models & capabilities")}
        </button>
        <button
          className="primary"
          disabled={!!busy}
          onClick={() =>
            void act(t("保存…", "Saving…"), async () => {
              await store.saveAI(ai);
              await store.saveDevice({
                ...store.getSnapshot().device,
                apiKey: device.apiKey,
              });
              notify(t("AI 配置已保存", "AI configuration saved"));
            })
          }
        >
          <Save size={16} />
          {t("保存 AI 配置", "Save AI settings")}
        </button>
      </div>
      <div className="model-list">
        {ai.models.map((m) => (
          <div key={m.id}>
            <strong>{m.name}</strong>
            <small>{m.id}</small>
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
          "? 表示服务端未声明能力。不会根据模型名称猜测，也不会发送未声明的 reasoning_effort。",
          "? means the server did not declare a capability. Undeclared reasoning_effort is never sent.",
        )}
      </div>
    </>
  );
}
