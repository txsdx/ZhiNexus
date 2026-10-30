/** Generated priorities remain proposals, preserve overrides, and cannot race a paused review or duplicate a durable apply. */
import { beforeEach, expect, it, vi } from "vitest";
import type { AIJob, AIJobContext } from "../core/ai-jobs";
import { rememberedCard } from "../core/review";
const fixture = vi.hoisted(() => ({
  state: {} as any,
  job: {} as AIJob,
  commits: [] as any[],
  beforeCommit: () => {},
  fail: false,
  remove: vi.fn(async () => {}),
  generate: vi.fn(),
  log: vi.fn(),
}));
vi.mock("./ai-jobs", () => ({
  aiJobs: {
    assertWritable: () => {},
    find: () => fixture.job,
    remove: () => fixture.remove(),
  },
}));
vi.mock("./ai", () => ({
  runTask: (...args: unknown[]) => fixture.generate(...args),
  complete: vi.fn(),
  generateImage: vi.fn(),
  parseJson: JSON.parse,
}));
vi.mock("./diagnostics", () => ({
  diagnostics: { error: (...args: unknown[]) => fixture.log(...args) },
}));
vi.mock("../core/workspace", () => ({
  entryWorkspace: { isDirty: () => false },
}));
vi.mock("../core/store", () => {
  const commit = async (
    patches: any[],
    _source: string,
    guard: () => boolean,
  ) => {
    fixture.beforeCommit();
    if (!guard()) return false;
    if (fixture.fail) throw Error("disk full");
    fixture.commits.push(patches);
    for (const item of patches) {
      if (item.collection === "entry")
        fixture.state.entries = fixture.state.entries.map((entry: any) =>
          entry.id === item.id ? { ...entry, ...item.patch } : entry,
        );
      else if (item.collection === "review")
        fixture.state.reviews = fixture.state.reviews.map((review: any) =>
          review.id === item.id ? { ...review, ...item.patch } : review,
        );
      else
        fixture.state.docs.push({
          collection: item.collection,
          id: item.id,
          fields: item.patch,
        });
    }
    return true;
  };
  return {
    json: (value: unknown) => JSON.parse(JSON.stringify(value)),
    store: {
      getSnapshot: () => fixture.state,
      batchWhen: commit,
      patchWhen: (
        collection: string,
        id: string,
        patch: unknown,
        source: string,
        guard: () => boolean,
      ) => commit([{ collection, id, patch }], source, guard),
    },
  };
});
import { executeAIJob } from "./ai-workflows";
import { applyAIJob } from "./ai-apply";
const context: AIJobContext = {
  signal: new AbortController().signal,
  request: async (_task, work) => work(() => {}),
  confirm: async () => true,
  check: () => {},
};
beforeEach(() => {
  const entry = {
    id: "entry",
    title: "概念",
    content: "原始材料",
    category: "",
    tags: [],
    prerequisites: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    card: rememberedCard(),
    reviewCount: 0,
  };
  fixture.state = { entries: [entry], categories: [], docs: [], reviews: [] };
  fixture.commits = [];
  fixture.fail = false;
  fixture.beforeCommit = () => {};
  fixture.remove.mockReset().mockResolvedValue();
  fixture.generate.mockReset();
  fixture.log.mockClear();
  fixture.job = {
    id: crypto.randomUUID(),
    kind: "explain",
    title: "explain",
    target: { page: "entry", entryId: "entry" },
    input: {},
    base: {
      entry: {
        id: "entry",
        title: entry.title,
        content: entry.content,
        category: "",
        prerequisites: [],
        importance: null,
      },
    },
    state: "review",
    stages: [],
    error: "",
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
});
it("explanation and assessment use independent real task stages and remain unapplied until review", async () => {
  fixture.generate.mockImplementation(async (task) =>
    task === "importance"
      ? JSON.stringify({ level: "high", reason: "可迁移的基础概念" })
      : "# 完整解释",
  );
  const result = await executeAIJob(fixture.job, context);
  expect(result).toEqual({
    content: "# 完整解释",
    importance: { level: "high", reason: "可迁移的基础概念" },
  });
  expect(fixture.generate.mock.calls.map((call) => call[0])).toEqual([
    "explain",
    "importance",
  ]);
  expect(fixture.commits).toHaveLength(0);
  fixture.job.result = result;
  await applyAIJob(fixture.job.id);
  expect(fixture.commits).toHaveLength(1);
  expect(fixture.state.entries[0]).toMatchObject({
    content: "# 完整解释",
    importance: { level: "high", mode: "auto", reason: "可迁移的基础概念" },
    reviewCount: 0,
  });
  expect(fixture.commits[0]).toHaveLength(2);
  expect(fixture.commits[0][0].patch).not.toHaveProperty("card");
});
it("a manual priority avoids unnecessary automatic assessment and explanation application preserves a later manual choice even with force", async () => {
  (fixture.job.base.entry as any).importance = {
    level: "normal",
    mode: "manual",
  };
  fixture.generate.mockResolvedValue("解释");
  expect(await executeAIJob(fixture.job, context)).toEqual({ content: "解释" });
  expect(fixture.generate).toHaveBeenCalledTimes(1);
  fixture.state.entries[0].importance = { level: "low", mode: "manual" };
  fixture.job.result = {
    content: "生成解释",
    importance: { level: "high", reason: "AI依据" },
  };
  await applyAIJob(fixture.job.id, true);
  expect(fixture.state.entries[0].importance).toEqual({
    level: "low",
    mode: "manual",
  });
  expect(fixture.state.entries[0].content).toBe("生成解释");
});
it("invalid or failed importance data retains the successful explanation and reports an incomplete assessment", async () => {
  fixture.generate.mockImplementation(async (task) =>
    task === "importance" ? '{"level":"low"}' : "已生成的完整解释",
  );
  const result = await executeAIJob(fixture.job, context);
  expect(result).toMatchObject({
    content: "已生成的完整解释",
    importanceError: expect.stringContaining("retained"),
  });
  expect(result).not.toHaveProperty("importance");
  expect(fixture.log).toHaveBeenCalledOnce();
});
it("durability failure retains both old fields and retry of task cleanup never repeats a committed proposal", async () => {
  fixture.job.result = {
    content: "生成解释",
    importance: { level: "low", reason: "一次性资料" },
  };
  fixture.fail = true;
  await expect(applyAIJob(fixture.job.id)).rejects.toThrow("disk full");
  expect(fixture.state.entries[0].content).toBe("原始材料");
  expect(fixture.state.entries[0].importance).toBeUndefined();
  fixture.fail = false;
  fixture.remove.mockRejectedValueOnce(Error("queue save failed"));
  await expect(applyAIJob(fixture.job.id)).rejects.toThrow("queue save failed");
  await applyAIJob(fixture.job.id);
  expect(fixture.commits).toHaveLength(1);
  expect(fixture.state.entries[0].importance).toEqual({
    level: "low",
    mode: "auto",
    reason: "一次性资料",
  });
});
it("a queued manual change blocks the whole proposal instead of overwriting a newer register", async () => {
  fixture.job.result = {
    content: "生成解释",
    importance: { level: "high", reason: "基础" },
  };
  fixture.beforeCommit = () => {
    fixture.state.entries[0].importance = { level: "low", mode: "manual" };
  };
  await expect(applyAIJob(fixture.job.id)).rejects.toThrow("changed");
  expect(fixture.commits).toHaveLength(0);
  expect(fixture.state.entries[0].content).toBe("原始材料");
});
it("standalone assessment may unlock a reviewed original manual value but cannot override a newer manual decision", async () => {
  fixture.job.kind = "importance";
  fixture.job.result = { importance: { level: "high", reason: "基础" } };
  fixture.state.entries[0].importance = { level: "low", mode: "manual" };
  await expect(applyAIJob(fixture.job.id, true)).rejects.toThrow(
    "Importance changed",
  );
  (fixture.job.base.entry as any).importance = { level: "low", mode: "manual" };
  fixture.job.reviewData = {
    ...(fixture.job.result as any),
    importanceManual: true,
  };
  await applyAIJob(fixture.job.id);
  expect(fixture.state.entries[0].importance).toEqual({
    level: "high",
    mode: "manual",
  });
});
it("late AI question and grade responses cannot update a session made exempt while the request was in flight", async () => {
  fixture.state.reviews = [
    {
      id: "session",
      entryId: "entry",
      phase: "answer",
      question: {
        question: "题目",
        type: "short",
        choices: [],
        answer: "答案",
        rubric: "标准",
      },
      answer: "用户回答",
      grade: null,
    },
  ];
  const original = JSON.stringify(fixture.state.reviews);
  fixture.job.kind = "grade";
  fixture.job.target.sessionId = "session";
  fixture.job.base.question = fixture.state.reviews[0].question;
  fixture.job.base.answer = "用户回答";
  fixture.generate.mockImplementation(async () => {
    fixture.state.entries[0].importance = { level: "low", mode: "manual" };
    return JSON.stringify({
      score: 90,
      feedback: "反馈",
      missing: "",
      lesson: "教学",
    });
  });
  await expect(executeAIJob(fixture.job, context)).rejects.toThrow("changed");
  expect(JSON.stringify(fixture.state.reviews)).toBe(original);
  fixture.state.entries[0].importance = { level: "normal", mode: "manual" };
  fixture.job.kind = "question";
  fixture.job.input.replace = true;
  fixture.generate.mockImplementation(async () => {
    fixture.state.entries[0].importance = { level: "low", mode: "manual" };
    return JSON.stringify({
      question: "新的题目",
      type: "short",
      choices: [],
      answer: "答案",
      rubric: "标准",
    });
  });
  await expect(executeAIJob(fixture.job, context)).rejects.toThrow("changed");
  expect(JSON.stringify(fixture.state.reviews)).toBe(original);
  expect(fixture.commits).toHaveLength(0);
});
