/** Bounded OpenAI-compatible SSE decoding, including UTF-8 splits and fragmented tool calls. */
import { createParser } from "eventsource-parser";
import { z } from "zod";
import type { ToolCall } from "./types";
/** Incremental response exposed to the chat and task queue; partial tool calls are never executable. */
export interface AIStreamSnapshot {
  content: string;
  reasoning: string;
  calls: ToolCall[];
}
const callsSchema = z.array(
  z.object({
    id: z.string().min(1),
    type: z.literal("function"),
    function: z.object({ name: z.string().min(1), arguments: z.string() }),
  }),
);
const fullSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          reasoning_content: z.string().nullish(),
          reasoning: z.string().nullish(),
          tool_calls: callsSchema.nullish(),
        }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
});
/** Keep successful non-streaming responses compatible, including providers returning tool_calls:null. */
export function normalizeAIResponse(input: unknown): AIStreamSnapshot {
  const data = fullSchema.parse(input),
    choice = data.choices[0];
  if (
    choice.finish_reason === "length" ||
    choice.finish_reason === "content_filter"
  )
    throw Error(
      "AI 输出未完整结束 / Incomplete AI output: " + choice.finish_reason,
    );
  return {
    content: choice.message.content ?? "",
    reasoning:
      choice.message.reasoning_content ?? choice.message.reasoning ?? "",
    calls: choice.message.tool_calls ?? [],
  };
}
/** Consume actual provider chunks; abrupt EOF, invalid JSON and stream errors never become applicable results. */
export async function readAIStream(
  response: Response,
  signal: AbortSignal | undefined,
  onProgress: (snapshot: AIStreamSnapshot) => void,
  onEvents: (events: unknown[]) => void,
): Promise<AIStreamSnapshot> {
  if (!response.body)
    throw Error("AI 流式响应没有数据体 / Missing response stream");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let content = "",
    reasoning = "",
    done = false,
    finished = false,
    bytes = 0,
    error: unknown,
    events: unknown[] = [],
    eventBytes = 0,
    lastLog = 0;
  const calls = new Map<number, ToolCall>();
  const snapshot = () => ({
    content,
    reasoning,
    calls: [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => structuredClone(v)),
  });
  const parser = createParser({
    onEvent(event) {
      if (done) return;
      if (event.data.trim() === "[DONE]") {
        done = true;
        return;
      }
      try {
        const data = JSON.parse(event.data);
        if (eventBytes < 96000) {
          events.push(data);
          eventBytes += event.data.length;
        } else if (
          !events.some((e) => (e as { truncated?: boolean })?.truncated)
        )
          events.push({ truncated: true });
        if (data.error)
          throw Error(
            typeof data.error.message === "string"
              ? data.error.message
              : "AI stream error",
          );
        if (!Array.isArray(data.choices))
          throw Error("Invalid streamed choices");
        const choice = data.choices.find(
          (c: { index?: number }) => (c.index ?? 0) === 0,
        );
        if (!choice) return;
        const delta = choice.delta ?? {};
        if (delta.content != null) {
          if (typeof delta.content !== "string")
            throw Error("Invalid content delta");
          content += delta.content;
        }
        for (const value of [delta.reasoning_content, delta.reasoning])
          if (value != null) {
            if (typeof value !== "string")
              throw Error("Invalid reasoning delta");
            reasoning += value;
          }
        if (delta.tool_calls != null) {
          if (!Array.isArray(delta.tool_calls))
            throw Error("Invalid tool delta");
          for (const fragment of delta.tool_calls) {
            if (
              !Number.isInteger(fragment.index) ||
              fragment.index < 0 ||
              fragment.index > 127
            )
              throw Error("Invalid tool index");
            const call = calls.get(fragment.index) ?? {
              id: "",
              type: "function",
              function: { name: "", arguments: "" },
            };
            if (fragment.type && fragment.type !== "function")
              throw Error("Unsupported tool type");
            for (const [key, value] of Object.entries(
              fragment.function ?? {},
            )) {
              if (!["name", "arguments"].includes(key)) continue;
              if (typeof value !== "string")
                throw Error("Invalid tool fragment");
              call.function[key as "name" | "arguments"] += value;
            }
            if (fragment.id != null) {
              if (typeof fragment.id !== "string")
                throw Error("Invalid tool id");
              call.id += fragment.id;
            }
            calls.set(fragment.index, call);
          }
        }
        if (choice.finish_reason) {
          if (
            !["stop", "tool_calls", "function_call"].includes(
              choice.finish_reason,
            )
          )
            throw Error(
              "AI 输出未完整结束 / Incomplete AI output: " +
                choice.finish_reason,
            );
          finished = true;
        }
        onProgress(snapshot());
        if (Date.now() - lastLog > 300) {
          onEvents(events);
          lastLog = Date.now();
        }
      } catch (e) {
        if (eventBytes < 96000) {
          events.push({
            invalid_data: event.data.slice(0, 96000 - eventBytes),
          });
          eventBytes += event.data.length;
        }
        error = e;
      }
    },
    onError(e) {
      error = e;
    },
    maxBufferSize: 2 * 1024 * 1024,
  });
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (!done) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) {
        parser.feed(decoder.decode());
        parser.reset({ consume: true });
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 4 * 1024 * 1024)
        throw Error("AI 流式响应超过 4 MiB / Response exceeds 4 MiB");
      parser.feed(decoder.decode(chunk.value, { stream: true }));
      if (error) throw error;
    }
    if (error) throw error;
    if (!done && !finished)
      throw Error(
        "AI 流式响应意外中断，结果未应用 / Stream interrupted before completion",
      );
    const result = snapshot();
    if (!result.content && !result.calls.length)
      throw Error("AI 流式响应没有正文或工具调用 / Empty AI stream");
    callsSchema.parse(result.calls);
    onProgress(result);
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
    onEvents(events);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
