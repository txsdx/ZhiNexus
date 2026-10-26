/** Mcp configuration panel with explicit persistence and verification. */
import { store } from "../../core/store";
import { useSettings } from "./context";
/** McpPanel exposes one focused settings workflow. */
export function McpPanel() {
  const { t, device, setDevice, act } = useSettings();
  return (
    <>
      <h2>{t("连接外部工具", "Connect external tools")}</h2>
      <p className="muted">
        {t(
          "支持 HTTPS Streamable HTTP MCP，采用官方 SDK。默认关闭；Agent 每次执行外部工具都要求确认。暂不执行 stdio 命令。",
          "Uses the official SDK for HTTPS Streamable HTTP MCP. Disabled by default; every tool execution requires confirmation. Stdio commands are not executed.",
        )}
      </p>
      {device.mcp.map((m, i) => (
        <section className="mcp-card" key={m.id}>
          <input
            aria-label="MCP name"
            value={m.name}
            onChange={(e) =>
              setDevice({
                ...device,
                mcp: device.mcp.map((x, j) =>
                  i === j ? { ...x, name: e.target.value } : x,
                ),
              })
            }
          />
          <input
            aria-label="MCP URL"
            placeholder="https://mcp.example.com/mcp"
            value={m.url}
            onChange={(e) =>
              setDevice({
                ...device,
                mcp: device.mcp.map((x, j) =>
                  i === j ? { ...x, url: e.target.value } : x,
                ),
              })
            }
          />
          <input
            aria-label="MCP token"
            type="password"
            placeholder="Bearer token (optional, device only)"
            value={m.token}
            onChange={(e) =>
              setDevice({
                ...device,
                mcp: device.mcp.map((x, j) =>
                  i === j ? { ...x, token: e.target.value } : x,
                ),
              })
            }
          />
          <div className="actions">
            <label className="toggle">
              <input
                type="checkbox"
                checked={m.enabled}
                onChange={(e) =>
                  setDevice({
                    ...device,
                    mcp: device.mcp.map((x, j) =>
                      i === j ? { ...x, enabled: e.target.checked } : x,
                    ),
                  })
                }
              />
              {t("启用", "Enabled")}
            </label>
            <button
              className="danger"
              onClick={() =>
                setDevice({
                  ...device,
                  mcp: device.mcp.filter((x) => x.id !== m.id),
                })
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
                  url: "",
                  enabled: false,
                  token: "",
                },
              ],
            })
          }
        >
          {t("添加 MCP", "Add MCP")}
        </button>
        <button
          className="primary"
          onClick={() =>
            void act(t("保存 MCP", "Saving MCP"), () =>
              store.saveDevice({
                ...store.getSnapshot().device,
                mcp: device.mcp,
              }),
            )
          }
        >
          {t("保存 MCP 配置", "Save MCP configuration")}
        </button>
      </div>
    </>
  );
}
