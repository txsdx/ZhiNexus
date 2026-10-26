/** Global and entry-scoped assistant with isolated persisted topic histories and tool confirmation. */
import { diagnostics } from "../services/diagnostics";
import { useState } from "react";
import { ArrowUp, Bot, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useKnowledge, useT, Busy, Empty, Modal } from "../components/common";
import { Markdown } from "../components/Markdown";
import { store } from "../core/store";
import { resolveModel } from "../core/ai-config";
import { useConfirmation } from "../hooks/useConfirmation";
import { chat } from "../services/agent";
/** Keep all chat scopes independent and preserve conversations across navigation and restarts. */
export function Agent({
  entryId = "",
  notify,
}: {
  entryId?: string;
  notify: (s: string) => void;
}) {
  const s = useKnowledge(),
    t = useT(),
    topics = s.topics
      .filter((x) => x.entryId === entryId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [selected, setSelected] = useState(""),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [model, setModel] = useState(s.ai.tasks.agent.model),
    [effort, setEffort] = useState(s.ai.tasks.agent.effort),
    [confirmation, setConfirmation] = useState<{
      text: string;
      resolve: (ok: boolean) => void;
    } | null>(null);
  const topic = topics.find((x) => x.id === selected) ?? topics[0],
    entry = s.entries.find((e) => e.id === entryId),
    actualModel = resolveModel(s.ai, "agent", model);
  const deletion = useConfirmation(notify);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      let current = topic;
      if (!current) {
        const id = crypto.randomUUID();
        await store.patch("topic", id, {
          entryId,
          title: text.slice(0, 40),
          messages: [],
          updatedAt: new Date().toISOString(),
        });
        setSelected(id);
        current = store.getSnapshot().topics.find((x) => x.id === id)!;
      }
      const input = text;
      setText("");
      await chat(
        current,
        input,
        (description) =>
          new Promise((resolve) =>
            setConfirmation({ text: description, resolve }),
          ),
        { model, effort },
      );
    } catch (e) {
      diagnostics.error("ai", "AI 任务失败 / AI task failed", e);
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page chat-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">THINK TOGETHER</div>
          <h1>
            {entry
              ? entry.title + " · " + t("词条助手", "Entry assistant")
              : t("学习伙伴", "Learning companion")}
          </h1>
          <p>
            {t(
              "好问题，比标准答案更接近理解。",
              "A good question takes you further than a perfect answer.",
            )}
          </p>
        </div>
      </div>
      <div className="chat-shell">
        <aside className="topic-list">
          <button
            disabled={busy}
            className="full"
            onClick={() => {
              const id = crypto.randomUUID();
              void store
                .patch("topic", id, {
                  entryId,
                  title: t("新的对话", "New conversation"),
                  messages: [],
                  updatedAt: new Date().toISOString(),
                })
                .then(() => setSelected(id));
            }}
          >
            <Plus size={16} />
            {t("新话题", "New conversation")}
          </button>
          {topics.map((x) => (
            <div
              className={"topic " + (x.id === topic?.id ? "active" : "")}
              key={x.id}
            >
              <button disabled={busy} onClick={() => setSelected(x.id)}>
                <MessageSquare size={15} />
                {x.title}
              </button>
              <button
                className="icon"
                disabled={busy}
                aria-label="Delete topic"
                onClick={() => {
                  void deletion.request(
                    t("删除此对话？", "Delete conversation?"),
                    () => store.patch("topic", x.id, { deleted: true }),
                  );
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </aside>
        <div className="conversation">
          <div className="chat-model">
            <Bot size={18} />
            <select
              aria-label="Chat model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="">
                {t("默认模型", "Default model")}
                {s.ai.defaultModel ? ` (${s.ai.defaultModel})` : ""}
              </option>
              {model && !s.ai.models.some((m) => m.id === model) && (
                <option value={model}>{model}</option>
              )}
              {s.ai.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
            <select
              aria-label="Reasoning effort"
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
            >
              {[
                ...new Set([
                  effort,
                  ...(s.ai.models.find((m) => m.id === actualModel)?.efforts ??
                    []),
                ]),
              ].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </div>
          <div className="messages">
            {topic?.messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m, i) => (
                <div className={"message " + m.role} key={i}>
                  <small>
                    {m.role === "user" ? t("你", "You") : "ZhiNexus"}
                    {m.tool_calls?.length ? " · tools" : ""}
                  </small>
                  <Markdown>
                    {m.content ||
                      t("正在查阅知识库…", "Consulting your knowledge…")}
                  </Markdown>
                </div>
              ))}
            {!topic?.messages.length && (
              <Empty
                title={t(
                  "让我们一起，把知识想明白。",
                  "Let’s make sense of it together.",
                )}
                description={t(
                  "试着问：“找出我关于记忆的笔记”，或“用生活中的例子解释这个概念”。",
                  "Try “Find my notes about memory” or “Explain this concept with a real-life example.”",
                )}
              />
            )}{" "}
            {busy && (
              <Busy
                label={t("思考与查阅中…", "Thinking and looking things up…")}
              />
            )}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              rows={2}
              placeholder={t(
                "提出一个问题，让理解更进一步…",
                "Ask a question. Take your understanding further…",
              )}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="primary icon"
              aria-label="Send"
              disabled={busy || !text.trim()}
            >
              <ArrowUp size={20} />
            </button>
          </form>
          <small className="chat-disclaimer">
            {t(
              "AI 可能出错，请核对重要信息。写入和外部工具调用需要你的确认。",
              "AI can make mistakes. Writes and external tools require confirmation.",
            )}
          </small>
        </div>
      </div>
      {deletion.dialog}
      {confirmation && (
        <Modal
          title={t("确认 Agent 操作", "Confirm agent action")}
          onClose={() => {
            confirmation.resolve(false);
            setConfirmation(null);
          }}
        >
          <pre>{confirmation.text}</pre>
          <div className="actions">
            <button
              onClick={() => {
                confirmation.resolve(false);
                setConfirmation(null);
              }}
            >
              {t("拒绝", "Deny")}
            </button>
            <button
              className="primary"
              onClick={() => {
                confirmation.resolve(true);
                setConfirmation(null);
              }}
            >
              {t("允许本次", "Allow once")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
