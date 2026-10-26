/** Transport regressions: endpoint normalization, proxy policy, request payloads, redirects and safe diagnostics. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiBaseUrl,
  normalizeApiKey,
  request,
  safeNetworkError,
  secureUrl,
} from "./network";
import { defaultProxy, normalizeProxy, proxyClientOptions } from "./proxy";
afterEach(() => vi.unstubAllGlobals());
describe("provider networking", () => {
  it("accepts pasted endpoints and local HTTP while retaining HTTPS-only WebDAV", () => {
    expect(apiBaseUrl(" http://localhost:8317/v1/chat/completions/ ")).toBe(
      "http://localhost:8317/v1",
    );
    expect(normalizeApiKey(" Bearer example-key \n")).toBe("example-key");
    expect(() => secureUrl("http://dav.example/root")).toThrow("HTTPS");
    expect(() => apiBaseUrl("https://user:pass@example.com/v1")).toThrow();
  });
  it("preserves Request authentication, method and body for SDK callers", async () => {
    const fetcher = vi.fn(async (input: Request) => {
      expect(input.method).toBe("POST");
      expect(input.headers.get("authorization")).toBe("Bearer fixture");
      expect(await input.text()).toBe('{"hello":"world"}');
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetcher);
    const req = new Request("https://api.example/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer fixture" },
      body: '{"hello":"world"}',
    });
    expect(await (await request(req)).text()).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("blocks credential forwarding to another origin", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 307,
          headers: { Location: "https://other.example/steal" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      request("https://api.example/v1", {
        headers: { Authorization: "Bearer fixture" },
      }),
    ).rejects.toThrow("Cross-origin");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains a same-origin 307 POST body and propagates cancellation from Request", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request, init: RequestInit) => {
        if (!calls++)
          return new Response(null, {
            status: 307,
            headers: { Location: "/final" },
          });
        expect(await input.text()).toBe("payload");
        expect(input.url).toBe("https://api.example/final");
        expect(init.signal?.aborted).toBe(false);
        return new Response("ok");
      }),
    );
    await request(
      new Request("https://api.example/start", {
        method: "POST",
        body: "payload",
      }),
    );
    expect(calls).toBe(2);
  });
  it("redacts proxy userinfo, query secrets, bearer tokens and configured keys", () => {
    const result = safeNetworkError(
      Error(
        "TLS https://name:password@example.com/v1?token=hidden Bearer api-secret proxy-password",
      ),
      ["proxy-password"],
    );
    expect(result).toContain("TLS https://example.com/v1");
    for (const secret of [
      "name:password",
      "hidden",
      "api-secret",
      "proxy-password",
    ])
      expect(result).not.toContain(secret);
  });
});
describe("device proxy", () => {
  it("maps HTTP authentication and SOCKS remote-DNS settings onto the native public API", () => {
    expect(
      normalizeProxy({ ...defaultProxy, mode: "socks5", url: "localhost:1080" })
        .url,
    ).toBe("socks5h://localhost:1080");
    expect(
      proxyClientOptions({
        ...defaultProxy,
        mode: "http",
        url: "http://127.0.0.1:8080",
        username: "test",
        password: "fixture",
      }),
    ).toMatchObject({
      proxy: { all: { basicAuth: { username: "test", password: "fixture" } } },
    });
    expect(() =>
      normalizeProxy({
        ...defaultProxy,
        mode: "http",
        url: "http://user:secret@proxy.example:8080",
      }),
    ).toThrow();
  });
});
