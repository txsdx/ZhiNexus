/** Auditable, idempotent local agent tools with atomic action receipts and stale-edit protection. */
import Fuse from "fuse.js";
import { z } from "zod";
import { store, json } from "../core/store";
import { newCard } from "../core/review";
import { entryTemplate } from "../core/defaults";
import type { ToolSpec } from "./ai";
const parameters = {
  type: "object",
  properties: {
    query: { type: "string" },
    id: { type: "string" },
    title: { type: "string" },
    content: { type: "string" },
  },
  additionalProperties: false,
};
/** Public tool schemas use stable function names; capability-aware providers receive only these declarations. */
export const knowledgeTools: ToolSpec[] = [
  { name: "search_knowledge", description: "模糊查找词条；参数 query" },
  { name: "get_entry", description: "读取完整词条；参数 id" },
  { name: "list_categories", description: "列出分类树" },
  { name: "review_queue", description: "读取到期复习队列" },
  {
    name: "create_entry",
    description: "创建或复用同名词条；参数 title, content；需确认",
  },
  { name: "update_entry", description: "更新词条；参数 id, content；需确认" },
].map((t) => ({ type: "function", function: { ...t, parameters } }));
/** Repeated deliveries return their recorded result; user-visible writes and the receipt share one SQLite commit. */
export async function executeKnowledgeTool(
  name: string,
  args: unknown,
  receipt: string,
  confirm: (description: string) => Promise<boolean>,
): Promise<unknown> {
  const s = store.getSnapshot(),
    record = s.docs.find((d) => d.collection === "setting" && d.id === receipt);
  if (record?.fields.status === "done") return record.fields.result;
  const a = z
    .object({
      query: z.string().optional(),
      id: z.string().optional(),
      title: z.string().optional(),
      content: z.string().optional(),
    })
    .parse(args);
  switch (name) {
    case "search_knowledge":
      return new Fuse(s.entries, {
        keys: ["title", "content", "tags"],
        threshold: 0.4,
      })
        .search(a.query ?? "")
        .slice(0, 12)
        .map((r) => ({
          id: r.item.id,
          title: r.item.title,
          excerpt: r.item.content.slice(0, 400),
        }));
    case "get_entry":
      return s.entries.find((e) => e.id === a.id) ?? { error: "not found" };
    case "list_categories":
      return s.categories;
    case "review_queue":
      return s.entries
        .filter((e) => e.card.due <= new Date())
        .map((e) => ({ id: e.id, title: e.title, due: e.card.due }));
    case "create_entry": {
      if (!a.title?.trim()) throw Error("缺少 title");
      if (!(await confirm("Agent 创建词条：" + a.title)))
        return { cancelled: true };
      const existing = store
        .getSnapshot()
        .entries.find(
          (e) =>
            e.title.toLocaleLowerCase() === a.title!.trim().toLocaleLowerCase(),
        );
      const id = existing?.id ?? receipt.replace("tool-", ""),
        result = { id, reused: Boolean(existing) },
        now = new Date().toISOString();
      await store.batch(
        [
          ...(existing
            ? []
            : [
                {
                  collection: "entry" as const,
                  id,
                  patch: json({
                    title: a.title.trim(),
                    content: a.content ?? entryTemplate,
                    category: "",
                    tags: [],
                    prerequisites: [],
                    createdAt: now,
                    updatedAt: now,
                    card: newCard(),
                  }) as Record<string, import("../core/types").Json>,
                },
              ]),
          {
            collection: "setting",
            id: receipt,
            patch: { status: "done", result: json(result) },
          },
        ],
        "agent-tool",
      );
      return result;
    }
    case "update_entry": {
      const entry = s.entries.find((e) => e.id === a.id);
      if (!entry || a.content === undefined) throw Error("无效词条");
      if (
        !(await confirm(
          "Agent 替换词条内容：" + entry.title + "\n\n" + a.content,
        ))
      )
        return { cancelled: true };
      const current = store
        .getSnapshot()
        .entries.find((e) => e.id === entry.id);
      if (!current || current.content !== entry.content)
        throw Error(
          "确认期间词条已被修改，请重新生成建议 / Entry changed while confirming",
        );
      const result = { ok: true };
      await store.batch(
        [
          {
            collection: "entry",
            id: entry.id,
            patch: { content: a.content, updatedAt: new Date().toISOString() },
          },
          {
            collection: "setting",
            id: receipt,
            patch: { status: "done", result: json(result) },
          },
        ],
        "agent-tool",
      );
      return result;
    }
    default:
      throw Error("未知工具 / Unknown tool");
  }
}
