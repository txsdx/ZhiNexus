/** Serializable AI workflow execution; knowledge proposals remain unapplied until reviewed. */
import { z } from "zod";
import { store, json } from "../core/store";
import { base64 } from "../core/crypto";
import { entryTemplate } from "../core/defaults";
import type { AIJob, AIJobContext } from "../core/ai-jobs";
import type { Json, Task } from "../core/types";
import { questionSchema, gradeSchema } from "../core/review";
import { complete, runTask, generateImage, parseJson } from "./ai";
import { validateClassification } from "./classification";
import { chat } from "./agent";
import { generateTopicTitle } from "./topic-titles";
/** Strict, reusable relationship proposals; only known entry IDs are eligible for application. */
export const relationsSchema = z.object({
  prerequisites: z.array(z.string()).max(8),
  relatedIds: z.array(z.string()),
});
/** Captured source fields used both for generation and stale-result comparison. */
export const jobEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  category: z.string(),
  prerequisites: z.array(z.string()),
});
/** Read a captured entry rather than silently changing a queued prompt after an edit. */
export function capturedEntry(job: AIJob) {
  return jobEntrySchema.parse(job.base.entry);
}
/** Generate one task under the shared HTTP concurrency limiter. */
async function generate(
  context: AIJobContext,
  task: Task,
  vars: Record<string, string>,
) {
  return context.request(task, (progress) =>
    runTask(task, vars, context.signal, progress),
  );
}
/** Reconstruct an explicitly submitted workflow; no provider output chooses executable code or a route. */
export async function executeAIJob(
  job: AIJob,
  context: AIJobContext,
): Promise<Json> {
  const e =
    job.target.entryId && !["chat", "title"].includes(job.kind)
      ? capturedEntry(job)
      : undefined;
  const vars: Record<string, string> = e
    ? { title: e.title, content: e.content }
    : {};
  switch (job.kind) {
    case "title":
      return generateTopicTitle(job, context);
    case "explain":
      return { content: await generate(context, "explain", vars) };
    case "relations":
      return json(
        relationsSchema.parse(
          parseJson(
            await generate(context, "relations", {
              ...vars,
              entries: JSON.stringify(job.input.entries),
            }),
          ),
        ),
      );
    case "classification":
      return json(
        validateClassification(
          parseJson(
            await generate(context, "classify", {
              categories: JSON.stringify(job.input.categories),
              entries: JSON.stringify(job.input.entries),
            }),
          ),
        ),
      );
    case "enrichment": {
      if (!e) throw Error("Missing captured entry");
      let content = e.content;
      const result: Record<string, Json> = {};
      if (job.input.explain) {
        const explanation = await generate(context, "explain", vars);
        content =
          explanation +
          (e.content.trim() && e.content !== entryTemplate
            ? "\n\n## 原始材料 / Captured source\n\n" + e.content
            : "");
        result.content = content;
      }
      if (job.input.relations)
        Object.assign(
          result,
          relationsSchema.parse(
            parseJson(
              await generate(context, "relations", {
                ...vars,
                content,
                entries: JSON.stringify(job.input.entries),
              }),
            ),
          ),
        );
      if (job.input.classify) {
        const classified = z
          .object({
            categories: z.array(
              z.object({ id: z.string(), parent: z.string() }),
            ),
            assignments: z.array(
              z.object({ entryId: z.string(), category: z.string() }),
            ),
          })
          .parse(
            parseJson(
              await generate(context, "classify", {
                categories: JSON.stringify(job.input.categories),
                entries: JSON.stringify([
                  { id: e.id, title: e.title, content: content.slice(0, 2000) },
                ]),
              }),
            ),
          );
        const assignment = classified.assignments.find(
          (a) => a.entryId === e.id,
        );
        const categories = store.getSnapshot().categories;
        const category =
          categories.find((c) => c.id === assignment?.category) ??
          categories.find(
            (c) =>
              c.id ===
              classified.categories.find((n) => n.id === assignment?.category)
                ?.parent,
          );
        if (category) result.category = category.id;
      }
      return result;
    }
    case "image":
      return {
        hash: await context.request("image", (progress) => {
          progress({
            model:
              store.getSnapshot().ai.tasks.image.model ||
              store.getSnapshot().ai.defaultModel,
            streaming: false,
          });
          return generateImage(String(job.input.prompt ?? ""), context.signal);
        }),
      };
    case "ocr": {
      const blob = await store.db.blob(String(job.input.imageHash));
      if (!blob) throw Error("截图附件不存在 / Screenshot not available");
      const s = store.getSnapshot();
      const modelId = s.ai.tasks.ocr.model || s.ai.defaultModel;
      if (s.ai.models.find((m) => m.id === modelId)?.vision === false)
        throw Error(
          "此模型不支持图片，请为 OCR 选择视觉模型 / Choose a vision model",
        );
      const text = (
        await context.request("ocr", (progress) =>
          complete(
            "ocr",
            [
              {
                role: "user",
                content: s.ai.tasks.ocr.prompt.replaceAll("{{content}}", ""),
              },
            ],
            undefined,
            undefined,
            "data:" + blob.mime + ";base64," + base64(blob.bytes),
            context.signal,
            progress,
          ),
        )
      ).content;
      return {
        text,
        imageHash: String(job.input.imageHash),
        source: String(job.input.source ?? ""),
        keepImage: true,
        title: text.trim().split("\n")[0].slice(0, 80),
      };
    }
    case "chat": {
      const topic = store
        .getSnapshot()
        .topics.find((t) => t.id === job.target.topicId);
      if (!topic) throw Error("对话已删除 / Conversation no longer exists");
      await chat(
        topic,
        String(job.input.text ?? ""),
        (description) => context.confirm(description),
        {
          model: String(job.input.model ?? ""),
          effort: String(job.input.effort ?? ""),
        },
        { context, jobId: job.id },
      );
      return { topicId: topic.id };
    }
    case "question": {
      if (!e || !job.target.sessionId) throw Error("Missing review target");
      const replacing = job.input.replace === true;
      const question = questionSchema.parse(
        parseJson(
          await generate(context, "question", {
            ...vars,
            content:
              e.content +
              (replacing
                ? "\n\n上一题（题目数据）：" +
                  String(
                    (job.base.question as { question?: Json })?.question ?? "",
                  ) +
                  "\n请从不同角度生成另一道题，不重复上一题。"
                : ""),
          }),
        ),
      );
      if (
        replacing &&
        question.question.trim() ===
          String(
            (job.base.question as { question?: Json })?.question ?? "",
          ).trim()
      )
        throw Error(
          "AI 返回了相同题目，请重试。原作答已保留。 / The same question was returned; original retained",
        );
      context.check();
      const committed = await store.patchWhen(
        "review",
        job.target.sessionId,
        replacing
          ? {
              question: json(question),
              phase: "question",
              answer: "",
              grade: null,
            }
          : (json({
              entryId: e.id,
              question,
              phase: "question",
              answer: "",
              grade: null,
              startedAt: new Date().toISOString(),
            }) as Record<string, Json>),
        "ai-review-question",
        () => {
          if (
            context.signal.aborted ||
            !store.getSnapshot().entries.some((x) => x.id === e.id)
          )
            return false;
          const current = store
            .getSnapshot()
            .reviews.find((r) => r.id === job.target.sessionId);
          return replacing
            ? !!current &&
                !["done", "cancelled"].includes(current.phase) &&
                JSON.stringify(current.question) ===
                  JSON.stringify(job.base.question)
            : !store
                .getSnapshot()
                .reviews.some(
                  (r) =>
                    r.entryId === e.id &&
                    !["done", "cancelled"].includes(r.phase),
                );
        },
      );
      if (!committed)
        throw Error(
          "复习已取消或已改变，结果未应用 / Review changed; question was not applied",
        );
      return json(question);
    }
    case "grade": {
      if (!e || !job.target.sessionId) throw Error("Missing review target");
      const grade = gradeSchema.parse(
        parseJson(
          await generate(context, "grade", {
            ...vars,
            question: JSON.stringify(job.base.question),
            answer: String(job.base.answer ?? ""),
          }),
        ),
      );
      context.check();
      const committed = await store.patchWhen(
        "review",
        job.target.sessionId,
        { grade: json(grade), phase: "graded" },
        "ai-grade",
        () => {
          const r = store
            .getSnapshot()
            .reviews.find((r) => r.id === job.target.sessionId);
          return (
            !context.signal.aborted &&
            !!r &&
            !["done", "cancelled", "graded"].includes(r.phase) &&
            JSON.stringify(r.question) === JSON.stringify(job.base.question) &&
            r.answer === job.base.answer
          );
        },
      );
      if (!committed)
        throw Error(
          "复习已取消或已改变，评分未应用 / Review changed; assessment was not applied",
        );
      return json(grade);
    }
  }
}
