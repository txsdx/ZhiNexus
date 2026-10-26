/** Shared authenticated transport with system-trusted TLS, device proxies and credential-safe diagnostics. */
import { native } from "../core/database";
import { store } from "../core/store";
import { currentProxyOptions } from "./proxy";
/** Keep WebDAV strictly HTTPS and reject credentials embedded in service addresses. */
export function secureUrl(input: string): URL {
  const u = serviceUrl(input);
  if (u.protocol !== "https:")
    throw Error("WebDAV 需要 HTTPS 地址 / HTTPS required");
  return u;
}
/** HTTP and HTTPS are supported for explicitly configured AI/MCP endpoints; transport credentials use separate fields. */
export function serviceUrl(input: string): URL {
  const u = new URL(input.trim());
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hash ||
    u.search
  )
    throw Error(
      "请输入无内嵌凭证和查询参数的 HTTP/HTTPS 地址 / Enter an HTTP(S) service URL without embedded credentials",
    );
  return u;
}
/** Accept a base URL or a pasted standard endpoint without duplicating /models or /chat/completions. */
export function apiBaseUrl(input: string): string {
  const u = serviceUrl(input);
  u.pathname = u.pathname
    .replace(/\/(?:chat\/completions|images\/generations|models)\/?$/, "")
    .replace(/\/+$/, "");
  return u.href.replace(/\/$/, "");
}
/** Remove copied header prefixes and report invalid whitespace before a request reaches the HTTP library. */
export function normalizeApiKey(input: string): string {
  const key = input
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (/\s/.test(key))
    throw Error(
      "API Key 中包含空格或换行，请只填写密钥 / API key contains whitespace",
    );
  return key;
}
/** Keep useful native TLS/proxy/DNS errors while removing secrets and URL query strings. */
export function safeNetworkError(
  error: unknown,
  secrets: string[] = [],
): string {
  let value =
    error instanceof Error
      ? [error.message, (error.cause as Error | undefined)?.message]
          .filter(Boolean)
          .join(": ")
      : typeof error === "string"
        ? error
        : "连接未完成 / Connection failed";
  value = value
    .replace(/(?:https?|socks5h?):\/\/[^\s)<>"']+/g, (raw) => {
      try {
        const u = new URL(raw);
        return u.origin === "null"
          ? `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`
          : u.origin + u.pathname;
      } catch {
        return "[URL]";
      }
    })
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  for (const secret of secrets
    .filter((v) => v.length >= 3)
    .sort((a, b) => b.length - a.length))
    value = value.split(secret).join("[redacted]");
  return value.slice(0, 1200);
}
/** Use one native client policy; release discovery can select its own bounded public redirect policy. */
export async function nativeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  maxRedirections = 0,
): Promise<Response> {
  const { fetch } = await import("@tauri-apps/plugin-http");
  const proxy = await currentProxyOptions();
  return fetch(input, {
    ...init,
    ...proxy,
    connectTimeout: 15000,
    maxRedirections,
  });
}
/** Follow only same-origin redirects, preserving cancellation and never forwarding authentication to a different service. */
export async function request(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeout = 60000,
): Promise<Response> {
  let req = new Request(input, init);
  const deadline = timeout > 0 ? AbortSignal.timeout(timeout) : undefined;
  const signals = [req.signal, init.signal, deadline].filter(
    (s): s is AbortSignal => !!s,
  );
  const signal = signals.length ? AbortSignal.any(signals) : undefined;
  const device = store.getSnapshot().device;
  for (let hop = 0; hop < 4; hop++) {
    let response: Response;
    try {
      const options = {
        redirect: "manual" as RequestRedirect,
        ...(signal ? { signal } : {}),
      };
      response = native
        ? await nativeFetch(req.clone(), options)
        : await fetch(req.clone(), options);
    } catch (error) {
      const details = safeNetworkError(error, [
        device.apiKey,
        device.davPassword,
        device.proxy?.password ?? "",
        ...device.mcp.map((m) => m.token),
      ]);
      const category = /cert|issuer|tls|ssl/i.test(details)
        ? "TLS 证书 / TLS certificate"
        : /proxy|socks|tunnel/i.test(details)
          ? "代理 / Proxy"
          : /timeout|abort/i.test(details)
            ? "超时或取消 / Timeout or cancelled"
            : /permission|scope|not allowed|not permitted/i.test(details)
              ? "网络权限 / Network permission"
              : /dns|resolve|name or service/i.test(details)
                ? "DNS"
                : "网络连接 / Network connection";
      throw Error(
        `${category}：${details}${native ? "" : "；浏览器还可能受 CORS 或混合内容限制，可使用原生客户端 / Browser CORS or mixed-content restrictions may apply"}`,
      );
    }
    if (response.type === "opaqueredirect")
      throw Error(
        "浏览器无法读取跳转，请填写最终接口地址 / Enter the final endpoint URL",
      );
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const next = new URL(location, req.url),
      old = new URL(req.url);
    if (
      next.origin !== old.origin ||
      next.username ||
      next.password ||
      next.hash
    )
      throw Error(
        "已阻止跨服务跳转，避免泄露凭证；请使用最终接口地址 / Cross-origin redirect blocked",
      );
    if (hop === 3) throw Error("接口跳转次数过多 / Too many service redirects");
    const nextInit: RequestInit = { method: req.method, headers: req.headers };
    if (
      response.status === 303 ||
      ([301, 302].includes(response.status) && req.method === "POST")
    )
      nextInit.method = "GET";
    else if (!["GET", "HEAD"].includes(req.method))
      nextInit.body = await req.clone().arrayBuffer();
    await response.body?.cancel();
    req = new Request(next, nextInit);
  }
  throw Error("接口跳转失败 / Service redirect failed");
}
/** Limit memory usage for server-controlled payloads. */
export async function boundedText(
  res: Response,
  max = 24 * 1024 * 1024,
): Promise<string> {
  if (Number(res.headers.get("content-length")) > max)
    throw Error("响应超过大小限制");
  const reader = res.body?.getReader();
  if (!reader) {
    const t = await res.text();
    if (t.length > max) throw Error("响应过大");
    return t;
  }
  let size = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw Error("响应超过大小限制");
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return new TextDecoder().decode(all);
}
/** Decode API responses without including provider response bodies or credentials in errors. */
export async function responseJson(res: Response): Promise<unknown> {
  if (!res.ok)
    throw Error(
      `服务返回 HTTP ${res.status}${res.status === 401 ? "：API Key 未通过认证 / Invalid API key" : res.status === 407 ? "：代理认证失败 / Proxy authentication failed" : ""}`,
    );
  try {
    return JSON.parse(await boundedText(res));
  } catch (e) {
    if (e instanceof SyntaxError) throw Error("服务未返回有效 JSON");
    throw e;
  }
}
