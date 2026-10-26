/** Models configuration panel with explicit persistence and verification. */
import { useSyncExternalStore } from "react";
import { keySyncStatus, saveAIAndKey } from "../../services/key-sync";
import { KeyRound, RefreshCw, Save } from "lucide-react";
import { discoverModels } from "../../services/models";
import { useSettings } from "./context";
/** ModelsPanel exposes one focused settings workflow. */
export function ModelsPanel() {
  const keyStatus = useSyncExternalStore(
    keySyncStatus.subscribe,
    keySyncStatus.getSnapshot,
  );
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
      <label>
        {t("自定义同步密钥（可选）", "Custom synchronization key (optional)")}
        <input
          type="password"
          autoComplete="off"
          value={device.apiKeySyncKey ?? ""}
          onChange={(e) =>
            setDevice({ ...device, apiKeySyncKey: e.target.value })
          }
          placeholder={t(
            "留空使用程序内置密钥",
            "Leave blank for the built-in convenience key",
          )}
        />
      </label>
      <p className="muted">
        {t(
          "默认无需密码，API Key 自动加密保存并随数据同步。内置密钥随程序提供；填写自定义密钥时，各设备需使用同一个值。",
          "No password is required by default. The API key is encrypted and synchronized automatically. The built-in key ships with the app; custom keys must match on each device.",
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
              await saveAIAndKey(ai, device.apiKey, device.apiKeySyncKey ?? "");
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
