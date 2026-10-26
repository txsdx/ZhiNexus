/** Validate replicated domain shapes and causal closure before projecting untrusted remote operations. */
import { z } from "zod";
import type { Doc, Envelope } from "./types";
import { questionSchema, gradeSchema } from "./review";
const text = z.string();
const card = z.object({
  due: z.string().refine((v) => Number.isFinite(Date.parse(v))),
  stability: z.number().nonnegative(),
  difficulty: z.number().nonnegative(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.number().int().min(0).max(3),
  learning_steps: z.number().int().nonnegative().optional(),
  last_review: z.string().optional(),
});
const message = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: text,
  tool_call_id: text.optional(),
  tool_calls: z
    .array(
      z.object({
        id: text,
        type: z.literal("function"),
        function: z.object({ name: text, arguments: text }),
      }),
    )
    .optional(),
});
const schemas = {
  entry: z.object({
    title: text.min(1),
    content: text,
    category: text,
    tags: z.array(text),
    prerequisites: z.array(text),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    card,
    deleted: z.boolean().optional(),
  }),
  category: z.object({
    name: text.min(1),
    parent: text,
    deleted: z.boolean().optional(),
  }),
  edge: z.object({
    source: text,
    target: text,
    label: text.optional(),
    deleted: z.boolean().optional(),
  }),
  topic: z.object({
    entryId: text,
    title: text,
    messages: z.array(message),
    updatedAt: z.iso.datetime(),
    deleted: z.boolean().optional(),
  }),
  review: z.object({
    entryId: text,
    phase: z.enum(["question", "answer", "graded", "done"]),
    question: questionSchema,
    answer: text,
    grade: gradeSchema.nullable(),
    startedAt: z.iso.datetime(),
    deleted: z.boolean().optional(),
  }),
};
const task = z.object({ model: text, effort: text, prompt: text });
const ai = z.object({
  baseUrl: text,
  models: z.array(
    z.object({
      id: text,
      name: text,
      efforts: z.array(text),
      thinking: z.boolean().nullable(),
      tools: z.boolean().nullable(),
      vision: z.boolean().nullable(),
      image: z.boolean().nullable(),
      context: z.number().optional(),
    }),
  ),
  tasks: z.object({
    explain: task,
    question: task,
    grade: task,
    classify: task,
    relations: task,
    agent: task,
    image: task,
  }),
});
/** Require all observed operation counters to exist before acknowledging a complete replica. */
export function assertCausalClosure(events: Envelope[]) {
  const dots = new Map<string, Set<number>>();
  for (const e of events) {
    let seq = dots.get(e.op.device);
    if (!seq) {
      seq = new Set();
      dots.set(e.op.device, seq);
    }
    seq.add(e.op.seq);
  }
  for (const seq of dots.values())
    if (seq.size !== Array.from(seq).reduce((a, b) => Math.max(a, b), 0))
      throw Error("操作日志不完整：存在设备序号缺口");
  for (const e of events)
    for (const [device, n] of Object.entries(e.op.vector))
      if (n > (dots.get(device)?.size ?? 0))
        throw Error("操作日志不完整：缺少因果依赖");
}
/** Validate logical documents including non-winning concurrent candidates. */
export function validateDocuments(docs: Doc[]) {
  for (const d of docs) {
    const schema =
      d.collection === "setting"
        ? d.id === "ai"
          ? ai
          : null
        : schemas[d.collection];
    if (schema) {
      schema.parse(d.fields);
      for (const [field, versions] of Object.entries(d.conflicts))
        for (const v of versions)
          schema.parse({ ...d.fields, [field]: v.value });
    }
    if (d.collection === "setting" && d.id === "appearance") {
      z.object({
        theme: z.enum(["light", "dark", "sepia"]).optional(),
        language: z.enum(["auto", "zh", "en"]).optional(),
        font: z.enum(["sans", "serif", "system"]).optional(),
        accent: z
          .string()
          .regex(/^#[a-fA-F0-9]{6}$/)
          .optional(),
        scale: z.number().min(0.85).max(1.3).optional(),
        layout: z.enum(["comfortable", "compact"]).optional(),
        mobileLayout: z.enum(["bottom", "top"]).optional(),
      }).parse(d.fields);
    }
  }
}
