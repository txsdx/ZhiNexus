/** Task-specific OpenAI-compatible chat and image execution with capability-aware parameters. */
import { z } from "zod";
import { store } from "../core/store";
import type { Message, Task, ToolCall } from "../core/types";
import { request, responseJson, secureUrl } from "./network";
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
): Promise<{ content: string; calls: ToolCall[] }> {
  const { ai, device } = store.getSnapshot(),
    config = { ...ai.tasks[task], ...override };
  if (!config.model) throw Error("请先在设置中为此功能选择模型");
  if (!device.apiKey) throw Error("请在本设备配置 API Key");
  const model = ai.models.find((m) => m.id === config.model);
  const body: Record<string, unknown> = { model: config.model, messages };
  if (model?.efforts.includes(config.effort))
    body.reasoning_effort = config.effort;
  if (tools?.length && model?.tools === true) body.tools = tools;
  const res = await request(
    secureUrl(ai.baseUrl).href.replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + device.apiKey,
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
                .optional(),
            }),
          }),
        )
        .min(1),
    })
    .parse(await responseJson(res));
  return {
    content: data.choices[0].message.content ?? "",
    calls: data.choices[0].message.tool_calls ?? [],
  };
}
/** Execute a template-backed feature with structured output validation at the caller boundary. */
export async function runTask(
  task: Task,
  vars: Record<string, string>,
): Promise<string> {
  const prompt = store.getSnapshot().ai.tasks[task].prompt;
  return (
    await complete(task, [
      { role: "user", content: renderPrompt(prompt, vars) },
    ])
  ).content;
}
/** Accept a single optional JSON fence, but never try to salvage malformed partial model output. */
export function parseJson(text: string): unknown {
  return JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, ""),
  );
}
/** Generate an image and import bytes into the same content-addressed attachment store. */
export async function generateImage(prompt: string): Promise<string> {
  const { ai, device } = store.getSnapshot();
  if (!ai.tasks.image.model || !device.apiKey)
    throw Error("请先配置图片模型和 API Key");
  const res = await request(
    secureUrl(ai.baseUrl).href.replace(/\/$/, "") + "/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + device.apiKey,
      },
      body: JSON.stringify({
        model: ai.tasks.image.model,
        prompt,
        n: 1,
        response_format: "b64_json",
      }),
    },
    180000,
  );
  const data = z
    .object({
      data: z
        .array(
          z.object({
            b64_json: z.string().optional(),
            url: z.string().optional(),
          }),
        )
        .min(1),
    })
    .parse(await responseJson(res));
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
  return store.db.putBlob(bytes, "image/png");
}
