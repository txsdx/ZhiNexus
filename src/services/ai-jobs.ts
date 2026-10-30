/** Application AI queue, encrypted local persistence and navigation independent of page mounts. */
import { z } from "zod";
import { AIQueue } from "../core/ai-queue";
import type { AIJob, AIJobKind, AITarget } from "../core/ai-jobs";
import type { Json } from "../core/types";
import { store, json } from "../core/store";
import { encryptSecret, decryptSecret } from "../core/secrets";
import { resolveModel } from "../core/ai-config";
import { diagnosticText } from "../core/diagnostics";
import { diagnostics } from "./diagnostics";
import { notifyCompletion } from "./notifications";
import { topicTitleSeed } from "./topic-titles";
import { graphCatalog, graphEdges, graphSignature } from "./knowledge-graph";
let queueChannel: BroadcastChannel | undefined;
let workflows: Promise<typeof import("./ai-workflows")> | undefined;
/** Validate the local queue boundary before interpreting saved work or offering retry. */
const records = z
  .array(
    z.object({
      id: z.string(),
      kind: z.enum([
        "explain",
        "importance",
        "relations",
        "graph",
        "classification",
        "enrichment",
        "image",
        "ocr",
        "chat",
        "title",
        "question",
        "grade",
      ]),
      title: z.string(),
      target: z.object({
        page: z.enum([
          "entry",
          "agent",
          "review",
          "settings",
          "tasks",
          "graph",
        ]),
        entryId: z.string().optional(),
        topicId: z.string().optional(),
        sessionId: z.string().optional(),
        tab: z.string().optional(),
      }),
      input: z.record(z.string(), z.json()),
      base: z.record(z.string(), z.json()),
      state: z.enum([
        "queued",
        "running",
        "approval",
        "review",
        "error",
        "cancelled",
      ]),
      stages: z.array(
        z.object({
          responseId: z.string().optional(),
          task: z.enum([
            "explain",
            "importance",
            "question",
            "grade",
            "classify",
            "relations",
            "graph",
            "agent",
            "ocr",
            "image",
          ]),
          model: z.string(),
          content: z.string(),
          reasoning: z.string(),
          calls: z.array(
            z.object({
              id: z.string(),
              type: z.literal("function"),
              function: z.object({ name: z.string(), arguments: z.string() }),
            }),
          ),
          streaming: z.boolean(),
          finished: z.boolean(),
        }),
      ),
      result: z.json().optional(),
      reviewData: z.json().optional(),
      approval: z.string().optional(),
      error: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  )
  .max(100);
/** Runtime credentials are used only to redact errors, never stored in queue configuration. */
function safeError(error: unknown) {
  const d = store.getSnapshot().device;
  return diagnosticText(error instanceof Error ? error.message : error, [
    d.apiKey,
    d.apiKeySyncKey ?? "",
    d.davPassword,
    d.proxy?.password ?? "",
    ...d.mcp.flatMap((m) => [m.token, ...Object.values(m.env ?? {})]),
  ]);
}
/** One queue handles every AI feature while permitting parallel unrelated provider requests. */
export const aiJobs = new AIQueue(
  {
    load: async () => {
      await store.db.events();
      const encrypted = await store.db.local<string>("ai-jobs", "");
      return encrypted
        ? (records.parse(
            await decryptSecret(
              encrypted,
              "local-ai-jobs",
              "",
              32 * 1024 * 1024,
            ),
          ) as AIJob[])
        : [];
    },
    save: async (rows) => {
      const encrypted = await encryptSecret(rows, "local-ai-jobs");
      if (encrypted.length > 32 * 1024 * 1024)
        throw Error(
          "AI 队列超过 32 MiB，请先审阅或清理任务 / Queue exceeds 32 MiB",
        );
      await store.db.setLocal("ai-jobs", encrypted);
      queueChannel?.postMessage("updated");
    },
  },
  async (job, context) => {
    const d = store.getSnapshot().device;
    const originalSecrets = [
      d.apiKey,
      d.apiKeySyncKey ?? "",
      d.davPassword,
      d.proxy?.password ?? "",
      ...d.mcp.flatMap((m) => [m.token, ...Object.values(m.env ?? {})]),
    ];
    try {
      const { executeAIJob } = await (workflows ??= import("./ai-workflows"));
      const result = await executeAIJob(job, context);
      if (job.kind === "chat")
        void scheduleTitle(job).catch((error) =>
          diagnostics.error(
            "ai",
            "生成对话标题失败 / Conversation title failed",
            error,
          ),
        );
      if (job.kind !== "chat" && job.kind !== "title")
        void notifyCompletion(
          job.kind === "ocr" ? "ocr" : "ai",
          job.title + " · 待审阅 / Ready for review",
        ).catch(() => {});
      return result;
    } catch (error) {
      throw Error(
        diagnosticText(
          error instanceof Error ? error.message : error,
          originalSecrets,
        ),
      );
    }
  },
  safeError,
  (job) => job.kind === "chat" || job.kind === "title",
);
const titleScheduling = new Set<string>();
/** Schedule at most one automatic title per conversation without blocking the completed answer. */
async function scheduleTitle(job: AIJob) {
  const id = job.target.topicId;
  if (!id || titleScheduling.has(id)) return;
  titleScheduling.add(id);
  try {
    const topic = store.getSnapshot().topics.find((t) => t.id === id);
    if (
      !topic ||
      topic.titleMode === "manual" ||
      topic.titleGenerated ||
      aiJobs
        .getSnapshot()
        .jobs.some((j) => j.kind === "title" && j.target.topicId === id)
    )
      return;
    const seed = topicTitleSeed(topic);
    if (seed)
      await submitAIJob(
        "title",
        { page: "agent", entryId: topic.entryId, topicId: id },
        { seed, model: job.input.model ?? "" },
        false,
      );
  } finally {
    titleScheduling.delete(id);
  }
}
const cleaning = new Set<string>();
/** Clear reviewed results only after the related explicit review commit, cancellation or replacement. */
function retireReviewed() {
  if (aiJobs.getSnapshot().readOnly) return;
  for (const job of aiJobs.getSnapshot().jobs) {
    if (cleaning.has(job.id) || !job.target.sessionId) continue;
    const review = store
      .getSnapshot()
      .reviews.find((r) => r.id === job.target.sessionId);
    if (!review) continue;
    const ended = ["done", "cancelled"].includes(review.phase);
    const replaced =
      job.state === "review" &&
      ((job.kind === "question" &&
        JSON.stringify(review.question) !== JSON.stringify(job.result)) ||
        (job.kind === "grade" &&
          review.phase === "answer" &&
          review.grade === null));
    if (!ended && !replaced) continue;
    cleaning.add(job.id);
    void (async () => {
      if (["queued", "running", "approval"].includes(job.state))
        await aiJobs.cancel(job.id);
      await aiJobs.remove(job.id);
    })()
      .catch((error) =>
        diagnostics.error(
          "app",
          "复习任务清理未完成 / Review task cleanup failed",
          error,
        ),
      )
      .finally(() => cleaning.delete(job.id));
  }
}
/** Load pending results and bind concurrency changes after the database opens. */
let queueInitialization: Promise<void> | undefined;
/** Share one initialization with early submissions and shutdown; never overwrite an unrestored queue. */
export function initAIJobs() {
  return (queueInitialization ??= initializeAIJobs());
}
async function initializeAIJobs() {
  let ownsQueue = true;
  if (navigator.locks)
    ownsQueue = await new Promise<boolean>((resolve, reject) => {
      void navigator.locks
        .request(
          "zhinexus-ai-queue-owner",
          { ifAvailable: true },
          async (lock) => {
            resolve(!!lock);
            if (lock) await new Promise<void>(() => {});
          },
        )
        .catch(reject);
    });
  queueChannel = new BroadcastChannel("zhinexus-ai-jobs");
  await aiJobs.init(!ownsQueue);
  queueChannel.onmessage = () => {
    void aiJobs.refreshReadOnly();
  };
  const previous = new Map(
    aiJobs.getSnapshot().jobs.map((j) => [j.id, j.state]),
  );
  aiJobs.subscribe(() => {
    for (const job of aiJobs.getSnapshot().jobs) {
      if (job.state === "error" && previous.get(job.id) !== "error") {
        diagnostics.error("ai", job.title, job.error);
        window.dispatchEvent(
          new CustomEvent("zhinexus:ai-job-error", {
            detail: { id: job.id, error: job.error },
          }),
        );
      }
      previous.set(job.id, job.state);
    }
  });
  const update = () => {
    aiJobs.limiter.setLimit(store.getSnapshot().device.aiConcurrency ?? 2);
    retireReviewed();
  };
  update();
  store.subscribe(update);
  aiJobs.subscribe(retireReviewed);
}
/** Open a task's real destination together with its stream or review, without arbitrary navigation URLs. */
export function openAIJob(id: string) {
  window.dispatchEvent(new CustomEvent("zhinexus:ai-job", { detail: { id } }));
}
/** Capture stable workflow inputs from application state and persist before entering the queue. */
export async function submitAIJob(
  kind: AIJobKind,
  target: AITarget,
  input: Record<string, Json> = {},
  open = true,
) {
  await initAIJobs();
  const s = store.getSnapshot(),
    entry = target.entryId
      ? s.entries.find((e) => e.id === target.entryId)
      : undefined;
  const base: Record<string, Json> = {};
  if (kind === "graph") {
    if (s.entries.length < 2)
      throw Error("至少需要两个词条 / At least two entries are required");
    const model = s.ai.models.find((m) => m.id === resolveModel(s.ai, "graph"));
    base.graph = graphSignature();
    input = {
      entries: json(graphCatalog()),
      existingEdges: json(graphEdges()),
      budget: Math.max(
        4096,
        Math.min(24000, Math.floor((model?.context ?? 96000) / 4)),
      ),
    };
  }
  if (entry)
    base.entry = json({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      category: entry.category,
      prerequisites: entry.prerequisites,
      importance: entry.importance ?? null,
    });
  if (["question", "grade"].includes(kind) && target.sessionId) {
    const review = s.reviews.find((r) => r.id === target.sessionId);
    if (review) {
      base.question = json(review.question);
      base.answer = review.answer;
    }
  }
  if (["relations", "enrichment"].includes(kind))
    input = {
      ...input,
      entries: json(s.entries.map((e) => ({ id: e.id, title: e.title }))),
    };
  if (kind === "classification") {
    if (!s.categories.some((c) => !c.parent))
      throw Error("请先创建至少一个大类");
    input = {
      categories: json(s.categories),
      entries: json(
        s.entries.map((e) => ({
          id: e.id,
          title: e.title,
          content: e.content.slice(0, 1500),
        })),
      ),
    };
  }
  if (kind === "enrichment")
    input = {
      ...input,
      explain: !!resolveModel(s.ai, "explain"),
      relations: !!resolveModel(s.ai, "relations"),
      classify: !!resolveModel(s.ai, "classify") && !!s.categories.length,
      categories: json(s.categories),
    };
  const names: Record<AIJobKind, string> = {
    explain: "AI 解释 / Explanation",
    importance: "重要等级建议 / Importance suggestion",
    relations: "知识关联 / Connections",
    graph: "星图自动关联 / Graph connections",
    classification: "智能分类 / Classification",
    enrichment: "整理新知识 / Enrichment",
    image: "教学配图 / Illustration",
    ocr: "AI 识别 / OCR",
    chat: "AI 对话 / Conversation",
    title: "对话标题 / Conversation title",
    question: "复习出题 / Review question",
    grade: "复习评估 / Assessment",
  };
  const id = await aiJobs.submit({
    kind,
    target,
    input,
    base,
    title: names[kind] + (entry ? " · " + entry.title : ""),
  });
  if (open) openAIJob(id);
  return id;
}
/** Drain queue writes before a native exit, migration or page background event. */
export async function flushAIJobs() {
  await initAIJobs();
  await aiJobs.flush();
}
/** Stop active requests and persist partial output before native storage is closed or relocated. */
export async function stopAIJobsForShutdown() {
  await initAIJobs();
  if (aiJobs.getSnapshot().readOnly) return;
  for (const job of aiJobs
    .getSnapshot()
    .jobs.filter((j) => ["queued", "running", "approval"].includes(j.state)))
    await aiJobs.cancel(job.id);
  await aiJobs.flush();
}
