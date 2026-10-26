/** Local MCP transport configuration, validated argument/environment editing and explicit connection tests. */
import { useState } from "react";
import { z } from "zod";
import type { McpConfig } from "../../core/types";
import { connectMcp } from "../../services/mcp";
import { serviceUrl } from "../../services/network";
import { useSettings } from "./context";
import { useConfirmation } from "../../hooks/useConfirmation";
/** Configure SDK HTTP/SSE or directly owned desktop stdio processes without shell command parsing. */
export function McpPanel() {
  const { t, device, setDevice, act, busy, notify } = useSettings();
  const confirmation = useConfirmation(notify);
  const [drafts, setDrafts] = useState<
    Record<string, { args?: string; env?: string }>
  >({});
  const [jsonError, setJsonError] = useState("");
  const update = (id: string, patch: Partial<McpConfig>) =>
    setDevice({
      ...device,
      mcp: device.mcp.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  const updateJson = (id: string, key: "args" | "env", text: string) => {
    setDrafts((previous) => ({
      ...previous,
      [id]: { ...previous[id], [key]: text },
    }));
    try {
      const value: unknown = JSON.parse(text);
      if (key === "args")
        update(id, { args: z.array(z.string()).max(128).parse(value) });
      else update(id, { env: z.record(z.string(), z.string()).parse(value) });
      setJsonError("");
    } catch {
      setJsonError(
        t(
          "JSON 格式无效，该字段尚未保存；修正后自动保存。",
          "Invalid JSON; this field is not saved until corrected.",
        ),
      );
    }
  };
  const parse = (m: McpConfig): McpConfig => {
    if (m.transport !== "stdio") {
      serviceUrl(m.url);
      return m;
    }
    if (!m.command?.trim())
      throw Error(t("请填写可执行程序", "Enter an executable"));
    return {
      ...m,
      args: z
        .array(z.string())
        .max(128)
        .parse(JSON.parse(drafts[m.id]?.args ?? JSON.stringify(m.args ?? []))),
      env: z
        .record(z.string(), z.string())
        .parse(JSON.parse(drafts[m.id]?.env ?? JSON.stringify(m.env ?? {}))),
    };
  };
  return (
    <>
      <h2>{t("连接外部工具", "Connect external tools")}</h2>
      <p className="muted">
        {t(
          "支持 Streamable HTTP、SSE 和桌面 stdio。stdio 配置程序路径、参数数组和环境变量；每次 Agent 执行外部工具时确认。导入其他设备的 stdio 配置默认关闭。",
          "Supports Streamable HTTP, SSE and desktop stdio. Configure executable, argument array and environment variables. Agent tool execution requires confirmation; imported stdio configurations start disabled.",
        )}
      </p>
      {jsonError && <p role="alert">{jsonError}</p>}
      {device.mcp.map((m) => (
        <section className="mcp-card" key={m.id}>
          <label>
            {t("名称", "Name")}
            <input
              aria-label="MCP name"
              value={m.name}
              onChange={(e) => update(m.id, { name: e.target.value })}
            />
          </label>
          <label>
            {t("协议", "Transport")}
            <select
              value={m.transport ?? "http"}
              onChange={(e) =>
                update(m.id, {
                  transport: e.target.value as McpConfig["transport"],
                  enabled: false,
                })
              }
            >
              <option value="http">Streamable HTTP</option>
              <option value="sse">SSE</option>
              <option value="stdio">stdio · {t("仅桌面", "desktop")}</option>
            </select>
          </label>
          {m.transport === "stdio" ? (
            <>
              <label>
                {t("程序路径或命令名", "Executable path or name")}
                <input
                  value={m.command ?? ""}
                  placeholder="npx"
                  onChange={(e) => update(m.id, { command: e.target.value })}
                />
              </label>
              <label>
                {t("参数（JSON 字符串数组）", "Arguments (JSON string array)")}
                <textarea
                  rows={3}
                  value={
                    drafts[m.id]?.args ?? JSON.stringify(m.args ?? [], null, 2)
                  }
                  onChange={(e) => updateJson(m.id, "args", e.target.value)}
                />
              </label>
              <label>
                {t(
                  "环境变量（JSON 对象）",
                  "Environment variables (JSON object)",
                )}
                <textarea
                  rows={3}
                  spellCheck={false}
                  value={
                    drafts[m.id]?.env ?? JSON.stringify(m.env ?? {}, null, 2)
                  }
                  onChange={(e) => updateJson(m.id, "env", e.target.value)}
                />
              </label>
              <label>
                {t(
                  "工作目录（可选绝对路径）",
                  "Working directory (optional absolute path)",
                )}
                <input
                  value={m.cwd ?? ""}
                  onChange={(e) => update(m.id, { cwd: e.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                URL
                <input
                  aria-label="MCP URL"
                  placeholder="http://localhost:3000/mcp"
                  value={m.url}
                  onChange={(e) => update(m.id, { url: e.target.value })}
                />
              </label>
              <label>
                {t("访问令牌（可选）", "Access token (optional)")}
                <input
                  aria-label="MCP token"
                  type="password"
                  value={m.token}
                  onChange={(e) => update(m.id, { token: e.target.value })}
                />
              </label>
            </>
          )}
          <div className="actions">
            <label className="toggle">
              <input
                type="checkbox"
                checked={m.enabled}
                onChange={(e) => update(m.id, { enabled: e.target.checked })}
              />
              {t("启用", "Enabled")}
            </label>
            <button
              disabled={!!busy || !m.enabled}
              onClick={() =>
                void act(t("测试连接", "Testing connection"), async () => {
                  const client = await connectMcp(parse(m));
                  try {
                    const tools = await client.listTools();
                    notify(
                      t(
                        `连接成功：${tools.tools.length} 个工具`,
                        `Connected: ${tools.tools.length} tools`,
                      ),
                    );
                  } finally {
                    await client.close();
                  }
                })
              }
            >
              {t("测试连接", "Test connection")}
            </button>
            <button
              className="danger"
              onClick={() =>
                void confirmation.request(
                  t(
                    `移除 MCP 配置「${m.name}」？确认后自动保存。`,
                    `Remove MCP configuration "${m.name}"? Confirm to save automatically.`,
                  ),
                  async () =>
                    setDevice((current) => ({
                      ...current,
                      mcp: current.mcp.filter((x) => x.id !== m.id),
                    })),
                )
              }
            >
              {t("移除", "Remove")}
            </button>
          </div>
        </section>
      ))}
      <div className="actions">
        <button
          onClick={() =>
            setDevice({
              ...device,
              mcp: [
                ...device.mcp,
                {
                  id: crypto.randomUUID(),
                  name: "MCP",
                  transport: "http",
                  url: "",
                  token: "",
                  enabled: false,
                },
              ],
            })
          }
        >
          {t("添加 MCP", "Add MCP")}
        </button>
      </div>
      {confirmation.dialog}
    </>
  );
}
