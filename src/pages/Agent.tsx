/** Full-height conversations with durable streamed tasks, editable titles and an anchored composer. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { chatDraftKey } from "../core/chat-drafts";
import { chatDrafts } from "../services/chat-drafts";
import { saveMarkdown } from "../services/export-text";
import { conversationMarkdown } from "../core/conversation-export";
import { Download } from "lucide-react";
import { diagnostics } from "../services/diagnostics";
import { useKnowledge, useT, Busy } from "../components/common";
import { store } from "../core/store";
import { useConfirmation } from "../hooks/useConfirmation";
import { useChatScroll } from "../hooks/useChatScroll";
import { aiJobs, submitAIJob, openAIJob } from "../services/ai-jobs";
import { fallbackTopicTitle, renameTopic } from "../services/topic-titles";
import { useAIJobs } from "../components/AIJobView";
import { ConversationList } from "../components/chat/ConversationList";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatMessage } from "../components/chat/ChatMessage";

/** Separate global/entry scopes and keep each topic's unsent draft when switching conversations. */
export function Agent({
  entryId = "",
  notify,
  initialTopic = "",
  quote = "",
  onOpenEntry,
  embedded = false,
}: {
  embedded?: boolean;
  entryId?: string;
  initialTopic?: string;
  quote?: string;
  onOpenEntry?: (id: string) => void;
  notify: (message: string) => void;
}) {
  const s = useKnowledge(),
    t = useT(),
    jobs = useAIJobs();
  const topics = useMemo(
    () =>
      s.topics
        .filter((x) => x.entryId === entryId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [s.topics, entryId],
  );
  const [selected, setSelected] = useState(initialTopic),
    [busy, setBusy] = useState(false);
  const [showTopics, setShowTopics] = useState(
    () => !embedded && window.matchMedia("(min-width: 900px)").matches,
  );
  const topic = topics.find((x) => x.id === selected) ?? topics[0],
    entry = s.entries.find((e) => e.id === entryId);
  const submitting = useRef(false),
    navigation = useRef(0),
    selectedRef = useRef(topic?.id ?? ""),
    notifyRef = useRef(notify);
  selectedRef.current = topic?.id ?? "";
  notifyRef.current = notify;
  const feedback = useCallback(
    (message: string) => notifyRef.current(message),
    [],
  );
  const relevant = jobs.jobs.filter(
    (j) => j.kind === "chat" && j.target.topicId === topic?.id,
  );
  const active =
    relevant.find((j) => ["running", "approval"].includes(j.state)) ??
    relevant.find((j) => j.state === "queued");
  const revision =
    (topic?.messages.length ?? 0) +
    ":" +
    (topic?.messages.at(-1)?.content.length ?? 0) +
    ":" +
    relevant
      .map(
        (j) =>
          j.state +
          ":" +
          (j.stages.at(-1)?.content.length ?? 0) +
          ":" +
          (j.stages.at(-1)?.reasoning.length ?? 0),
      )
      .join(",");
  const scroll = useChatScroll(topic?.id ?? "", revision),
    deletion = useConfirmation(feedback);
  const toolResults = useMemo(
    () => topic?.messages.filter((m) => m.role === "tool") ?? [],
    [topic?.messages],
  );
  const draftState = useSyncExternalStore(
      chatDrafts.subscribe,
      chatDrafts.getSnapshot,
    ),
    key = chatDraftKey(entryId, topic?.id ?? ""),
    defaults = {
      text: "",
      quote: "",
      model: s.ai.tasks.agent.model,
      effort: s.ai.tasks.agent.effort,
    },
    draft = draftState.drafts[key] ?? defaults,
    { text, quote: selectedQuote, model, effort } = draft;
  const root = useRef<HTMLDivElement>(null);
  const editDraft = (patch: Partial<typeof draft>) => {
    try {
      chatDrafts.patch(key, patch, defaults);
    } catch (error) {
      feedback(String(error));
    }
  };
  const choose = (id: string) => {
    if (id === topic?.id) return;
    navigation.current++;
    selectedRef.current = id;
    setSelected(id);
    if (!window.matchMedia("(min-width: 900px)").matches) setShowTopics(false);
  };
  useEffect(() => {
    void chatDrafts.init().catch((error) => feedback(String(error)));
    const flush = () => {
      if (document.visibilityState === "hidden")
        void chatDrafts.flush().catch((error) => feedback(String(error)));
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      void chatDrafts.flush().catch((error) => feedback(String(error)));
    };
  }, []);
  useEffect(() => {
    if (initialTopic && initialTopic !== selectedRef.current)
      choose(initialTopic);
  }, [initialTopic]);
  const quoteApplied = useRef("");
  useEffect(() => {
    if (quote && draftState.ready && quoteApplied.current !== quote) {
      quoteApplied.current = quote;
      editDraft({
        quote,
        text: text || t("请解释这段内容。", "Please explain this passage."),
      });
    }
  }, [quote, draftState.ready]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)"),
      change = () => setShowTopics(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const create = async () => {
    if (submitting.current || jobs.readOnly) return;
    submitting.current = true;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      await store.patch("topic", id, {
        entryId,
        title: t("新的对话", "New conversation"),
        titleMode: "auto",
        titleGenerated: false,
        messages: [],
        updatedAt: new Date().toISOString(),
      });
      choose(id);
    } catch (error) {
      feedback(error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const send = async () => {
    if (
      !text.trim() ||
      submitting.current ||
      jobs.readOnly ||
      !draftState.ready ||
      draftState.frozen
    )
      return;
    submitting.current = true;
    setBusy(true);
    const input = text,
      passage = selectedQuote,
      selectedModel = model,
      selectedEffort = effort;
    let current = topic;
    try {
      if (!current) {
        const id = crypto.randomUUID();
        await store.patch("topic", id, {
          entryId,
          title: fallbackTopicTitle(input),
          titleMode: "auto",
          titleGenerated: false,
          messages: [],
          updatedAt: new Date().toISOString(),
        });
        chatDrafts.transfer(key, chatDraftKey(entryId, id));
        choose(id);
        current = store.getSnapshot().topics.find((x) => x.id === id)!;
      } else if (
        !current.messages.length &&
        current.titleMode !== "manual" &&
        !relevant.length
      )
        await store.patchWhen(
          "topic",
          current.id,
          { title: fallbackTopicTitle(input), titleMode: "auto" },
          "topic-title-fallback",
          () =>
            store.getSnapshot().topics.find((x) => x.id === current!.id)
              ?.titleMode !== "manual",
        );
      await submitAIJob(
        "chat",
        { page: "agent", entryId, topicId: current.id },
        {
          text:
            input + (passage ? "\n\n选中内容（仅作上下文）：\n" + passage : ""),
          model: selectedModel,
          effort: selectedEffort,
        },
        false,
      );
      chatDrafts.clearSent(chatDraftKey(entryId, current.id), input, passage);
      if (selectedRef.current === current.id) scroll.bottom();
    } catch (error) {
      diagnostics.error(
        "ai",
        "AI 对话发送失败 / Chat submission failed",
        error,
      );
      feedback(error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const awaitingApproval = relevant.find((j) => j.state === "approval");
  useEffect(() => {
    if (awaitingApproval) openAIJob(awaitingApproval.id);
  }, [awaitingApproval?.id, awaitingApproval?.state]);
  return (
    <div
      ref={root}
      className={"page chat-page" + (embedded ? " embedded-chat" : "")}
    >
      <div className={"chat-shell" + (showTopics ? " topics-visible" : "")}>
        {showTopics && (
          <>
            <button
              className="topics-backdrop"
              aria-label={t("关闭会话列表", "Close conversations")}
              onClick={() => setShowTopics(false)}
            />
            <ConversationList
              topics={topics}
              selected={topic?.id}
              busy={
                busy || jobs.readOnly || !draftState.ready || draftState.frozen
              }
              onNew={() => void create()}
              onClose={() => setShowTopics(false)}
              onSelect={choose}
              onRename={renameTopic}
              onDelete={(value) =>
                void deletion.request(
                  t("删除此对话？", "Delete conversation?"),
                  async () => {
                    const wasActive = selectedRef.current === value.id,
                      version = navigation.current;
                    await store.patch("topic", value.id, { deleted: true });
                    chatDrafts.remove(chatDraftKey(entryId, value.id));
                    if (!wasActive || navigation.current !== version) return;
                    const next = store
                      .getSnapshot()
                      .topics.filter((item) => item.entryId === entryId)
                      .sort((a, b) =>
                        b.updatedAt.localeCompare(a.updatedAt),
                      )[0];
                    selectedRef.current = next?.id ?? "";
                    setSelected(next?.id ?? "");
                  },
                )
              }
            />
          </>
        )}
        <section
          className="conversation"
          aria-label={t("AI 对话", "AI conversation")}
        >
          <header className="chat-thread-header">
            <button
              className="icon"
              aria-label={
                showTopics
                  ? t("切换会话列表", "Toggle conversations")
                  : t("展开会话列表", "Show conversations")
              }
              onClick={() => setShowTopics((value) => !value)}
            >
              {showTopics ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </button>
            <h1>{topic?.title ?? t("新对话", "New conversation")}</h1>
            <button
              className="icon"
              aria-label={t(
                "导出对话 Markdown",
                "Export conversation Markdown",
              )}
              disabled={!topic?.messages.length}
              onClick={() => {
                if (topic)
                  void saveMarkdown(
                    topic.title,
                    conversationMarkdown(topic, relevant),
                  ).catch((error) => feedback(String(error)));
              }}
            >
              <Download size={17} />
            </button>
            {entry &&
              (onOpenEntry ? (
                <button
                  type="button"
                  className="chat-entry-context"
                  onClick={() => onOpenEntry(entry.id)}
                  title={t("返回词条", "Back to entry")}
                  aria-label={t("返回词条：", "Back to entry: ") + entry.title}
                >
                  {entry.title}
                </button>
              ) : (
                <span className="chat-entry-context">{entry.title}</span>
              ))}
          </header>
          <div className="chat-message-region">
            <div
              className="messages"
              ref={scroll.viewport}
              onScroll={scroll.onScroll}
              onClickCapture={(event) => {
                if ((event.target as HTMLElement).closest("summary"))
                  scroll.pause();
              }}
            >
              <div className="messages-inner" ref={scroll.content}>
                {topic?.messages
                  .filter((m) => m.role === "user" || m.role === "assistant")
                  .map((message, index) => (
                    <ChatMessage
                      key={index}
                      message={message}
                      results={toolResults}
                      notify={feedback}
                      onReuse={(value) => {
                        editDraft({
                          text: text ? text + "\n\n" + value : value,
                        });
                        root.current
                          ?.querySelector<HTMLTextAreaElement>(
                            ".chat-input textarea",
                          )
                          ?.focus();
                      }}
                    />
                  ))}
                {relevant
                  .filter((j) =>
                    [
                      "queued",
                      "running",
                      "approval",
                      "error",
                      "cancelled",
                    ].includes(j.state),
                  )
                  .map((job) => {
                    const stage = job.stages.at(-1);
                    const persisted =
                      stage?.content &&
                      topic?.messages.some(
                        (message) =>
                          message.role === "assistant" &&
                          message.jobId === job.id &&
                          (stage.responseId
                            ? message.responseId === stage.responseId
                            : message.content === stage.content),
                      );
                    return (
                      <div
                        className="chat-live-job"
                        key={job.id}
                        data-chat-job={job.id}
                      >
                        {!topic?.messages.some(
                          (m) => m.role === "user" && m.jobId === job.id,
                        ) && (
                          <ChatMessage
                            message={{
                              role: "user",
                              content: String(job.input.text),
                            }}
                            notify={feedback}
                          />
                        )}
                        {(stage?.content || stage?.reasoning) && !persisted && (
                          <>
                            {stage.reasoning && (
                              <details className="chat-reasoning">
                                <summary>{t("思考过程", "Reasoning")}</summary>
                                <pre>{stage.reasoning}</pre>
                              </details>
                            )}
                            {stage.content && (
                              <ChatMessage
                                message={{
                                  role: "assistant",
                                  content: stage.content,
                                }}
                                streaming={
                                  job.state === "running" ||
                                  job.state === "queued"
                                }
                                notify={feedback}
                              />
                            )}
                          </>
                        )}
                        {["queued", "running"].includes(job.state) &&
                          !stage?.content && (
                            <Busy
                              label={
                                job.state === "queued"
                                  ? t("排队中…", "Queued…")
                                  : t("生成中…", "Generating…")
                              }
                            />
                          )}
                        {job.state === "approval" && (
                          <button onClick={() => openAIJob(job.id)}>
                            {t("确认 Agent 操作", "Confirm agent action")}
                          </button>
                        )}
                        {job.error && (
                          <p className="warning" role="alert">
                            {job.error}
                            <button onClick={() => openAIJob(job.id)}>
                              {t("查看任务", "View task")}
                            </button>
                          </p>
                        )}
                        {job.state === "cancelled" && (
                          <button
                            onClick={() =>
                              void aiJobs
                                .retry(job.id)
                                .catch((error) => feedback(String(error)))
                            }
                          >
                            {t("重新生成", "Retry generation")}
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
            {scroll.away && (
              <button
                className="chat-jump-bottom"
                aria-label={t("回到最新消息", "Jump to latest message")}
                onClick={scroll.bottom}
              >
                <ArrowDown size={16} />
                {t("最新消息", "Latest")}
              </button>
            )}
          </div>
          {draftState.error && (
            <p className="warning" role="alert">
              {draftState.error}
              <button
                onClick={() =>
                  void (
                    draftState.ready ? chatDrafts.flush() : chatDrafts.init()
                  ).catch((error) => feedback(String(error)))
                }
              >
                {t("重试保存草稿", "Retry draft save")}
              </button>
            </p>
          )}
          <ChatComposer
            text={text}
            onText={(text) => editDraft({ text })}
            quote={selectedQuote}
            onRemoveQuote={() => editDraft({ quote: "" })}
            model={model}
            onModel={(model) => editDraft({ model })}
            effort={effort}
            onEffort={(effort) => editDraft({ effort })}
            ai={s.ai}
            busy={busy}
            readOnly={jobs.readOnly || !draftState.ready || draftState.frozen}
            active={!!active}
            onSend={() => void send()}
            onStop={() => {
              if (active)
                void aiJobs
                  .cancel(active.id)
                  .catch((error) => feedback(String(error)));
            }}
          />
        </section>
      </div>
      {deletion.dialog}
    </div>
  );
}
