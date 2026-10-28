import { reviewTarget } from "../core/review-policy";
/** Explicit, idempotent application of reviewed AI results; failures retain the pending task. */
import { z } from "zod";
import type { AIJob, AITarget } from "../core/ai-jobs";
import type { Json, Entry, Collection } from "../core/types";
import { store, json } from "../core/store";
import { sha256 } from "../core/crypto";
import { rememberedCard } from "../core/review";
import { entryWorkspace } from "../core/workspace";
import { entryDocument } from "../components/editor/document";
import { aiJobs } from "./ai-jobs";
import { capturedEntry } from "./ai-workflows";
import { validateClassification } from "./classification";
const applying = new Set<string>();
/** Compare generation context with the current knowledge rather than overwriting later edits silently. */
export function aiJobIsStale(job: AIJob): boolean {
  if (job.kind === "chat" || job.kind === "title") return false;
  const s = store.getSnapshot();
  if (job.kind === "classification")
    return (
      JSON.stringify(job.input.categories) !== JSON.stringify(s.categories) ||
      JSON.stringify(job.input.entries) !==
        JSON.stringify(
          s.entries.map((e) => ({
            id: e.id,
            title: e.title,
            content: e.content.slice(0, 1500),
          })),
        )
    );
  if (!job.target.entryId || !job.base.entry) return false;
  const current = s.entries.find((e) => e.id === job.target.entryId);
  if (!current) return true;
  const base = capturedEntry(job);
  return ["title", "content", "category", "prerequisites"].some(
    (key) =>
      JSON.stringify(base[key as keyof typeof base]) !==
      JSON.stringify(current[key as keyof Entry]),
  );
}
/** Read current fields used in review, checked once more inside the serialized knowledge commit. */
function fingerprint() {
  const s = store.getSnapshot();
  return JSON.stringify([
    s.categories,
    s.entries.map((e) => [
      e.id,
      e.title,
      e.content,
      e.category,
      e.prerequisites,
    ]),
    s.docs.filter((d) => d.collection === "edge").map((d) => [d.id, d.fields]),
  ]);
}
/** Apply to the intended destination, then remove the local item only after durability succeeds. */
export async function applyAIJob(id: string, force = false): Promise<AITarget> {
  aiJobs.assertWritable();
  if (applying.has(id)) throw Error("任务正在应用 / Task is being applied");
  applying.add(id);
  try {
    const job = aiJobs.find(id);
    if (job.state !== "review") throw Error("任务尚未完成 / Task is not ready");
    if (job.kind === "question" || job.kind === "grade") return job.target;
    if (job.kind === "chat" || job.kind === "title") {
      await aiJobs.remove(id);
      return job.target;
    }
    const receipt = "ai-applied-" + id;
    const previous = store
      .getSnapshot()
      .docs.find((d) => d.collection === "setting" && d.id === receipt);
    if (previous?.fields.status === "applied") {
      const target = previous.fields.target as unknown as AITarget;
      await aiJobs.remove(id);
      return target;
    }
    if (job.kind === "image") {
      await entryWorkspace.init();
      if (entryWorkspace.getSnapshot().aiApplied.includes(id)) {
        await entryWorkspace.flush();
        await aiJobs.remove(id);
        return job.target;
      }
    }
    if (aiJobIsStale(job) && !force)
      throw Error(
        "生成后内容已改变，请先比较并确认 / Compare the updated content first",
      );
    const result = job.reviewData ?? job.result;
    if (job.kind === "image") {
      const { hash } = z
        .object({ hash: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(result);
      const target = job.target.entryId;
      if (!target) throw Error("Missing image destination");
      await entryWorkspace.init();
      await entryWorkspace.applyAIResult(target, id, () => {
        const entry = store.getSnapshot().entries.find((e) => e.id === target);
        if (!entry) throw Error("词条已删除 / Entry was deleted");
        const draft = entryWorkspace.getSnapshot().drafts[target];
        const current = draft?.editing
          ? draft
          : {
              title: entry.title,
              content: entry.content,
              summary: entry.summary ?? "",
              editing: true,
              sourceMode: false,
              focus: null,
              base: {
                title: entry.title,
                content: entry.content,
                summary: entry.summary ?? "",
              },
            };
        const content =
          current.content + "\n\n![AI illustration](asset:" + hash + ")\n";
        const document = entryDocument({
          content: current.content,
          editorDocument: current.editorDocument
            ? {
                schema: 1,
                markdown: current.content,
                json: current.editorDocument,
              }
            : entry.editorDocument,
        });
        return {
          ...current,
          content,
          editing: true,
          editorDocument: json({
            ...document,
            content: [
              ...(document.content ?? []),
              {
                type: "image",
                attrs: {
                  src: "asset:" + hash,
                  alt: "AI illustration",
                  blockId: crypto.randomUUID(),
                },
              },
            ],
          }),
        };
      });
      window.dispatchEvent(
        new CustomEvent("zhinexus:ai-draft", { detail: { id: target } }),
      );
      await aiJobs.remove(id);
      return job.target;
    }
    const s = store.getSnapshot(),
      before = fingerprint();
    const patches: {
      collection: Collection;
      id: string;
      patch: Record<string, Json>;
    }[] = [];
    let target: AITarget = job.target;
    if (job.kind === "classification") {
      const proposal = validateClassification(result);
      patches.push(
        ...proposal.categories.map((c) => ({
          collection: "category" as const,
          id: c.id,
          patch: json(c) as Record<string, Json>,
        })),
        ...proposal.assignments.map((a) => ({
          collection: "entry" as const,
          id: a.entryId,
          patch: { category: a.category, updatedAt: new Date().toISOString() },
        })),
      );
    } else if (job.kind === "ocr") {
      const value = z
        .object({
          title: z.string().trim().min(1).max(300),
          text: z.string().trim().min(1),
          imageHash: z.string().regex(/^[a-f0-9]{64}$/),
          source: z.string(),
          keepImage: z.boolean(),
        })
        .parse(result);
      const entryId = "ai-ocr-" + id,
        now = job.createdAt;
      patches.push({
        collection: "entry",
        id: entryId,
        patch: json({
          title: value.title,
          content:
            value.text +
            (value.keepImage
              ? "\n\n![截图 / Screenshot](asset:" + value.imageHash + ")"
              : ""),
          category: "",
          tags: [],
          prerequisites: [],
          createdAt: now,
          updatedAt: now,
          card: rememberedCard(
            new Date(),
            reviewTarget(store.getSnapshot().docs),
          ),
          reviewCount: 0,
        }) as Record<string, Json>,
      });
      target = { page: "entry", entryId };
    } else {
      const entry = s.entries.find((e) => e.id === job.target.entryId);
      if (!entry)
        throw Error("词条已删除，结果仍保留 / Entry deleted; result retained");
      if (
        (job.kind === "explain" || job.kind === "enrichment") &&
        entryWorkspace.isDirty(entry.id, entry)
      )
        throw Error(
          "词条有未保存草稿，请先保存或取消草稿再应用 / Save or discard the existing draft before applying",
        );
      const value = z
        .object({
          content: z.string().optional(),
          prerequisites: z.array(z.string()).max(8).optional(),
          relatedIds: z.array(z.string()).optional(),
          category: z.string().optional(),
        })
        .parse(result);
      const patch: Record<string, Json> = {
        updatedAt: new Date().toISOString(),
      };
      if (value.content !== undefined) {
        if (!value.content.trim())
          throw Error("AI 内容为空 / Empty generated content");
        patch.content = value.content;
      }
      if (value.prerequisites) patch.prerequisites = value.prerequisites;
      if (value.category !== undefined) {
        if (!s.categories.some((c) => c.id === value.category))
          throw Error("分类已改变，请重新生成 / Category changed");
        patch.category = value.category;
      }
      patches.push({ collection: "entry", id: entry.id, patch });
      for (const related of new Set(value.relatedIds ?? [])) {
        if (related === entry.id) continue;
        if (!s.entries.some((e) => e.id === related))
          throw Error("关联中包含未知或已删除条目 / Unknown related entry");
        if (
          s.docs.some(
            (d) =>
              d.collection === "edge" &&
              !d.fields.deleted &&
              ((d.fields.source === entry.id && d.fields.target === related) ||
                (d.fields.source === related && d.fields.target === entry.id)),
          )
        )
          continue;
        patches.push({
          collection: "edge",
          id: await sha256(["related", ...[entry.id, related].sort()]),
          patch: { source: entry.id, target: related, label: "related" },
        });
      }
    }
    patches.push({
      collection: "setting",
      id: receipt,
      patch: { status: "applied", target: json(target) },
    });
    const committed = await store.batchWhen(
      patches,
      "ai-reviewed-" + job.kind,
      () => fingerprint() === before,
    );
    if (!committed)
      throw Error(
        "审阅期间内容又发生变化，结果尚未应用 / Content changed while reviewing; retry",
      );
    await aiJobs.remove(id);
    return target;
  } finally {
    applying.delete(id);
  }
}
