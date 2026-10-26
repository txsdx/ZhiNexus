/** Bounded, persisted agent tool loop with explicit confirmation for writes and external MCP execution. */
import { sha256 } from "../core/crypto";
import { diagnostics } from "./diagnostics";
import { executeKnowledgeTool, knowledgeTools } from "./agent-tools";
import { store, json } from "../core/store";
import type { Message, Topic } from "../core/types";
import { complete, renderPrompt } from "./ai";
import { connectMcp } from "./mcp";
/** Run at most six tool rounds and persist protocol-complete messages after every round. */
async function chatInternal(
  topic: Topic,
  text: string,
  confirm: (description: string) => Promise<boolean>,
  override: { model: string; effort: string },
): Promise<void> {
  const s = store.getSnapshot(),
    entry = s.entries.find((e) => e.id === topic.entryId);
  const messages: Message[] = [...topic.messages];
  const persist = () =>
    store.patch(
      "topic",
      topic.id,
      { messages: json(messages), updatedAt: new Date().toISOString() },
      "agent",
    );
  messages.push({ role: "user", content: text });
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
  const specs = [...knowledgeTools];
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
    const execute = async (
      call: import("../core/types").ToolCall,
    ): Promise<unknown> => {
      const receipt = "tool-" + (await sha256([topic.id, call.id]));
      const saved = store
        .getSnapshot()
        .docs.find((d) => d.collection === "setting" && d.id === receipt);
      if (saved?.fields.status === "done") return saved.fields.result;
      try {
        const args = JSON.parse(call.function.arguments),
          remote = external.get(call.function.name);
        if (!remote)
          return await executeKnowledgeTool(
            call.function.name,
            args,
            receipt,
            confirm,
          );
        const prefix =
          saved?.fields.status === "pending"
            ? "上次执行结果未知，重新执行可能重复操作。确认重试 / Previous result unknown; retry may repeat the action.\n"
            : "";
        if (
          !(await confirm(
            prefix +
              "执行外部 MCP 工具 " +
              remote.label +
              "\n" +
              JSON.stringify(args),
          ))
        )
          return { cancelled: true };
        await store.patch(
          "setting",
          receipt,
          { status: "pending", tool: call.function.name },
          "agent-outbox",
        );
        const result = await remote.client.callTool({
          name: remote.name,
          arguments: args,
        });
        await store.patch(
          "setting",
          receipt,
          { status: "done", result: json(result) },
          "agent-outbox",
        );
        return result;
      } catch (e) {
        diagnostics.error(
          "app",
          "Agent 工具执行失败 / Agent tool failed: " + call.function.name,
          e,
        );
        return { error: e instanceof Error ? e.message : "tool error" };
      }
    };
    // Insert recovered tool results before subsequent user turns to keep the provider protocol valid.
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      let insertion = i + 1;
      while (messages[insertion]?.role === "tool") insertion++;
      for (const call of message.tool_calls ?? [])
        if (
          !messages
            .slice(i + 1, insertion)
            .some((m) => m.role === "tool" && m.tool_call_id === call.id)
        ) {
          messages.splice(insertion++, 0, {
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(await execute(call)).slice(0, 40000),
          });
          await persist();
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
      await persist();
      for (const call of response.calls) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(await execute(call)).slice(0, 40000),
        });
        await persist();
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

/** Notify once for the complete turn, rather than on every intermediate tool round. */
export async function chat(...args: Parameters<typeof chatInternal>) {
  await chatInternal(...args);
  const { notifyCompletion } = await import("./notifications");
  const topic = store
    .getSnapshot()
    .topics.find((topic) => topic.id === args[0].id);
  const final =
    topic?.messages.filter((message) => message.role === "assistant").at(-1)
      ?.content ?? "";
  void notifyCompletion("ai", final).catch(() => {});
}
