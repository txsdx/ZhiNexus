/** Read-only MCP queries run without approval; unknown/destructive or uncertain prior writes remain gated. */
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  state: {} as any,
  complete: vi.fn(),
  call: vi.fn(),
  list: vi.fn(),
  patch: vi.fn(),
  patchWhen: vi.fn(),
}));
vi.mock("../core/store", () => ({
  store: {
    getSnapshot: () => mock.state,
    patch: mock.patch,
    patchWhen: mock.patchWhen,
  },
  json: (value: unknown) => structuredClone(value),
}));
vi.mock("./ai", () => ({
  complete: mock.complete,
  renderPrompt: (value: string) => value,
}));
vi.mock("./mcp", () => ({
  connectMcp: async () => ({
    listTools: mock.list,
    callTool: mock.call,
    close: async () => {},
  }),
}));
vi.mock("./notifications", () => ({ notifyCompletion: vi.fn(async () => {}) }));
vi.mock("./diagnostics", () => ({ diagnostics: { error: vi.fn() } }));
import { chat } from "./agent";
import { sha256 } from "../core/crypto";

beforeEach(() => {
  vi.clearAllMocks();
  mock.state = {
    entries: [],
    categories: [],
    docs: [],
    topics: [
      {
        id: "topic",
        entryId: "",
        title: "test",
        messages: [],
        updatedAt: new Date().toISOString(),
      },
    ],
    ai: { tasks: { agent: { prompt: "system" } } },
    device: { mcp: [{ id: "mcp", enabled: true, name: "fixture" }] },
  };
  mock.patchWhen.mockImplementation(
    async (
      _collection: string,
      id: string,
      patch: object,
      _source: string,
      guard: () => boolean,
    ) => {
      if (!guard()) return false;
      Object.assign(
        mock.state.topics.find((t: any) => t.id === id),
        patch,
      );
      return true;
    },
  );
  mock.patch.mockImplementation(
    async (_collection: string, id: string, patch: object) => {
      mock.state.docs.push({ id, collection: "setting", fields: patch });
    },
  );
  mock.call.mockResolvedValue({
    content: [{ type: "text", text: "query result" }],
  });
  mock.complete
    .mockResolvedValueOnce({
      content: "",
      calls: [
        {
          id: "query-call",
          type: "function",
          function: { name: "mcp_0_0", arguments: "{}" },
        },
      ],
    })
    .mockResolvedValue({ content: "final answer", calls: [] });
});

it.each([
  [{ readOnlyHint: true }, 0],
  [{}, 1],
  [{ readOnlyHint: true, destructiveHint: true }, 1],
] as const)(
  "uses explicit MCP metadata %j for approval, never the generated tool name",
  async (annotations, approvals) => {
    mock.list.mockResolvedValue({
      tools: [
        {
          name: "search_records",
          inputSchema: { type: "object" },
          annotations,
        },
      ],
    });
    const confirm = vi.fn(async () => true);
    await chat(mock.state.topics[0], "query", confirm, {
      model: "test",
      effort: "low",
    });
    expect(confirm).toHaveBeenCalledTimes(approvals);
    expect(mock.call).toHaveBeenCalledOnce();
    if (!approvals) expect(mock.patch).not.toHaveBeenCalled();
    expect(mock.state.topics[0].messages.at(-1).content).toBe("final answer");
  },
);

it("requires confirmation to repeat an earlier uncertain operation even if it now advertises read-only", async () => {
  const id = "tool-" + (await sha256(["topic", "query-call"]));
  mock.state.docs = [
    { id, collection: "setting", fields: { status: "pending" } },
  ];
  mock.list.mockResolvedValue({
    tools: [
      {
        name: "search_records",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      },
    ],
  });
  const confirm = vi.fn(async () => false);
  await chat(mock.state.topics[0], "query", confirm, {
    model: "test",
    effort: "low",
  });
  expect(confirm).toHaveBeenCalledOnce();
  expect(mock.call).not.toHaveBeenCalled();
});
