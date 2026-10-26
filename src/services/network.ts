/** HTTPS-only authenticated transport; native requests avoid browser CORS without exposing a generic Rust proxy. */
import { native } from "../core/database";
/** Validate URLs before attaching credentials and prevent embedded authentication or query leakage. */
export function secureUrl(input: string): URL {
  const u = new URL(input);
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.search)
    throw Error("需要无内嵌凭证的 HTTPS 地址 / HTTPS required");
  return u;
}
/** Send a bounded request with redirects disabled, retaining normal TLS verification. */
export async function request(
  url: string,
  init: RequestInit = {},
  timeout = 60000,
): Promise<Response> {
  let response: Response;
  const options = {
    ...init,
    redirect: "error" as RequestRedirect,
    signal: AbortSignal.timeout(timeout),
  };
  try {
    if (native) {
      const { fetch } = await import("@tauri-apps/plugin-http");
      response = await fetch(url, { ...options, maxRedirections: 0 });
    } else response = await fetch(url, options);
  } catch {
    throw Error(
      "网络请求失败：检查 HTTPS、网络权限与服务端 CORS（原生端不受浏览器 CORS 限制）",
    );
  }
  return response;
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
  if (!res.ok) throw Error(`服务返回 HTTP ${res.status}`);
  try {
    return JSON.parse(await boundedText(res));
  } catch (e) {
    if (e instanceof SyntaxError) throw Error("服务未返回有效 JSON");
    throw e;
  }
}
