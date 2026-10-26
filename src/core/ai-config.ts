/** Resolve model inheritance at use time so global changes never overwrite explicit selections. */
import type { AIConfig, Task } from "./types";

/** An empty task or local selection inherits the current global raw model ID. */
export function resolveModel(
  ai: AIConfig,
  task: Task,
  override?: string,
): string {
  return (override ?? ai.tasks[task].model) || ai.defaultModel || "";
}
