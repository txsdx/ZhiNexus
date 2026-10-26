/** CPA model discovery ported from the uploaded reference: at most two ordinary catalog requests. */
import { z } from "zod";
import type { Model } from "../core/types";
import { request, responseJson, secureUrl } from "./network";
const record = z.record(z.string(), z.unknown());
/** Extract only declared reasoning levels, including CPA effort objects; unknown stays unknown. */
function levels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((x) => (typeof x === "string" ? x : record.parse(x).effort))
        .filter((x): x is string => typeof x === "string" && !!x.trim())
        .map((x) => x.trim().toLowerCase()),
    ),
  ];
}
/** Read an explicit boolean capability, never guessing from the model ID. */
function flag(row: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys)
    if (typeof row[k] === "boolean") return row[k] as boolean;
  return null;
}
/** Normalize standard OpenAI and extended CPA payloads while rejecting duplicate IDs. */
export function normalizeModels(payload: unknown): Model[] {
  const obj = record.parse(payload),
    extended = Array.isArray(obj.models),
    rows = z
      .array(record)
      .min(1)
      .parse(extended ? obj.models : obj.data),
    seen = new Set<string>();
  return rows.map((r) => {
    const id = z
      .string()
      .trim()
      .min(1)
      .parse(extended ? (r.slug ?? r.id) : (r.id ?? r.slug));
    if (seen.has(id)) throw Error("模型目录包含重复 ID");
    seen.add(id);
    let efforts: string[] = [];
    for (const k of [
      "supportsReasoningEffort",
      "supported_reasoning_levels",
      "supported_reasoning_efforts",
    ]) {
      const v = levels(r[k]);
      if (v.length) {
        efforts = v;
        break;
      }
    }
    const thinking =
      typeof r.thinking === "object" && r.thinking
        ? record.parse(r.thinking)
        : null;
    if (!efforts.length && thinking) efforts = levels(thinking.levels);
    const params = Array.isArray(r.supported_parameters)
      ? r.supported_parameters
      : [];
    const input =
      r.supportedInputModalities ??
      r.input_modalities ??
      (r.architecture && record.parse(r.architecture).input_modalities);
    const output = r.supportedOutputModalities ?? r.output_modalities;
    return {
      id,
      name: typeof r.display_name === "string" ? r.display_name : id,
      efforts,
      thinking: efforts.length
        ? true
        : typeof r.thinking === "boolean"
          ? r.thinking
          : (flag(r, ["supports_thinking"]) ??
            (thinking &&
            (Number(thinking.max) > 0 || thinking.dynamic_allowed === true)
              ? true
              : null)),
      tools:
        flag(r, ["toolCalling", "tool_calling", "supports_tool_calling"]) ??
        (params.some((p) =>
          ["tools", "tool_choice", "functions", "function_call"].includes(
            String(p),
          ),
        )
          ? true
          : null),
      vision:
        flag(r, ["vision", "supports_vision"]) ??
        (Array.isArray(input) && input.length ? input.includes("image") : null),
      image:
        Array.isArray(output) && output.length
          ? output.includes("image")
          : null,
      context:
        typeof (r.context_length ?? r.context_window) === "number"
          ? Number(r.context_length ?? r.context_window)
          : undefined,
    };
  });
}
/** Fall back only on documented unsupported statuses, never on authentication failure. */
export async function discoverModels(
  base: string,
  key: string,
): Promise<Model[]> {
  const url = secureUrl(base).href.replace(/\/$/, "") + "/models";
  const options = {
    headers: { Authorization: "Bearer " + key, Accept: "application/json" },
  };
  let res = await request(url + "?client_version=cpa", options);
  if ([400, 404, 405, 422, 501].includes(res.status))
    res = await request(url, options);
  return normalizeModels(await responseJson(res));
}
