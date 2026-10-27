/** Durable queue, review ownership, approval ordering and cancellation across request stages. */
import { expect, it, vi } from "vitest";
import { AIQueue, type AIExecutor } from "./ai-queue";
import type { AIJob, NewAIJob } from "./ai-jobs";
const input: NewAIJob = {
  kind: "explain",
  title: "fixture",
  target: { page: "entry", entryId: "entry" },
  input: {},
  base: {},
};
/** In-memory durable storage that clones writes just like the SQLite JSON boundary. */
function setup(execute: AIExecutor) {
  let persisted: AIJob[] = [];
  const save = vi.fn(async (rows: AIJob[]) => {
    persisted = structuredClone(rows);
  });
  const storage = { load: async () => structuredClone(persisted), save };
  return {
    queue: new AIQueue(storage, execute),
    storage,
    save,
    persisted: () => persisted,
  };
}
it("keeps complete output until explicit removal and restores a pending review", async () => {
  const env = setup(async (_job, ctx) =>
    ctx.request("explain", async (progress) => {
      progress({ content: "partial" });
      progress({ content: "complete" });
      return { content: "complete" };
    }),
  );
  await env.queue.init();
  const id = await env.queue.submit(input);
  await vi.waitFor(() => expect(env.queue.find(id).state).toBe("review"));
  await env.queue.flush();
  expect(env.queue.find(id).stages[0].content).toBe("complete");
  const retry = vi.fn(async () => ({}));
  const restored = new AIQueue(env.storage, retry);
  await restored.init();
  expect(restored.find(id).state).toBe("review");
  expect(retry).not.toHaveBeenCalled();
  await restored.remove(id);
  expect(restored.getSnapshot().jobs).toEqual([]);
  expect(env.persisted()).toEqual([]);
});
it("does not hold an HTTP slot while awaiting a persisted tool approval", async () => {
  const calls: string[] = [];
  const env = setup(async (job, ctx) => {
    await ctx.request("agent", async () => {
      calls.push(job.title);
      return {};
    });
    if (job.title === "approval") {
      const ok = await ctx.confirm("reviewable action");
      calls.push(ok ? "approved" : "denied");
    }
    return {};
  });
  await env.queue.init();
  env.queue.limiter.setLimit(1);
  const first = await env.queue.submit({ ...input, title: "approval" });
  await vi.waitFor(() => expect(env.queue.find(first).state).toBe("approval"));
  expect(env.queue.limiter.counts.active).toBe(0);
  const second = await env.queue.submit({ ...input, title: "second" });
  await vi.waitFor(() => expect(env.queue.find(second).state).toBe("review"));
  expect(calls).toEqual(["approval", "second"]);
  await env.queue.decide(first, true);
  await vi.waitFor(() => expect(env.queue.find(first).state).toBe("review"));
  expect(calls.at(-1)).toBe("approved");
});
it("failed removal retains the item and retry only removes it after persistence", async () => {
  const env = setup(async () => ({ content: "ready" }));
  await env.queue.init();
  const id = await env.queue.submit(input);
  await vi.waitFor(() => expect(env.queue.find(id).state).toBe("review"));
  await env.queue.flush();
  env.save.mockRejectedValueOnce(Error("disk failure"));
  await expect(env.queue.remove(id)).rejects.toThrow("disk failure");
  expect(env.queue.find(id).state).toBe("review");
  await env.queue.remove(id);
  expect(env.queue.getSnapshot().jobs).toHaveLength(0);
});
it("rejects approval when its acknowledgement cannot be saved", async () => {
  let executed = false;
  const env = setup(async (_job, ctx) => {
    if (await ctx.confirm("write")) executed = true;
    return {};
  });
  await env.queue.init();
  const id = await env.queue.submit(input);
  await vi.waitFor(() => expect(env.queue.find(id).state).toBe("approval"));
  await env.queue.flush();
  env.save.mockRejectedValueOnce(Error("approval disk failure"));
  await expect(env.queue.decide(id, true)).rejects.toThrow();
  expect(executed).toBe(false);
  expect(env.queue.find(id).state).toBe("approval");
  await env.queue.decide(id, false);
  await vi.waitFor(() => expect(env.queue.find(id).state).toBe("review"));
  expect(executed).toBe(false);
});
it("does not apply or publish a late response after cancellation", async () => {
  let release = () => {};
  const env = setup(async (_job, ctx) =>
    ctx.request("explain", async (progress) => {
      progress({ content: "partial" });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      progress({ content: "obsolete" });
      return { content: "obsolete" };
    }),
  );
  await env.queue.init();
  const id = await env.queue.submit(input);
  await vi.waitFor(() =>
    expect(env.queue.find(id).stages[0]?.content).toBe("partial"),
  );
  await env.queue.cancel(id);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(env.queue.find(id)).toMatchObject({
    state: "cancelled",
    stages: [{ content: "partial" }],
  });
  expect(env.queue.find(id).result).toBeUndefined();
});
it("restores interrupted work without reissuing it and keeps follower windows read-only", async () => {
  const env = setup(async () => ({}));
  await env.queue.init();
  await env.storage.save([
    {
      ...input,
      id: "interrupted",
      state: "running",
      stages: [],
      error: "",
      createdAt: "now",
      updatedAt: "now",
    },
  ]);
  const execute = vi.fn(async () => ({}));
  const restored = new AIQueue(env.storage, execute);
  await restored.init();
  expect(restored.find("interrupted").state).toBe("error");
  expect(execute).not.toHaveBeenCalled();
  const follower = new AIQueue(env.storage, execute);
  await follower.init(true);
  await expect(follower.submit(input)).rejects.toThrow("另一个窗口");
  await expect(follower.remove("interrupted")).rejects.toThrow("另一个窗口");
  expect(follower.find("interrupted")).toBeDefined();
});
it("serializes turns in the same topic while other topics can make progress", async () => {
  let release = () => {};
  const started: string[] = [];
  const env = setup(async (job) => {
    started.push(job.title);
    if (job.title === "first")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return {};
  });
  await env.queue.init();
  const chat = {
    ...input,
    kind: "chat" as const,
    target: { page: "agent" as const, topicId: "topic" },
  };
  await env.queue.submit({ ...chat, title: "first" });
  const second = await env.queue.submit({ ...chat, title: "second" });
  await env.queue.submit({
    ...chat,
    title: "other",
    target: { page: "agent", topicId: "other" },
  });
  await vi.waitFor(() => expect(started).toEqual(["first", "other"]));
  release();
  await vi.waitFor(() => expect(env.queue.find(second).state).toBe("review"));
  expect(started).toEqual(["first", "other", "second"]);
});
