/** Task-specific OpenAI-compatible chat and image execution with capability-aware parameters. */
import { flushAISettings } from "./settings";
import { diagnostics, traceAI, diagnosticJson } from "./diagnostics";
import { diagnosticText } from "../core/diagnostics";
import { notifyCompletion } from "./notifications";
import { z } from "zod";
import { store } from "../core/store";
import { resolveModel } from "../core/ai-config";
import type { Message, Task, ToolCall } from "../core/types";
import { request, secureUrl, apiBaseUrl, normalizeApiKey } from "./network";
/** Substitute named variables literally; unknown variables are left visible to the user. */
export function renderPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (all, key) => vars[key] ?? all);
}
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
/** Keep all features on the same request path and omit undeclared reasoning options. */
export async function complete(
  task: Task,
  messages: Message[],
  tools?: ToolSpec[],
  override?: { model: string; effort: string },
  image?: string,
): Promise<{ content: string; calls: ToolCall[] }> {
  await flushAISettings();
  const { ai, device } = store.getSnapshot(),
    config = {
      ...ai.tasks[task],
      ...override,
      model: resolveModel(ai, task, override?.model),
    };
  return traceAI(task, config.model, async (logId) => {
    if (!config.model) throw Error("请先在设置中为此功能选择模型");
    if (!device.apiKey) throw Error("请在本设备配置 API Key");
    if (
      device.apiKeyEndpoint &&
      apiBaseUrl(device.apiKeyEndpoint) !== apiBaseUrl(ai.baseUrl)
    )
      throw Error(
        "API Key 属于另一接口，请在 AI 设置中重新输入密钥 / API key belongs to another endpoint; edit the key in AI settings",
      );
    const model = ai.models.find((m) => m.id === config.model);
    const body: Record<string, unknown> = { model: config.model, messages };
    if (image) {
      if (
        task !== "ocr" ||
        !image.startsWith("data:image/png;base64,") ||
        image.length > 32 * 1024 * 1024
      )
        throw Error("Invalid OCR image");
      body.messages = messages.map((message, i) =>
        i === messages.length - 1 && message.role === "user"
          ? {
              ...message,
              content: [
                { type: "text", text: message.content },
                { type: "image_url", image_url: { url: image } },
              ],
            }
          : message,
      );
    }
    if (model?.efforts.includes(config.effort))
      body.reasoning_effort = config.effort;
    if (tools?.length && model?.tools !== false) body.tools = tools;
    diagnostics.update(logId, {
      request: diagnosticText({
        url: apiBaseUrl(ai.baseUrl) + "/chat/completions",
        body,
      }),
    });
    const res = await request(
      apiBaseUrl(ai.baseUrl) + "/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + normalizeApiKey(device.apiKey),
        },
        body: JSON.stringify(body),
      },
      180000,
    );
    const data = z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({
                content: z.string().nullable().optional(),
                tool_calls: z
                  .array(
                    z.object({
                      id: z.string(),
                      type: z.literal("function"),
                      function: z.object({
                        name: z.string(),
                        arguments: z.string(),
                      }),
                    }),
                  )
                  .nullish(),
              }),
            }),
          )
          .min(1),
      })
      .parse(await diagnosticJson(res, logId));
    return {
      content: data.choices[0].message.content ?? "",
      calls: data.choices[0].message.tool_calls ?? [],
    };
  });
}
/** Execute a template-backed feature with structured output validation at the caller boundary. */
export async function runTask(
  task: Task,
  vars: Record<string, string>,
): Promise<string> {
  await flushAISettings();
  const prompt = store.getSnapshot().ai.tasks[task].prompt;
  const result = (
    await complete(task, [
      { role: "user", content: renderPrompt(prompt, vars) },
    ])
  ).content;
  void notifyCompletion("ai", result).catch(() => {});
  return result;
}
/** Accept a single optional JSON fence, but never try to salvage malformed partial model output. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
  } catch (error) {
    diagnostics.error(
      "ai",
      "结构化 AI 输出无效 / Invalid structured AI output",
      { error: String(error), response: text },
    );
    throw error;
  }
}
/** Generate an image and import bytes into the same content-addressed attachment store. */
export async function generateImage(prompt: string): Promise<string> {
  await flushAISettings();
  const { ai, device } = store.getSnapshot();
  const model = resolveModel(ai, "image");
  return traceAI("image", model, async (logId) => {
    if (!model || !device.apiKey) throw Error("请先配置图片模型和 API Key");
    if (
      device.apiKeyEndpoint &&
      apiBaseUrl(device.apiKeyEndpoint) !== apiBaseUrl(ai.baseUrl)
    )
      throw Error(
        "API Key 属于另一接口，请在 AI 设置中重新输入密钥 / API key belongs to another endpoint; edit the key in AI settings",
      );
    diagnostics.update(logId, {
      request: diagnosticText({
        url: apiBaseUrl(ai.baseUrl) + "/images/generations",
        body: { model, prompt, n: 1 },
      }),
    });
    const res = await request(
      apiBaseUrl(ai.baseUrl) + "/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + normalizeApiKey(device.apiKey),
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
        }),
      },
      180000,
    );
    const data = z
      .object({
        data: z
          .array(
            z.object({
              b64_json: z.string().nullish(),
              url: z.string().nullish(),
            }),
          )
          .min(1),
      })
      .parse(await diagnosticJson(res, logId));
    const first = data.data[0];
    let bytes: Uint8Array;
    if (first.b64_json) {
      const { unbase64 } = await import("../core/crypto");
      bytes = unbase64(first.b64_json);
    } else if (first.url) {
      secureUrl(first.url.split("?")[0]);
      const r = await request(first.url);
      if (!r.ok) throw Error("无法下载生成图片");
      const b = await r.blob();
      if (b.size > 20 * 1024 * 1024) throw Error("图片过大");
      bytes = new Uint8Array(await b.arrayBuffer());
    } else throw Error("图片响应为空");
    const hash = await store.db.putBlob(bytes, "image/png");
    void notifyCompletion("ai", "配图已生成 / Illustration ready").catch(
      () => {},
    );
    return hash;
  });
}
