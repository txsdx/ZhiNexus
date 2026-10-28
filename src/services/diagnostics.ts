/** Local diagnostic lifecycle and request tracing, with credentials excluded before any persistence. */
import { store } from "../core/store";
import {
  DiagnosticJournal,
  diagnosticText,
  type DiagnosticRecord,
} from "../core/diagnostics";
import { boundedText } from "./network";

/** Current secrets are used only for removal, never retained inside diagnostic records. */
function secrets() {
  const d = store.getSnapshot().device;
  return [
    d.apiKey,
    d.apiKeySyncKey ?? "",
    d.davPassword,
    d.proxy?.password ?? "",
    ...(Array.isArray(d.mcp)
      ? d.mcp.flatMap((m) => [m.token, ...Object.values(m.env ?? {})])
      : []),
  ].filter((value): value is string => typeof value === "string" && !!value);
}
/** Shared device-local journal used by the log page and all AI workflows. */
export const diagnostics = new DiagnosticJournal(secrets);
const requestSecrets = new Map<string, string[]>();

/** Initialize after SQLite is ready; log writes remain separate from the replicated event log. */
export async function initDiagnostics() {
  await diagnostics.init(
    () => store.db.local<DiagnosticRecord[]>("diagnostic-log", []),
    (rows) => store.db.setLocal("diagnostic-log", rows),
  );
}

/** Trace a whole AI workflow, retaining provider data even if validation or attachment import fails. */
export async function traceAI<T>(
  task: string,
  model: string,
  work: (id: string) => Promise<T>,
): Promise<T> {
  const id = diagnostics.start({
    kind: task === "models" ? "models" : "ai",
    task,
    model,
    message: task === "models" ? "模型目录 / Model catalog" : "AI " + task,
  });
  const start = Date.now();
  const activeSecrets = secrets();
  requestSecrets.set(id, activeSecrets);
  try {
    const result = await work(id);
    diagnostics.update(id, { level: "info", durationMs: Date.now() - start });
    return result;
  } catch (error) {
    const prior = diagnostics.getSnapshot().find((row) => row.id === id)?.error;
    diagnostics.update(id, {
      level: "error",
      error: [prior, diagnosticText(error, [...activeSecrets, ...secrets()])]
        .filter(Boolean)
        .join("\n"),
      durationMs: Date.now() - start,
    });
    throw error;
  } finally {
    requestSecrets.delete(id);
  }
}

/** Parse provider payloads without retaining raw JSON; failures retain a readable message and status only. */
export async function diagnosticJson(
  response: Response,
  id: string,
  allowHTTPError = false,
): Promise<unknown> {
  diagnostics.update(id, { status: response.status });
  const text = await boundedText(response);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const detail = diagnosticText(
      text.replace(/<[^>]*>/g, " ").slice(0, 2000),
      [...(requestSecrets.get(id) ?? []), ...secrets()],
    );
    diagnostics.update(id, { error: `AI HTTP ${response.status}: ${detail}` });
    throw Error(
      `AI HTTP ${response.status}: 响应不是有效 JSON / Invalid provider JSON`,
    );
  }
  if (response.ok && value && typeof value === "object" && "choices" in value) {
    const choices = (value as { choices?: unknown }).choices;
    const message = Array.isArray(choices) ? choices[0]?.message : undefined;
    if (message && typeof message === "object")
      diagnosticStream(id, response.status, {
        content: typeof message.content === "string" ? message.content : "",
        reasoning:
          typeof message.reasoning_content === "string"
            ? message.reasoning_content
            : typeof message.reasoning === "string"
              ? message.reasoning
              : "",
        calls: Array.isArray(message.tool_calls)
          ? message.tool_calls.filter(
              (call: import("../core/types").ToolCall) =>
                call?.function &&
                typeof call.function.name === "string" &&
                typeof call.function.arguments === "string",
            )
          : [],
      });
  }
  if (!response.ok) {
    const data = value as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const error =
      typeof data?.error === "string"
        ? data.error
        : (data?.error?.message ??
          data?.message ??
          `AI HTTP ${response.status}`);
    diagnostics.update(id, {
      error: diagnosticText(error, [
        ...(requestSecrets.get(id) ?? []),
        ...secrets(),
      ]),
    });
    if (!allowHTTPError)
      throw Error(`AI HTTP ${response.status}; 请查看日志 / See logs`);
  }
  return value;
}
/** Keep assembled reasoning, text and complete tool arguments, never individual SSE frames. */
export function diagnosticStream(
  id: string,
  status: number,
  output: {
    content: string;
    reasoning: string;
    calls: import("../core/types").ToolCall[];
  },
) {
  const parts = [
    output.reasoning ? "思考 / Reasoning:\n" + output.reasoning : "",
    output.content,
    output.calls.length
      ? "工具调用 / Tool calls:\n" +
        output.calls
          .map((call) => `${call.function.name}(${call.function.arguments})`)
          .join("\n")
      : "",
  ].filter(Boolean);
  diagnostics.update(id, {
    status,
    response: diagnosticText(parts.join("\n\n"), [
      ...(requestSecrets.get(id) ?? []),
      ...secrets(),
    ]),
  });
}
