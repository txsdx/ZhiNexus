/** Bounded, persisted agent tool loop with explicit confirmation for writes and external MCP execution. */
import { z } from "zod";
import Fuse from "fuse.js";
import { store, json } from "../core/store";
import type { Message, McpConfig, Topic } from "../core/types";
import { complete, renderPrompt, type ToolSpec } from "./ai";
import { secureUrl, request } from "./network";
const objectSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    id: { type: "string" },
    title: { type: "string" },
    content: { type: "string" },
  },
  additionalProperties: false,
};
const tools: ToolSpec[] = [
  { name: "search_knowledge", description: "模糊查找词条；参数 query" },
  { name: "get_entry", description: "读取完整词条；参数 id" },
  { name: "list_categories", description: "列出分类树" },
  { name: "review_queue", description: "读取到期复习队列" },
  {
    name: "create_entry",
    description: "创建知识条目；参数 title, content；需用户确认",
  },
  {
    name: "update_entry",
    description: "更新词条内容；参数 id, content；需用户确认",
  },
].map((t) => ({
  type: "function",
  function: { ...t, parameters: objectSchema },
}));
/** Route local tools through the repository so agent edits remain auditable and syncable. */
async function localTool(
  name: string,
  args: unknown,
  confirm: (description: string) => Promise<boolean>,
): Promise<unknown> {
  const a = z
      .object({
        query: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        content: z.string().optional(),
      })
      .parse(args),
    s = store.getSnapshot();
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
    case "create_entry":
      if (!a.title) throw Error("缺少 title");
      if (!(await confirm("Agent 创建词条：" + a.title)))
        return { cancelled: true };
      return { id: await store.createEntry(a.title, a.content ?? "", "agent") };
    case "update_entry":
      if (
        !a.id ||
        a.content === undefined ||
        !s.entries.some((e) => e.id === a.id)
      )
        throw Error("无效词条");
      if (
        !(await confirm(
          "Agent 替换词条内容：" +
            s.entries.find((e) => e.id === a.id)!.title +
            "\n\n" +
            a.content,
        ))
      )
        return { cancelled: true };
      await store.patch(
        "entry",
        a.id,
        { content: a.content, updatedAt: new Date().toISOString() },
        "agent",
      );
      return { ok: true };
    default:
      throw Error("未知工具");
  }
}
/** Connect using the maintained MCP SDK and Streamable HTTP protocol. */
async function connectMcp(config: McpConfig) {
  secureUrl(config.url);
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  const client = new Client({ name: "ZhiNexus", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
      headers: config.token ? { Authorization: "Bearer " + config.token } : {},
    },
    fetch: async (input, init) => request(String(input), init),
  });
  await client.connect(transport);
  return client;
}
/** Run at most six tool rounds and persist protocol-complete messages after every round. */
export async function chat(
  topic: Topic,
  text: string,
  confirm: (description: string) => Promise<boolean>,
  override: { model: string; effort: string },
): Promise<void> {
  const s = store.getSnapshot(),
    entry = s.entries.find((e) => e.id === topic.entryId);
  const messages: Message[] = [
    ...topic.messages,
    { role: "user", content: text },
  ];
  const persist = () =>
    store.patch(
      "topic",
      topic.id,
      { messages: json(messages), updatedAt: new Date().toISOString() },
      "agent",
    );
  await persist();
  const clients: Awaited<ReturnType<typeof connectMcp>>[] = [];
  const external = new Map<
    string,
    {
      client: Awaited<ReturnType<typeof connectMcp>>;
      name: string;
      label: string;
    }
  >();
  const specs = [...tools];
  try {
    for (const [i, config] of s.device.mcp.filter((c) => c.enabled).entries()) {
      const client = await connectMcp(config);
      clients.push(client);
      const list = await client.listTools();
      for (const [j, t] of list.tools.entries()) {
        const name = `mcp_${i}_${j}`;
        external.set(name, {
          client,
          name: t.name,
          label: config.name + "/" + t.name,
        });
        specs.push({
          type: "function",
          function: {
            name,
            description: (t.description ?? t.name) + " [外部工具，需确认]",
            parameters: t.inputSchema as Record<string, unknown>,
          },
        });
      }
    }
    const system: Message = {
      role: "system",
      content: renderPrompt(s.ai.tasks.agent.prompt, {
        content: entry
          ? entry.title + "\n" + entry.content
          : "当前在全局学习助手中。",
      }),
    };
    for (let turn = 0; turn < 6; turn++) {
      const response = await complete(
        "agent",
        [system, ...messages],
        specs,
        override,
      );
      messages.push({
        role: "assistant",
        content: response.content,
        ...(response.calls.length ? { tool_calls: response.calls } : {}),
      });
      for (const call of response.calls) {
        let result: unknown;
        try {
          const args = JSON.parse(call.function.arguments),
            remote = external.get(call.function.name);
          if (remote) {
            result = (await confirm(
              "执行外部 MCP 工具 " + remote.label + "\n" + JSON.stringify(args),
            ))
              ? await remote.client.callTool({
                  name: remote.name,
                  arguments: args,
                })
              : { cancelled: true };
          } else result = await localTool(call.function.name, args, confirm);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : "tool error" };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 40000),
        });
      }
      await persist();
      if (!response.calls.length) return;
    }
    messages.push({
      role: "assistant",
      content: "本轮已达到工具调用上限，请继续提问。",
    });
    await persist();
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
  }
}
