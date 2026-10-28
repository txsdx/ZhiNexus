/** Shared real SSE fixture and repository access for browser integration tests. */
import { expect, type Page } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
/** Inspect application repositories without adding production test hooks. */
export async function repository<T>(page: Page, code: string): Promise<T> {
  await expect(page.locator(".app-shell")).toBeVisible();
  return page.evaluate(async (source) => {
    const { store } = await import("/src/core/store.ts" as string);
    return new Function("store", `return (async()=>{${source}})()`)(store);
  }, code);
}
/** An actual chunked HTTP service prevents a buffered route fixture from falsely proving streaming. */
export async function streamingServer(
  handle: (
    body: { messages: { role: string; content: string }[]; stream?: boolean },
    res: ServerResponse,
  ) => void,
) {
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      res.flushHeaders();
      const body = JSON.parse(raw);
      if (isTitleRequest(body)) {
        delta(res, JSON.stringify({ title: "自动生成的对话标题" }));
        done(res);
        return;
      }
      handle(body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
/** Emit one real Chat Completions delta. */
export function delta(res: ServerResponse, text: string) {
  res.write(
    "data: " +
      JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }) +
      "\n\n",
  );
}
/** Finish a stream explicitly so truncated responses remain inapplicable. */
export function done(res: ServerResponse) {
  res.end(
    "data: " +
      JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }) +
      "\n\ndata: [DONE]\n\n",
  );
}
/** Configure raw IDs and an ordinary local fixture key. */
export async function configure(page: Page, url: string, concurrency = 2) {
  await repository(
    page,
    `const ai=structuredClone(store.getSnapshot().ai);ai.baseUrl=${JSON.stringify(url)};ai.defaultModel='raw-stream-model';await store.saveAI(ai);await store.updateDevice({apiKey:'stream-key-sentinel',apiKeyEndpoint:ai.baseUrl,aiConcurrency:${concurrency},syncMinutes:0});`,
  );
}

/** Distinguish the metadata-only title request from the user conversation. */
export function isTitleRequest(body: { messages?: { content?: unknown }[] }) {
  return (
    typeof body.messages?.[0]?.content === "string" &&
    body.messages[0].content.startsWith("为这段对话生成一个简短")
  );
}
