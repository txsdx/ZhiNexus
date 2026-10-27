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
    diagnostics.update(id, {
      level: "error",
      error: diagnosticText(error, [...activeSecrets, ...secrets()]),
      durationMs: Date.now() - start,
    });
    throw error;
  } finally {
    requestSecrets.delete(id);
  }
}

/** Capture bounded raw provider text before HTTP/JSON/schema validation, including non-JSON errors. */
export async function diagnosticJson(
  response: Response,
  id: string,
  allowHTTPError = false,
): Promise<unknown> {
  diagnostics.update(id, { status: response.status });
  const text = await boundedText(response);
  diagnostics.update(id, {
    status: response.status,
    response: diagnosticText(text, [
      ...(requestSecrets.get(id) ?? []),
      ...secrets(),
    ]),
  });
  if (!response.ok && !allowHTTPError)
    throw Error(`AI HTTP ${response.status}; 请查看日志 / See logs`);
  try {
    return JSON.parse(text);
  } catch {
    throw Error(
      "AI 返回的内容不是有效 JSON，请查看日志 / Invalid provider JSON; see logs",
    );
  }
}

/** Record parsed SSE frames with the original request's credential redaction inputs. */
export function diagnosticStream(
  id: string,
  status: number,
  events: unknown[],
) {
  diagnostics.update(id, {
    status,
    response: diagnosticText(events, [
      ...(requestSecrets.get(id) ?? []),
      ...secrets(),
    ]),
  });
}
