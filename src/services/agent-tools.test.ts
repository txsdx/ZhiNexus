/** Agent controls have strict schemas, explicit previews, atomic receipts and stale/cancelled-operation protection. */
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  state: {} as any,
  workspace: { drafts: {} as Record<string, any>, aiApplied: [] as string[] },
  commits: [] as any[],
  fail: false,
  flush: vi.fn(async () => {}),
}));
vi.mock("../core/store", () => ({
  store: {
    getSnapshot: () => fixture.state,
    batchWhen: async (
      patches: any[],
      _source: string,
      guard: () => boolean,
    ) => {
      if (!guard()) return false;
      if (fixture.fail) throw Error("disk full");
      fixture.commits.push(patches);
      for (const p of patches) {
        const existing = fixture.state.docs.find(
          (d: any) => d.collection === p.collection && d.id === p.id,
        );
        if (existing) Object.assign(existing.fields, p.patch);
        else
          fixture.state.docs.push({
            collection: p.collection,
            id: p.id,
            fields: p.patch,
          });
      }
      return true;
    },
  },
  json: (value: unknown) => JSON.parse(JSON.stringify(value)),
}));
vi.mock("../core/workspace", () => ({
  entryWorkspace: {
    init: async () => {},
    getSnapshot: () => fixture.workspace,
    flush: () => fixture.flush(),
    applyAIResult: async (
      id: string,
      receipt: string,
      create: () => unknown,
    ) => {
      if (!fixture.workspace.aiApplied.includes(receipt)) {
        fixture.workspace.drafts[id] = create();
        fixture.workspace.aiApplied.push(receipt);
      }
      await fixture.flush();
    },
  },
}));
import { executeKnowledgeTool, knowledgeTools } from "./agent-tools";
import { rememberedCard } from "../core/review";
it("batch graph moves preserve unrelated positions and reject duplicate or stale node edits", async () => {
  const approve = vi.fn(async () => true);
  fixture.state.docs.push({
    collection: "setting",
    id: "graph",
    fields: { other: { x: 12, y: 34 } },
  });
  await executeKnowledgeTool(
    "move_graph_nodes",
    { positions: [{ id: "entry", x: 100, y: 200 }] },
    "tool-move-nodes",
    approve,
  );
  const positions = fixture.state.docs.find(
    (d: any) => d.collection === "setting" && d.id === "graph",
  ).fields;
  expect(positions).toMatchObject({
    entry: { x: 100, y: 200 },
    other: { x: 12, y: 34 },
  });
  await expect(
    executeKnowledgeTool(
      "move_graph_nodes",
      {
        positions: [
          { id: "entry", x: 1, y: 2 },
          { id: "entry", x: 3, y: 4 },
        ],
      },
      "tool-duplicate",
      approve,
    ),
  ).rejects.toThrow(/重复/);
  await expect(
    executeKnowledgeTool(
      "move_graph_nodes",
      { positions: [{ id: "entry", x: 5, y: 6 }] },
      "tool-stale-layout",
      async () => {
        positions.entry = { x: 900, y: 900 };
        return true;
      },
    ),
  ).rejects.toThrow(/已改变/);
  expect(positions.entry).toEqual({ x: 900, y: 900 });
});
it("graph queries are readonly; create/edit/delete relations share review, receipts and cancellation guards", async () => {
  const other = { ...fixture.state.entries[0], id: "other", title: "进阶概念" };
  fixture.state.entries.push(other);
  fixture.state.docs.push({
    collection: "entry",
    id: "other",
    fields: { ...other },
  });
  const approve = vi.fn(async () => true),
    deny = vi.fn(async () => false);
  const view = (await executeKnowledgeTool(
    "get_knowledge_graph",
    {},
    "query",
    approve,
  )) as any;
  expect(view.totalNodes).toBe(2);
  expect(approve).not.toHaveBeenCalled();
  const args = {
    source: "entry",
    target: "other",
    type: "prerequisite",
    reason: "理解进阶前需要基础",
  };
  const created = (await executeKnowledgeTool(
    "create_graph_relation",
    args,
    "tool-graph-create",
    approve,
  )) as { id: string };
  expect(approve).toHaveBeenCalledOnce();
  expect(
    fixture.state.docs.find((d: any) => d.id === created.id).fields.label,
  ).toBe("prerequisite");
  await executeKnowledgeTool(
    "create_graph_relation",
    args,
    "tool-graph-create",
    approve,
  );
  expect(approve).toHaveBeenCalledOnce();
  await executeKnowledgeTool(
    "update_graph_relation",
    { id: created.id, type: "progression" },
    "tool-graph-update",
    approve,
  );
  expect(
    fixture.state.docs.find((d: any) => d.id === created.id).fields.label,
  ).toBe("progression");
  await executeKnowledgeTool(
    "delete_graph_relation",
    { id: created.id },
    "tool-graph-deny",
    deny,
  );
  expect(
    fixture.state.docs.find((d: any) => d.id === created.id).fields.deleted,
  ).not.toBe(true);
  await expect(
    executeKnowledgeTool(
      "delete_graph_relation",
      { id: created.id },
      "tool-graph-stale",
      async () => {
        fixture.state.docs.find((d: any) => d.id === created.id).fields.reason =
          "concurrent edit";
        return true;
      },
    ),
  ).rejects.toThrow(/已改变/);
  expect(
    fixture.state.docs.find((d: any) => d.id === created.id).fields.deleted,
  ).not.toBe(true);
  await executeKnowledgeTool(
    "delete_graph_relation",
    { id: created.id },
    "tool-graph-delete",
    approve,
  );
  expect(
    fixture.state.docs.find((d: any) => d.id === created.id).fields.deleted,
  ).toBe(true);
});
beforeEach(() => {
  vi.clearAllMocks();
  fixture.fail = false;
  fixture.commits = [];
  fixture.workspace = { drafts: {}, aiApplied: [] };
  fixture.flush.mockResolvedValue(undefined);
  const entry = {
    id: "entry",
    title: "原词条",
    content: "原句。其他内容。",
    category: "child",
    tags: [],
    prerequisites: [],
    card: rememberedCard(),
    reviewCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fixture.state = {
    entries: [entry],
    categories: [
      { id: "root", name: "大类", parent: "" },
      { id: "child", name: "子类", parent: "root" },
    ],
    topics: [],
    reviews: [],
    device: { lastSync: "" },
    docs: [
      { id: "entry", collection: "entry", fields: { ...entry } },
      {
        id: "root",
        collection: "category",
        fields: { name: "大类", parent: "" },
      },
      {
        id: "child",
        collection: "category",
        fields: { name: "子类", parent: "root" },
      },
    ],
  };
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});
it("publishes distinct required arguments for every tool rather than one permissive shared schema", () => {
  expect(knowledgeTools.length).toBeGreaterThanOrEqual(17);
  const remove = knowledgeTools.find(
    (t) => t.function.name === "delete_category",
  )!;
  expect(remove.function.parameters.required).toContain("id");
  expect(remove.function.parameters.additionalProperties).toBe(false);
});
it("readonly searches and software state never request approval or expose credentials", async () => {
  fixture.state.device.apiKey = "private-sentinel";
  const confirm = vi.fn(async (_description: string) => true);
  const result = await executeKnowledgeTool(
    "get_app_state",
    {},
    "read",
    confirm,
  );
  expect(JSON.stringify(result)).not.toContain("sentinel");
  await executeKnowledgeTool(
    "get_entry",
    { id: "entry" },
    "read-entry",
    confirm,
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(fixture.commits).toHaveLength(0);
});
it("a declined deletion and a cancelled task do not commit anything", async () => {
  expect(
    await executeKnowledgeTool(
      "delete_entry",
      { id: "entry" },
      "delete",
      async () => false,
    ),
  ).toEqual({ cancelled: true });
  await expect(
    executeKnowledgeTool(
      "delete_entry",
      { id: "entry" },
      "cancelled",
      async () => true,
      () => false,
    ),
  ).rejects.toThrow("changed");
  expect(fixture.commits).toHaveLength(0);
});
it("knowledge and its receipt commit together once, even when a delivery is repeated", async () => {
  const confirm = vi.fn(async (_description: string) => true);
  await executeKnowledgeTool(
    "create_entry",
    { title: "新增", category: "root", content: "正文" },
    "tool-create",
    confirm,
  );
  await executeKnowledgeTool(
    "create_entry",
    { title: "新增", category: "root", content: "正文" },
    "tool-create",
    confirm,
  );
  expect(fixture.commits).toHaveLength(1);
  expect(fixture.commits[0].map((p: any) => p.collection)).toEqual([
    "entry",
    "setting",
  ]);
  expect(fixture.commits[0][0].patch.reviewCount).toBe(0);
  expect(
    new Date(fixture.commits[0][0].patch.card.due).getTime(),
  ).toBeGreaterThan(Date.now());
  expect(confirm).toHaveBeenCalledOnce();
});
it("subtree deletion describes each affected entry and atomically includes the receipt", async () => {
  const confirm = vi.fn(async (_description: string) => true);
  await executeKnowledgeTool(
    "delete_category",
    { id: "root", mode: "all" },
    "tool-tree",
    confirm,
  );
  expect(confirm.mock.calls[0]?.[0]).toContain("原词条");
  expect(new Set(fixture.commits[0].map((p: any) => p.id))).toEqual(
    new Set(["root", "child", "entry", "tool-tree"]),
  );
});
it("moving a category into its descendant is rejected before approval", async () => {
  const confirm = vi.fn(async (_description: string) => true);
  await expect(
    executeKnowledgeTool(
      "move_category",
      { id: "root", parent: "child" },
      "cycle",
      confirm,
    ),
  ).rejects.toThrow("cycle");
  expect(confirm).not.toHaveBeenCalled();
  expect(fixture.commits).toHaveLength(0);
});
it("a concurrent edit or storage failure never produces a successful receipt", async () => {
  await expect(
    executeKnowledgeTool(
      "update_entry",
      { id: "entry", content: "建议" },
      "stale",
      async () => {
        fixture.state.docs[0].fields.content = "并发编辑";
        return true;
      },
    ),
  ).rejects.toThrow("changed");
  expect(fixture.commits).toHaveLength(0);
  fixture.fail = true;
  await expect(
    executeKnowledgeTool(
      "delete_entry",
      { id: "entry" },
      "fail",
      async () => true,
    ),
  ).rejects.toThrow("disk full");
  expect(fixture.state.docs.some((d: any) => d.id === "fail")).toBe(false);
});
it("explanation edits apply to the reviewed draft once, preserving the surrounding text and requiring Save", async () => {
  const result = await executeKnowledgeTool(
    "edit_explanation",
    { id: "entry", selected: "原句", replacement: "改写句" },
    "draft",
    async () => true,
  );
  expect(result).toMatchObject({ draft: true, requiresSave: true });
  expect(fixture.workspace.drafts.entry.content).toBe("改写句。其他内容。");
  expect(fixture.state.entries[0].content).toBe("原句。其他内容。");
  expect(fixture.commits).toHaveLength(0);
  await executeKnowledgeTool(
    "edit_explanation",
    { id: "entry", content: "不得重复替换" },
    "draft",
    async () => true,
  );
  expect(fixture.workspace.drafts.entry.content).toBe("改写句。其他内容。");
  expect(fixture.flush).toHaveBeenCalledTimes(2);
});
it("a changed local draft or ambiguous selected text rejects a stale proposal", async () => {
  fixture.workspace.drafts.entry = {
    content: "原句。其他内容。",
    editing: true,
  };
  await expect(
    executeKnowledgeTool(
      "edit_explanation",
      { id: "entry", selected: "原句", replacement: "修改" },
      "draft-stale",
      async () => {
        fixture.workspace.drafts.entry.content = "用户继续输入";
        return true;
      },
    ),
  ).rejects.toThrow("changed");
  fixture.state.entries[0].content = "重复重复";
  fixture.workspace.drafts = {};
  await expect(
    executeKnowledgeTool(
      "edit_explanation",
      { id: "entry", selected: "重复", replacement: "修改" },
      "ambiguous",
      async () => true,
    ),
  ).rejects.toThrow("ambiguous");
});

it("AI bookmark changes require review and atomically reuse the existing receipt without changing content", async () => {
  const before = {
    ...fixture.state.docs.find((d: any) => d.collection === "entry").fields,
  };
  expect(
    await executeKnowledgeTool(
      "update_entry",
      { id: "entry", starred: true },
      "star-denied",
      async () => false,
    ),
  ).toEqual({ cancelled: true });
  expect(fixture.commits).toHaveLength(0);
  const approve = vi.fn(async () => true);
  await executeKnowledgeTool(
    "update_entry",
    { id: "entry", starred: true },
    "star-confirmed",
    approve,
  );
  await executeKnowledgeTool(
    "update_entry",
    { id: "entry", starred: true },
    "star-confirmed",
    approve,
  );
  expect(approve).toHaveBeenCalledOnce();
  expect(fixture.commits).toHaveLength(1);
  const result = fixture.state.docs.find(
    (d: any) => d.collection === "entry",
  ).fields;
  expect(result.starred).toBe(true);
  expect(result.content).toBe(before.content);
  expect(result.card).toEqual(before.card);
  expect(fixture.commits[0].some((p: any) => p.collection === "setting")).toBe(
    true,
  );
});
