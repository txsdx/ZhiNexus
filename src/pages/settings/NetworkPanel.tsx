/** Global per-device system/HTTP/SOCKS5 proxy configuration shared by all native transports. */
import { native } from "../../core/database";
import { store } from "../../core/store";
import {
  defaultProxy,
  normalizeProxy,
  ensureNativeProxy,
} from "../../services/proxy";
import { useSettings } from "./context";
/** Keep proxy credentials local and apply changes to both fetch and native release downloads. */
export function NetworkPanel() {
  const { t, device, setDevice, busy, act, notify } = useSettings();
  const proxy = { ...defaultProxy, ...device.proxy };
  const update = (patch: Partial<typeof proxy>) =>
    setDevice({ ...device, proxy: { ...proxy, ...patch } });
  return (
    <>
      <h2>{t("整个应用使用同一代理", "One proxy policy for the whole app")}</h2>
      <p className="muted">
        {t(
          "覆盖 AI、模型目录、MCP HTTP/SSE、WebDAV、图片下载和软件更新。代理设置按设备保存。",
          "Applies to AI, model catalogs, MCP HTTP/SSE, WebDAV, images and updates. Proxy settings stay on each device.",
        )}
      </p>
      <label>
        {t("代理方式", "Proxy mode")}
        <select
          value={proxy.mode}
          onChange={(e) =>
            update({ mode: e.target.value as typeof proxy.mode })
          }
        >
          <option value="system">{t("系统代理", "System proxy")}</option>
          <option value="http">HTTP / HTTPS</option>
          <option value="socks5">SOCKS5</option>
        </select>
      </label>
      {proxy.mode !== "system" && (
        <>
          <label>
            {t("代理服务器", "Proxy server")}
            <input
              value={proxy.url}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="127.0.0.1:7890"
            />
          </label>
          <div className="form-grid">
            <label>
              {t("用户名（可选）", "Username (optional)")}
              <input
                autoComplete="off"
                value={proxy.username}
                onChange={(e) => update({ username: e.target.value })}
              />
            </label>
            <label>
              {t("密码（可选）", "Password (optional)")}
              <input
                type="password"
                autoComplete="off"
                value={proxy.password}
                onChange={(e) => update({ password: e.target.value })}
              />
            </label>
          </div>
          <label>
            {t(
              "不使用代理的主机（逗号分隔）",
              "Bypass hosts (comma-separated)",
            )}
            <input
              value={proxy.bypass}
              onChange={(e) => update({ bypass: e.target.value })}
            />
          </label>
        </>
      )}
      {!native && (
        <p className="notice">
          {t(
            "浏览器预览由浏览器管理代理；自定义代理请使用原生客户端。",
            "Browser previews use the browser's proxy. Use the native app for custom proxies.",
          )}
        </p>
      )}
      <button
        className="primary"
        disabled={!!busy || (!native && proxy.mode !== "system")}
        onClick={() =>
          void act(t("应用代理配置", "Applying proxy settings"), async () => {
            const value = normalizeProxy(proxy);
            await ensureNativeProxy(value);
            await store.saveDevice({
              ...store.getSnapshot().device,
              proxy: value,
            });
            notify(t("全局代理已应用", "Global proxy applied"));
          })
        }
      >
        {t("保存并应用", "Save and apply")}
      </button>
    </>
  );
}
