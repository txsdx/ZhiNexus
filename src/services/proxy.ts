/** One device proxy policy for provider, synchronization, MCP, assets and release downloads. */
import type { ProxySettings } from "../core/types";
import { native } from "../core/database";
import { store } from "../core/store";
export const defaultProxy: ProxySettings = {
  mode: "system",
  url: "",
  username: "",
  password: "",
  bypass: "localhost,127.0.0.1,::1",
};
/** Validate proxy endpoints without placing credentials in the URL or returning them in diagnostics. */
export function normalizeProxy(value: ProxySettings): ProxySettings {
  if (!["system", "http", "socks5"].includes(value.mode))
    throw Error("代理类型无效 / Invalid proxy mode");
  if (value.mode === "system") return { ...value, url: "" };
  const raw = value.url.trim();
  const url = new URL(
    raw.includes("://")
      ? raw
      : `${value.mode === "socks5" ? "socks5h" : "http"}://${raw}`,
  );
  const allowed =
    value.mode === "http" ? ["http:", "https:"] : ["socks5:", "socks5h:"];
  if (
    !allowed.includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw Error(
      "代理地址应为主机和端口，用户名密码请单独填写 / Use a proxy host and port with separate credentials",
    );
  return {
    ...value,
    url: url.href.replace(/\/$/, ""),
    bypass: value.bypass.trim(),
  };
}
/** Translate the shared policy into the maintained Tauri HTTP plugin's stable public client options. */
export function proxyClientOptions(value: ProxySettings) {
  const p = normalizeProxy(value);
  return p.mode === "system"
    ? {}
    : {
        proxy: {
          all: {
            url: p.url,
            noProxy: p.bypass,
            ...(p.username || p.password
              ? { basicAuth: { username: p.username, password: p.password } }
              : {}),
          },
        },
      };
}
let applied = "";
let tail: Promise<unknown> = Promise.resolve();
/** Keep the native updater's client in the same policy as fetch, including after an encrypted device-settings restore. */
export async function ensureNativeProxy(
  value = store.getSnapshot().device.proxy ?? defaultProxy,
) {
  const config = normalizeProxy(value),
    key = JSON.stringify(config);
  if (!native || key === applied) return;
  const task = tail.then(async () => {
    if (key === applied) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("configure_network", { settings: config });
    applied = key;
  });
  tail = task.catch(() => {});
  await task;
}
/** Return current request options, refusing a browser-only preview that cannot honor a custom proxy. */
export async function currentProxyOptions() {
  const settings = store.getSnapshot().device.proxy ?? defaultProxy;
  if (!native && settings.mode !== "system")
    throw Error(
      "自定义代理需要原生客户端；浏览器使用其系统代理 / Custom proxies require the native app",
    );
  await ensureNativeProxy(settings);
  return proxyClientOptions(settings);
}
