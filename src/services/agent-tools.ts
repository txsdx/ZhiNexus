import { reviewTarget, needsReview, nextReviewAt } from "../core/review-policy";
/** Structured knowledge-control tools with atomic receipts, explicit write previews and stale-state rejection. */
import Fuse from "fuse.js";
import { z } from "zod";
import { store, json, type StorePatch } from "../core/store";
import { entryWorkspace } from "../core/workspace";
import { canonical } from "../core/crypto";
import { rememberedCard } from "../core/review";
import { entryTemplate } from "../core/defaults";
import { entryColors } from "../core/entry-colors";
import { categoryRemovalPlan, validateCategoryMove } from "./categories";
import type { Json } from "../core/types";
import type { ToolSpec } from "./ai";
import {
  graphEdges,
  graphLayoutPatches,
  relationPatches,
  relationTypes,
} from "./knowledge-graph";
const id = z.string().min(1).max(200),
  title = z.string().trim().min(1).max(200),
  content = z.string().max(8 * 1024 * 1024),
  parent = z.string().max(200),
  color = z.enum(entryColors);
const definitions = {
  move_graph_nodes: {
    description:
      "按给定坐标批量移动星图节点，保留其他节点位置；需确认，拒绝未知/重复节点和过时布局",
    schema: z
      .object({
        positions: z
          .array(
            z
              .object({
                id,
                x: z.number().finite().min(-1000000).max(1000000),
                y: z.number().finite().min(-1000000).max(1000000),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict(),
  },
  get_knowledge_graph: {
    description:
      "分页读取星图节点、关系与位置。prerequisite A→B表示理解B先需要A；progression A→B表示基础到进阶；related为普通关联。",
    schema: z
      .object({
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
  },
  create_graph_relation: {
    description:
      "新增星图关系，需要具体依据；禁止自连、重复和学习依赖环；已有关系保留；需确认",
    schema: z
      .object({
        source: id,
        target: id,
        type: z.enum(relationTypes),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict(),
  },
  update_graph_relation: {
    description:
      "修改已有关系的端点、依赖/递进/关联类型或依据，保留未传字段；需确认",
    schema: z
      .object({
        id,
        source: id.optional(),
        target: id.optional(),
        type: z.enum(relationTypes).optional(),
        reason: z.string().max(1000).optional(),
      })
      .strict(),
  },
  delete_graph_relation: {
    description: "删除指定星图关系，保留不可变历史；需确认",
    schema: z.object({ id }).strict(),
  },
  arrange_knowledge_graph: {
    description:
      "根据当前关系将整个知识星图从左到右自动排列；预览节点数量，确认后保存布局",
    schema: z.object({}).strict(),
  },
  search_knowledge: {
    description: "模糊搜索知识词条",
    schema: z.object({ query: z.string() }).strict(),
  },
  list_entries: {
    description: "分页列出词条，可按分类筛选；category 为空表示未分类",
    schema: z
      .object({
        category: parent.optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
  },
  get_entry: {
    description: "读取完整词条和复习状态",
    schema: z.object({ id }).strict(),
  },
  list_categories: {
    description: "列出完整分类层级与ID",
    schema: z.object({}).strict(),
  },
  get_category: {
    description: "读取分类、直接子分类及直属条目",
    schema: z.object({ id }).strict(),
  },
  review_queue: {
    description: "读取到期复习队列",
    schema: z.object({}).strict(),
  },
  get_app_state: {
    description: "读取软件知识/分类/对话/复习数量及同步状态；不返回凭证",
    schema: z.object({}).strict(),
  },
  create_entry: {
    description:
      "创建词条或复用同名词条，可指定正文、分类、标签、背景色；需确认",
    schema: z
      .object({
        title,
        content: content.optional(),
        category: parent.optional(),
        tags: z.array(z.string()).max(100).optional(),
        color: color.optional(),
      })
      .strict(),
  },
  edit_explanation: {
    description:
      "审阅后编辑词条解释的本机草稿，保留用户已有修改，用户保存后再写入知识；content替换全文，或selected+replacement精确替换唯一片段",
    schema: z
      .object({
        id,
        content: content.optional(),
        selected: z.string().min(1).optional(),
        replacement: content.optional(),
      })
      .strict(),
  },
  update_entry: {
    description:
      "修改词条的标题、正文、摘要、分类、标签或背景色；未传字段保留；需确认",
    schema: z
      .object({
        id,
        title: title.optional(),
        content: content.optional(),
        summary: z.string().max(600).optional(),
        category: parent.optional(),
        tags: z.array(z.string()).max(100).optional(),
        color: color.optional(),
      })
      .strict(),
  },
  move_entry: {
    description: "移动词条到指定分类，category 空字符串为未分类；需确认",
    schema: z.object({ id, category: parent }).strict(),
  },
  delete_entry: {
    description: "删除一个词条，保留回收站和历史；需确认",
    schema: z.object({ id }).strict(),
  },
  restore_entry: {
    description: "从回收站恢复词条；需确认",
    schema: z.object({ id }).strict(),
  },
  create_category: {
    description: "添加分类层级；parent 为空为顶层；需确认",
    schema: z.object({ name: title, parent: parent.optional() }).strict(),
  },
  update_category: {
    description: "重命名分类并可移动层级；需确认，禁止循环",
    schema: z
      .object({ id, name: title.optional(), parent: parent.optional() })
      .strict(),
  },
  move_category: {
    description: "移动分类及其整个子树；parent 为空移至顶层；需确认，禁止循环",
    schema: z.object({ id, parent }).strict(),
  },
  delete_category: {
    description:
      "删除分类；mode=keep 默认保留子类和词条并迁移到上一级；mode=all 删除子树及全部条目；需确认",
    schema: z.object({ id, mode: z.enum(["keep", "all"]).optional() }).strict(),
  },
} as const;
/** Every tool advertises its own required arguments instead of one permissive shared schema. */
export const knowledgeTools: ToolSpec[] = Object.entries(definitions).map(
  ([name, def]) => ({
    type: "function",
    function: {
      name,
      description: def.description,
      parameters: z.toJSONSchema(def.schema),
    },
  }),
);
interface Arguments {
  positions?: { id: string; x: number; y: number }[];
  source?: string;
  target?: string;
  type?: (typeof relationTypes)[number];
  reason?: string;
  selected?: string;
  replacement?: string;
  query?: string;
  id?: string;
  title?: string;
  content?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  color?: string;
  parent?: string;
  name?: string;
  mode?: "keep" | "all";
  offset?: number;
  limit?: number;
}
const catalogSignature = (graph = false) =>
  canonical(
    store
      .getSnapshot()
      .docs.filter(
        (d) =>
          d.collection === "entry" ||
          d.collection === "category" ||
          (graph &&
            (d.collection === "edge" ||
              (d.collection === "setting" && d.id === "graph"))),
      )
      .map((d) => [d.collection, d.id, d.fields]),
  );
/** Read-only queries run immediately; reviewed mutations and idempotency receipts share one guarded transaction. */
export async function executeKnowledgeTool(
  name: string,
  args: unknown,
  receipt: string,
  confirm: (description: string) => Promise<boolean>,
  active: () => boolean = () => true,
): Promise<unknown> {
  const prior = () =>
    store
      .getSnapshot()
      .docs.find((d) => d.collection === "setting" && d.id === receipt);
  if (prior()?.fields.status === "done") return prior()!.fields.result;
  const def = definitions[name as keyof typeof definitions];
  if (!def) throw Error("未知工具 / Unknown tool");
  const a = def.schema.parse(args) as Arguments,
    s = store.getSnapshot();
  switch (name) {
    case "get_knowledge_graph": {
      const offset = a.offset ?? 0,
        limit = a.limit ?? 50,
        edges = graphEdges(),
        positions =
          s.docs.find((d) => d.collection === "setting" && d.id === "graph")
            ?.fields ?? {};
      return {
        totalNodes: s.entries.length,
        totalRelations: edges.length,
        nodes: s.entries.slice(offset, offset + limit).map((e, index) => ({
          id: e.id,
          title: e.title,
          position: positions[e.id] ?? {
            x: ((offset + index) % 3) * 260,
            y: Math.floor((offset + index) / 3) * 140,
          },
        })),
        relations: edges.slice(offset, offset + limit),
      };
    }
    case "search_knowledge":
      return new Fuse(s.entries, {
        keys: ["title", "content", "tags"],
        threshold: 0.4,
      })
        .search(a.query!)
        .slice(0, 12)
        .map((r) => ({
          id: r.item.id,
          title: r.item.title,
          category: r.item.category,
          excerpt: r.item.content.slice(0, 400),
        }));
    case "list_entries": {
      const entries = s.entries.filter(
        (e) => a.category === undefined || e.category === a.category,
      );
      return {
        total: entries.length,
        entries: entries
          .slice(a.offset ?? 0, (a.offset ?? 0) + (a.limit ?? 50))
          .map((e) => ({
            id: e.id,
            title: e.title,
            category: e.category,
            tags: e.tags,
            color: e.color ?? "none",
          })),
      };
    }
    case "get_entry":
      return {
        entry: s.entries.find((e) => e.id === a.id) ?? null,
        draft: entryWorkspace.getSnapshot().drafts[a.id!] ?? null,
      };
    case "list_categories":
      return s.categories;
    case "get_category":
      return {
        category: s.categories.find((c) => c.id === a.id) ?? null,
        children: s.categories.filter((c) => c.parent === a.id),
        entries: s.entries
          .filter((e) => e.category === a.id)
          .map((e) => ({ id: e.id, title: e.title })),
      };
    case "review_queue":
      return s.entries
        .filter((e) => needsReview(e, reviewTarget(s.docs)))
        .map((e) => ({
          id: e.id,
          title: e.title,
          due: nextReviewAt(e, reviewTarget(s.docs)),
        }));
    case "get_app_state":
      return {
        entries: s.entries.length,
        categories: s.categories.length,
        topics: s.topics.length,
        reviews: s.reviews.length,
        lastSync: s.device.lastSync,
      };
  }
  if (name === "edit_explanation") {
    const entry = s.entries.find((e) => e.id === a.id);
    if (!entry) throw Error("词条不存在 / Entry missing");
    await entryWorkspace.init();
    if (entryWorkspace.getSnapshot().aiApplied.includes(receipt)) {
      await entryWorkspace.flush();
      window.dispatchEvent(
        new CustomEvent("zhinexus:ai-draft", { detail: { id: entry.id } }),
      );
      return { id: entry.id, draft: true, requiresSave: true };
    }
    const draft = entryWorkspace.getSnapshot().drafts[entry.id],
      original = draft?.editing ? draft.content : entry.content;
    if (a.content !== undefined && a.selected !== undefined)
      throw Error(
        "请选择全文替换或片段替换 / Choose full or selection replacement",
      );
    let next = a.content;
    if (a.selected !== undefined && a.replacement !== undefined) {
      if (original.split(a.selected).length !== 2)
        throw Error("选中片段不存在或不唯一 / Selection missing or ambiguous");
      next = original.replace(a.selected, a.replacement);
    }
    if (next === undefined) throw Error("缺少修改内容 / Missing replacement");
    const expected = canonical(draft ?? null),
      before = catalogSignature();
    if (
      !(await confirm(
        `编辑解释草稿：${entry.title}\n\n原内容：\n${original}\n\n新内容：\n${next}`,
      ))
    )
      return { cancelled: true };
    await entryWorkspace.applyAIResult(entry.id, receipt, () => {
      if (
        !active() ||
        before !== catalogSignature() ||
        expected !==
          canonical(entryWorkspace.getSnapshot().drafts[entry.id] ?? null)
      )
        throw Error(
          "审阅期间正文或草稿已改变，请重新生成 / Draft changed while confirming",
        );
      return {
        title: draft?.title ?? entry.title,
        summary: draft?.summary ?? entry.summary ?? "",
        content: next!,
        editing: true,
        sourceMode: draft?.sourceMode ?? false,
        focus: null,
        base: draft?.editing
          ? draft.base
          : {
              title: entry.title,
              content: entry.content,
              summary: entry.summary ?? "",
            },
      };
    });
    window.dispatchEvent(
      new CustomEvent("zhinexus:ai-draft", { detail: { id: entry.id } }),
    );
    return { id: entry.id, draft: true, requiresSave: true };
  }
  const graphTool = [
    "create_graph_relation",
    "update_graph_relation",
    "delete_graph_relation",
    "arrange_knowledge_graph",
    "move_graph_nodes",
  ].includes(name);
  const before = catalogSignature(graphTool),
    patches: StorePatch[] = [],
    now = new Date().toISOString();
  let result: unknown = { ok: true };
  let description: string = def.description;
  const categoryName = (id: string) =>
    s.categories.find((c) => c.id === id)?.name ?? (id ? id : "未分类/顶层");
  const assertCategory = (id: string) => {
    if (id && !s.categories.some((c) => c.id === id))
      throw Error("分类不存在 / Category missing");
  };
  if (name === "move_graph_nodes") {
    if (new Set(a.positions!.map((n) => n.id)).size !== a.positions!.length)
      throw Error("移动列表存在重复节点 / Duplicate graph node");
    if (a.positions!.some((n) => !s.entries.some((e) => e.id === n.id)))
      throw Error("移动列表包含未知条目 / Unknown graph node");
    patches.push({
      collection: "setting",
      id: "graph",
      patch: Object.fromEntries(
        a.positions!.map((n) => [n.id, json({ x: n.x, y: n.y })]),
      ),
    });
    result = { moved: a.positions!.length };
    description = `移动星图节点：\n${a.positions!.map((n) => `${s.entries.find((e) => e.id === n.id)?.title} → (${n.x}, ${n.y})`).join("\n")}\n其他节点位置保留。`;
  } else if (name === "arrange_knowledge_graph") {
    patches.push(...(await graphLayoutPatches()));
    result = { nodes: s.entries.length };
    description = `自动排列星图：${s.entries.length} 个节点，${graphEdges().length} 条关系。根据关系从左到右排列并保存，覆盖当前节点位置。`;
  } else if (
    name === "create_graph_relation" ||
    name === "update_graph_relation"
  ) {
    const existing =
      name === "update_graph_relation"
        ? graphEdges().find((e) => e.id === a.id)
        : undefined;
    if (name === "update_graph_relation" && !existing)
      throw Error("关系不存在 / Graph relationship missing");
    if (
      existing &&
      a.source === undefined &&
      a.target === undefined &&
      a.type === undefined &&
      a.reason === undefined
    )
      throw Error("未提供修改字段 / No changes supplied");
    const proposal = {
      source: a.source ?? existing!.source,
      target: a.target ?? existing!.target,
      type: a.type ?? existing!.type,
      reason: a.reason ?? existing?.reason ?? "",
    };
    const changed = relationPatches([proposal], existing?.id);
    if (existing && !changed.length)
      throw Error(
        "这两个条目已有其他关系 / Another relationship already connects this pair",
      );
    patches.push(...changed);
    const reused =
      !existing && !changed.length
        ? graphEdges().find(
            (e) =>
              (e.source === proposal.source && e.target === proposal.target) ||
              (e.target === proposal.source && e.source === proposal.target),
          )
        : undefined;
    result = {
      id: existing?.id ?? changed[0]?.id ?? reused?.id,
      reused: !!reused,
    };
    const displayed = reused ?? proposal;
    description = `${existing ? "修改" : reused ? "保留已有" : "新增"}知识关系：${s.entries.find((e) => e.id === displayed.source)?.title} → ${s.entries.find((e) => e.id === displayed.target)?.title}\n${existing ? `原类型：${existing.type}\n` : ""}类型：${displayed.type}\n依据：${displayed.reason}`;
  } else if (name === "delete_graph_relation") {
    const edge = graphEdges().find((e) => e.id === a.id);
    if (!edge) throw Error("关系不存在 / Graph relationship missing");
    patches.push({ collection: "edge", id: edge.id, patch: { deleted: true } });
    description = `删除知识关系：${s.entries.find((e) => e.id === edge.source)?.title} → ${s.entries.find((e) => e.id === edge.target)?.title}\n类型：${edge.type}\n依据：${edge.reason}`;
    result = { id: edge.id, deleted: true };
  } else if (name === "create_entry") {
    assertCategory(a.category ?? "");
    const existing = s.entries.find(
        (e) => e.title.toLocaleLowerCase() === a.title!.toLocaleLowerCase(),
      ),
      entryId = existing?.id ?? receipt.replace("tool-", "");
    result = { id: entryId, reused: !!existing };
    if (!existing)
      patches.push({
        collection: "entry",
        id: entryId,
        patch: json({
          title: a.title,
          content: a.content ?? entryTemplate,
          category: a.category ?? "",
          tags: a.tags ?? [],
          color: a.color ?? "none",
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
    description = `创建词条：${a.title}\n分类：${categoryName(a.category ?? "")}\n${a.content ?? entryTemplate}`;
  } else if (
    ["update_entry", "move_entry", "delete_entry", "restore_entry"].includes(
      name,
    )
  ) {
    const entry = s.entries.find((e) => e.id === a.id),
      deleted = s.docs.find(
        (d) =>
          d.collection === "entry" &&
          d.id === a.id &&
          d.fields.deleted === true,
      );
    if (name === "restore_entry") {
      if (!deleted) throw Error("回收站词条不存在 / Deleted entry missing");
      const restoredCategory = String(deleted.fields.category ?? "");
      patches.push({
        collection: "entry",
        id: a.id!,
        patch: {
          deleted: false,
          category: s.categories.some((c) => c.id === restoredCategory)
            ? restoredCategory
            : "",
          updatedAt: now,
        },
      });
      description = `恢复词条：${deleted.fields.title}`;
    } else {
      if (!entry) throw Error("词条不存在 / Entry missing");
      const patch: Record<string, Json> = { updatedAt: now };
      if (name === "delete_entry") patch.deleted = true;
      else {
        for (const key of [
          "title",
          "content",
          "summary",
          "category",
          "tags",
          "color",
        ] as const)
          if (a[key] !== undefined) patch[key] = a[key]!;
        if (a.category !== undefined) assertCategory(a.category);
        if (Object.keys(patch).length === 1)
          throw Error("未提供修改字段 / No changes supplied");
      }
      patches.push({ collection: "entry", id: entry.id, patch });
      description = `${name === "delete_entry" ? "删除词条" : "修改词条"}：${entry.title}\n${JSON.stringify(patch, null, 2)}`;
    }
  } else if (name === "create_category") {
    assertCategory(a.parent ?? "");
    const existing = s.categories.find(
        (c) => c.name === a.name && c.parent === (a.parent ?? ""),
      ),
      categoryId = existing?.id ?? "category-" + receipt.replace("tool-", "");
    if (!existing)
      patches.push({
        collection: "category",
        id: categoryId,
        patch: { name: a.name!, parent: a.parent ?? "" },
      });
    result = { id: categoryId, reused: !!existing };
    description = `添加分类：${a.name}\n父分类：${categoryName(a.parent ?? "")}`;
  } else {
    const category = s.categories.find((c) => c.id === a.id);
    if (!category) throw Error("分类不存在 / Category missing");
    if (name === "delete_category") {
      patches.push(...categoryRemovalPlan(category.id, a.mode ?? "keep"));
      description = `删除分类：${category.name}\n${a.mode === "all" ? "删除全部子分类和条目" : "保留子分类和条目，移至上一级"}\n${patches.map((p) => `${p.collection === "entry" ? "词条" : "分类"}：${s.entries.find((e) => e.id === p.id)?.title ?? s.categories.find((c) => c.id === p.id)?.name ?? p.id}`).join("\n")}`;
    } else {
      const nextParent = a.parent ?? category.parent;
      validateCategoryMove(s.categories, category.id, nextParent);
      if (a.name === undefined && a.parent === undefined)
        throw Error("未提供修改字段 / No changes supplied");
      patches.push({
        collection: "category",
        id: category.id,
        patch: { name: a.name ?? category.name, parent: nextParent },
      });
      description = `修改分类：${category.name} → ${a.name ?? category.name}\n父分类：${categoryName(category.parent)} → ${categoryName(nextParent)}`;
    }
  }
  if (!(await confirm(description))) return { cancelled: true };
  const committed = await store.batchWhen(
    [
      ...patches,
      {
        collection: "setting",
        id: receipt,
        patch: { status: "done", result: json(result) },
      },
    ],
    "agent-tool",
    () =>
      active() &&
      prior()?.fields.status !== "done" &&
      before === catalogSignature(graphTool),
  );
  if (!committed) {
    if (prior()?.fields.status === "done") return prior()!.fields.result;
    throw Error(
      "确认期间数据已改变，请重新生成操作 / Data changed while confirming",
    );
  }
  return result;
}
