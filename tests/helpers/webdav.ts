/** A shared WebDAV protocol fixture with real gzip bytes, ETags and atomic conditional writes. */
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { BrowserContext, Page } from "@playwright/test";
/** Let tests delay transfers without bypassing the real client protocol or serialization. */
export interface DavHooks {
  beforeWrite?: (path: string) => Promise<void>;
  beforeRead?: (path: string) => Promise<void>;
  beforeDelete?: (path: string) => Promise<void>;
  deleteStatus?: (path: string) => number | undefined;
}
/** Store logical text for inspectable corruption tests, while transporting genuine compressed binary payloads. */
export async function mockWebDAV(
  target: BrowserContext | Page,
  files: Map<string, string>,
  hooks: DavHooks = {},
) {
  const etag = (body: string) =>
    '"' + createHash("sha256").update(body).digest("hex") + '"';
  await target.route("https://dav.example/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.slice("/knowledge/".length),
      method = request.method();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods":
        "GET, PUT, DELETE, MKCOL, PROPFIND, OPTIONS",
      "access-control-expose-headers": "ETag",
    };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (method === "MKCOL") return route.fulfill({ status: 201, headers });
    if (method === "PROPFIND") {
      const prefix = path.replace(/\/$/, "") + "/",
        names = [...files.keys()].filter(
          (name) =>
            name.startsWith(prefix) && !name.slice(prefix.length).includes("/"),
        );
      return route.fulfill({
        status: 207,
        headers,
        contentType: "application/xml",
        body:
          '<d:multistatus xmlns:d="DAV:">' +
          names
            .map(
              (name) =>
                "<d:response><d:href>/knowledge/" +
                name +
                "</d:href></d:response>",
            )
            .join("") +
          "</d:multistatus>",
      });
    }
    if (method === "PUT") {
      await hooks.beforeWrite?.(path);
      const current = files.get(path),
        conditions = request.headers();
      if (
        (conditions["if-none-match"] === "*" && current !== undefined) ||
        (conditions["if-match"] !== undefined &&
          (current === undefined || conditions["if-match"] !== etag(current)))
      )
        return route.fulfill({ status: 412, headers });
      const bytes = request.postDataBuffer() ?? Buffer.alloc(0),
        body = path.endsWith(".json.gz")
          ? gunzipSync(bytes).toString("utf8")
          : path.endsWith(".bin")
            ? "\0binary:" + bytes.toString("base64")
            : bytes.toString("utf8");
      files.set(path, body);
      return route.fulfill({
        status: current === undefined ? 201 : 200,
        headers: { ...headers, etag: etag(body) },
      });
    }
    if (method === "DELETE") {
      await hooks.beforeDelete?.(path);
      const rejected = hooks.deleteStatus?.(path);
      if (rejected)
        return route.fulfill({
          status: rejected,
          headers,
          body: "Injected deletion failure",
        });
      const existed = files.delete(path);
      if (path.endsWith("/"))
        for (const name of [...files.keys()])
          if (name.startsWith(path)) files.delete(name);
      return route.fulfill({ status: existed ? 204 : 404, headers });
    }
    await hooks.beforeRead?.(path);
    const body = files.get(path);
    if (body === undefined)
      return route.fulfill({ status: 404, headers, body: "" });
    return route.fulfill({
      status: 200,
      headers: { ...headers, etag: etag(body) },
      contentType: path.endsWith(".json.gz")
        ? "application/gzip"
        : path.endsWith(".bin")
          ? "application/octet-stream"
          : "application/json",
      body: body.startsWith("\0binary:")
        ? Buffer.from(body.slice(8), "base64")
        : path.endsWith(".json.gz")
          ? gzipSync(body)
          : body,
    });
  });
}
