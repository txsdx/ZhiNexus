import { reviewTarget, nextReviewAt } from "../core/review-policy";
/** Knowledge editor, AI enrichment, revision audit trail and prerequisite capture. */
import { EntryReferences } from "../components/EntryReferences";
import { EntrySwitcher } from "../components/EntrySwitcher";
import { entryLinkMarkdown, entryLinkTarget } from "../core/entry-links";
import { Star, Link2 } from "lucide-react";
import { CategoryPicker } from "../components/CategoryPicker";
import { moveEntry, categoryPath } from "../services/categories";
import { diagnostics } from "../services/diagnostics";
import { useEntryDocument } from "../hooks/useEntryDocument";
import { useConfirmation } from "../hooks/useConfirmation";
import { BlockEditor } from "../components/editor/BlockEditor";
import { DocumentOutline } from "../components/editor/DocumentOutline";
import { documentBlocks } from "../components/editor/document";
import { RevisionDiff } from "../components/RevisionDiff";
import { lazy, Suspense, useEffect, useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  X,
  Edit3,
  History,
  ImagePlus,
  MessageSquare,
  Save,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useKnowledge, useT, Modal, Busy } from "../components/common";
import { Markdown } from "../components/Markdown";
import { store } from "../core/store";
import { renderPrompt } from "../services/ai";
import { submitAIJob } from "../services/ai-jobs";
import { json } from "../core/store";
const EntryAgent = lazy(() =>
  import("./Agent").then((m) => ({ default: m.Agent })),
);
/** Render and edit one entry; save only changed fields so concurrent category changes are preserved. */
export function EntryPage({
  id,
  chatRequest,
  active = true,
  onBack,
  notify,
}: {
  id: string;
  chatRequest?: { topicId?: string; nonce: number; open?: boolean };
  active?: boolean;
  onBack: () => void;
  notify: (s: string) => void;
}) {
  const s = useKnowledge(),
    t = useT(),
    entry = s.entries.find((e) => e.id === id),
    doc = s.docs.find((d) => d.collection === "entry" && d.id === id);
  const {
    editing,
    saving,
    setEditing,
    content,
    setContent,
    title,
    setTitle,
    sourceMode,
    setSourceMode,
    sourceOnly,
    focus,
    focusId,
    setFocusId,
    setRichCache,
    document,
    dirty,
    base,
    compareSave,
    setCompareSave,
    save,
    beginEditing,
    appendImage,
    appendReference,
    locate,
  } = useEntryDocument(id, entry, notify);
  const [insertingReference, setInsertingReference] = useState(false);
  const [chatOpen, setChatOpen] = useState(false),
    [chatQuote, setChatQuote] = useState(""),
    [chatTopic, setChatTopic] = useState("");
  const openChat = (quote = "") => {
    setChatQuote(quote);
    setChatOpen(true);
  };
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          entryId: string;
          quote?: string;
          topicId?: string;
        }>
      ).detail;
      if (detail.entryId === id) {
        setChatTopic(detail.topicId ?? "");
        openChat(detail.quote);
      }
    };
    window.addEventListener("zhinexus:entry-chat", receive);
    return () => window.removeEventListener("zhinexus:entry-chat", receive);
  }, [id]);
  useEffect(() => {
    if (chatRequest) {
      setChatTopic(chatRequest.topicId ?? "");
      setChatOpen(chatRequest.open !== false);
    }
  }, [chatRequest]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (
        event as CustomEvent<{ entryId: string; selector?: string }>
      ).detail;
      if (detail.entryId === id && detail.selector?.includes("data-blockid"))
        setFocusId(null);
    };
    window.addEventListener("zhinexus:restore-position", receive);
    return () =>
      window.removeEventListener("zhinexus:restore-position", receive);
  }, [id]);
  const [history, setHistory] = useState(false),
    [busy, setBusy] = useState(""),
    [imagePrompt, setImagePrompt] = useState<string | null>(null),
    [outlineOpen, setOutlineOpen] = useState(
      () => window.matchMedia("(min-width: 1000px)").matches,
    );
  const confirmation = useConfirmation(notify);
  if (!active) return null;
  if (!entry)
    return (
      <div className="page">
        {t("词条不存在或已删除", "Entry missing or deleted")}
        <button onClick={onBack}>{t("返回", "Back")}</button>
      </div>
    );
  const vars = { title: entry.title, content: entry.content };
  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      diagnostics.error("ai", "AI 任务失败 / AI task failed", e);
      notify(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy("");
    }
  };
  const attach = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    )
      throw Error("支持 PNG / JPEG / WebP / GIF");
    const hash = await store.db.putBlob(
      new Uint8Array(await file.arrayBuffer()),
      file.type,
    );
    appendImage(hash, file.name.replace(/[\[\]\n]/g, ""));
  };
  return (
    <div
      className={"page entry-page" + (chatOpen ? " with-entry-chat" : "")}
      data-entry-id={id}
      data-entry-color={entry.color ?? "none"}
    >
      <button
        className="back"
        onClick={() => {
          onBack();
        }}
      >
        <ArrowLeft size={16} />
        {t("返回知识库", "Back to library")}
      </button>
      <div className="entry-heading">
        <div className="entry-heading-top">
          <span className="category-dot">
            {categoryPath(s.categories, entry.category).join(" / ") ||
              t("未分类", "Uncategorized")}
          </span>
          <div className="actions">
            <button
              className="icon"
              aria-label={t(
                entry.starred ? "取消收藏" : "收藏词条",
                entry.starred ? "Unstar entry" : "Star entry",
              )}
              aria-pressed={!!entry.starred}
              onClick={() =>
                void store
                  .patch("entry", id, {
                    starred: !entry.starred,
                    updatedAt: new Date().toISOString(),
                  })
                  .catch((error) => notify(String(error)))
              }
            >
              <Star size={18} fill={entry.starred ? "currentColor" : "none"} />
            </button>
            <button
              className="icon"
              title={t("变更历史", "History")}
              onClick={() => setHistory(true)}
            >
              <History size={19} />
            </button>
            <button
              data-entry-action="edit"
              disabled={saving}
              onClick={beginEditing}
            >
              <Edit3 size={16} />
              {editing ? t("取消", "Cancel") : t("编辑", "Edit")}
            </button>
            <button
              title={t("与当前词条对话", "Chat about this entry")}
              disabled={saving}
              onClick={() => setChatOpen((value) => !value)}
            >
              <MessageSquare size={16} />
              {t("AI 对话", "AI chat")}
            </button>
            {editing && (
              <button
                className="primary"
                disabled={saving}
                onClick={() => void act(t("保存中", "Saving"), () => save())}
              >
                <Save size={16} />
                {t("保存", "Save")}
              </button>
            )}
          </div>
        </div>
        <div className="entry-heading-row">
          <div className="entry-title">
            {editing ? (
              <input
                className="title-input"
                disabled={saving}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            ) : (
              <h1>{entry.title}</h1>
            )}
            <div className="entry-facts">
              <p className="entry-timestamps">
                <span>
                  {t("创建于", "Created")}{" "}
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </time>
                </span>
                <span>
                  {t("最近更新", "Updated")}{" "}
                  <time dateTime={entry.updatedAt}>
                    {new Date(entry.updatedAt).toLocaleString()}
                  </time>
                </span>
              </p>
              <p className="entry-review-facts">
                <span>
                  {t("复习次数", "Reviews")}:{" "}
                  {entry.reviewCount ?? entry.card.reps}
                </span>
                <span>
                  {t("下次复习", "Next review")}:{" "}
                  <time
                    dateTime={nextReviewAt(
                      entry,
                      reviewTarget(s.docs),
                    ).toISOString()}
                  >
                    {nextReviewAt(entry, reviewTarget(s.docs)).toLocaleString()}
                  </time>
                </span>
              </p>
            </div>
          </div>
          {editing && (
            <section
              className="entry-meta"
              aria-label={t("词条信息", "Entry details")}
            >
              <label>
                {t("所属分类", "Category")}
                <CategoryPicker
                  value={entry.category}
                  onChange={(category) => moveEntry(id, category)}
                />
              </label>
              <label>
                {t("标签（逗号分隔）", "Tags (comma separated)")}
                <input
                  defaultValue={entry.tags.join(", ")}
                  key={entry.id + entry.tags.join(",")}
                  onBlur={(e) =>
                    void store.patch("entry", id, {
                      tags: json(
                        e.target.value
                          .split(/[,，]/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                      ),
                    })
                  }
                />
              </label>
              <button
                className="danger full"
                onClick={() => {
                  void confirmation.request(
                    t(
                      "删除此条目？日志将保留，可在数据库管理中恢复。",
                      "Delete this entry? Its history remains recoverable.",
                    ),
                    async () => {
                      await store.patch("entry", id, { deleted: true });
                      onBack();
                    },
                  );
                }}
              >
                <Trash2 size={15} />
                {t("删除词条", "Delete entry")}
              </button>
            </section>
          )}
        </div>
      </div>
      {insertingReference && (
        <EntrySwitcher
          insert
          exclude={id}
          onClose={() => setInsertingReference(false)}
          onChoose={(target) => {
            const entry = store
              .getSnapshot()
              .entries.find((entry) => entry.id === target);
            if (entry) appendReference(entryLinkMarkdown(entry));
          }}
        />
      )}
      {chatOpen && (
        <aside
          className="entry-chat-panel"
          aria-label={t("词条 AI 侧栏", "Entry AI sidebar")}
        >
          <header>
            <strong>{t("词条 AI 对话", "Entry AI chat")}</strong>
            <button
              className="icon"
              aria-label={t("关闭 AI 侧栏", "Close AI sidebar")}
              onClick={() => setChatOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          <Suspense fallback={<p>{t("加载对话…", "Loading chat…")}</p>}>
            <EntryAgent
              entryId={id}
              initialTopic={chatTopic}
              quote={chatQuote}
              embedded
              notify={notify}
            />
          </Suspense>
        </aside>
      )}
      {Object.keys(doc?.conflicts ?? {}).length > 0 && (
        <div className="warning">
          {t(
            "发现并发修改，所有版本已保留。请在历史中比较并选择，保存后会合并已观察到的版本。",
            "Concurrent edits retained. Compare alternatives in history and save the desired version.",
          )}
          <button onClick={() => setHistory(true)}>
            {t("查看冲突", "View conflicts")}
          </button>
        </div>
      )}
      <div className="entry-columns">
        <aside className="entry-outline">
          <details
            open={outlineOpen}
            onToggle={(event) => setOutlineOpen(event.currentTarget.open)}
          >
            <summary>{t("文档大纲", "Document outline")}</summary>
            <DocumentOutline
              document={document}
              focusId={focusId}
              onFocus={setFocusId}
              allowFocus={!sourceOnly}
              onLocate={locate}
            />
          </details>
        </aside>
        <article
          className="paper"
          onClickCapture={(event) => {
            const anchor = (
              event.target as HTMLElement
            ).closest<HTMLAnchorElement>("a[href]");
            if (!anchor || !/^entry:/i.test(anchor.getAttribute("href") ?? ""))
              return;
            event.preventDefault();
            if (editing && !event.ctrlKey && !event.metaKey) return;
            event.stopPropagation();
            const target = entryLinkTarget(anchor.getAttribute("href") ?? "");
            if (
              !target ||
              !store.getSnapshot().entries.some((entry) => entry.id === target)
            )
              notify(
                t(
                  "引用词条不存在或已删除",
                  "Referenced entry is missing or deleted",
                ),
              );
            else
              window.dispatchEvent(
                new CustomEvent("zhinexus:open-entry", { detail: target }),
              );
          }}
        >
          <div className="editor-toolbar">
            <button
              disabled={saving}
              onClick={() => setInsertingReference(true)}
            >
              <Link2 size={16} />
              {t("引用词条", "Link entry")}
            </button>
            <button
              disabled={!!busy || dirty}
              onClick={() =>
                void act(
                  t("加入解释队列…", "Queueing explanation…"),
                  async () => {
                    await submitAIJob("explain", {
                      page: "entry",
                      entryId: id,
                    });
                  },
                )
              }
            >
              <WandSparkles size={16} />
              {t("AI 标准解释", "AI explanation")}
            </button>
            <button
              disabled={!!busy || dirty}
              onClick={() =>
                void act(
                  t("加入关联队列…", "Queueing connections…"),
                  async () => {
                    await submitAIJob("relations", {
                      page: "entry",
                      entryId: id,
                    });
                  },
                )
              }
            >
              {t("发现关联", "Find connections")}
            </button>
            <label className="button">
              <ImagePlus size={16} />
              {t("添加图片", "Add image")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) =>
                  void act(t("导入图片", "Importing"), () => attach(e))
                }
              />
            </label>
            <button
              disabled={!!busy}
              onClick={() =>
                setImagePrompt(renderPrompt(s.ai.tasks.image.prompt, vars))
              }
            >
              <Sparkles size={16} />
              {t("AI 配图", "AI image")}
            </button>
            {busy && <Busy label={busy} />}
          </div>
          {editing && (
            <div className="editor-mode">
              <button
                data-editor-mode="rich"
                disabled={sourceOnly || saving}
                className={!sourceMode ? "active" : ""}
                onClick={() => setSourceMode(false)}
              >
                {t("所见即所得", "Rich blocks")}
              </button>
              <button
                data-editor-mode="source"
                disabled={saving}
                className={sourceMode ? "active" : ""}
                onClick={() => {
                  setFocusId(null);
                  setSourceMode(true);
                }}
              >
                {t("Markdown 源码", "Markdown source")}
              </button>
              <small>
                {t(
                  "本机草稿；保存词条后参与同步",
                  "Local draft; save the entry to sync",
                )}
              </small>
            </div>
          )}
          {focusId && (
            <div className="focus-breadcrumb">
              <button onClick={() => setFocusId(null)}>
                {t("完整文档", "Full document")}
              </button>
              <span>
                ›{" "}
                {documentBlocks(document).find((b) => b.id === focusId)?.text ||
                  t("当前块", "Focused block")}
              </span>
            </div>
          )}
          {sourceOnly && (
            <p className="notice">
              {t(
                "此文档含脚注或 HTML，使用 Markdown 源码编辑以保留原文。",
                "This document contains footnotes or HTML. Use Markdown source to preserve its original content.",
              )}
            </p>
          )}
          {editing && (sourceMode || sourceOnly) ? (
            <textarea
              className="content-editor"
              disabled={saving}
              aria-label="Markdown"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setRichCache(null);
                setFocusId(null);
              }}
            />
          ) : sourceOnly ? (
            <Markdown>{entry.content}</Markdown>
          ) : (
            <BlockEditor
              document={document}
              editable={editing && !saving}
              focus={focus}
              onChat={(text) => openChat(text)}
              onFeedback={notify}
              onAnnotate={(json, markdown) => {
                if (!editing)
                  base.current = {
                    title: entry.title,
                    content: entry.content,
                    summary: entry.summary ?? "",
                  };
                setRichCache({ source: markdown, json });
                setContent(markdown);
                setTitle(editing ? title : entry.title);
                setEditing(true);
                notify(
                  t(
                    "标记已加入草稿，保存词条后同步",
                    "Annotation added to draft; save the entry to sync",
                  ),
                );
              }}
              onFocus={(id) => setFocusId(id)}
              onChange={(json, markdown) => {
                setRichCache({ source: markdown, json });
                setContent(markdown);
              }}
            />
          )}
          <EntryReferences id={id} />
        </article>
      </div>
      {confirmation.dialog}
      {compareSave && (
        <Modal
          wide
          title={t(
            "保存前比较外部修改",
            "Compare external changes before saving",
          )}
          onClose={() => setCompareSave(false)}
        >
          <p>
            {t(
              "开始编辑后，词条已在其他位置改变。请比较后再确认使用本机草稿；历史版本会保留。",
              "The entry changed elsewhere after editing began. Compare before applying this local draft; prior versions remain in history.",
            )}
          </p>
          <div className="compare-trees">
            <section>
              <h3>{t("当前已保存版本", "Current saved version")}</h3>
              <strong>{entry.title}</strong>
              <Markdown>{entry.content}</Markdown>
            </section>
            <section>
              <h3>{t("本机草稿", "Local draft")}</h3>
              <strong>{title}</strong>
              <Markdown>{content}</Markdown>
            </section>
          </div>
          <button
            className="primary"
            onClick={() => void act(t("保存中", "Saving"), () => save(true))}
          >
            {t("确认保存草稿", "Confirm draft save")}
          </button>
        </Modal>
      )}
      {imagePrompt !== null && (
        <Modal
          title={t("生成教学配图", "Generate an illustration")}
          onClose={() => setImagePrompt(null)}
        >
          <textarea
            rows={7}
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
          />
          <button
            className="primary"
            disabled={!!busy}
            onClick={() =>
              void act(t("生成图片…", "Generating image…"), async () => {
                await submitAIJob(
                  "image",
                  { page: "entry", entryId: id },
                  { prompt: imagePrompt },
                );
                setImagePrompt(null);
              })
            }
          >
            {busy ? (
              <Busy label={busy} />
            ) : (
              t("生成配图（审阅后插入）", "Generate image for review")
            )}
          </button>
        </Modal>
      )}
      {history && (
        <Modal
          wide
          title={t("历史与冲突版本", "History & concurrent versions")}
          onClose={() => setHistory(false)}
        >
          <div className="modal-scroll">
            {Object.entries(doc?.conflicts ?? {}).map(([field, versions]) => (
              <section className="conflict" key={field}>
                <h3>
                  {t("冲突字段", "Conflicting field")}: {field}
                </h3>
                {versions.map((v) => (
                  <div key={v.event.hash}>
                    <pre>
                      {typeof v.value === "string"
                        ? v.value
                        : JSON.stringify(v.value, null, 2)}
                    </pre>
                    <button
                      onClick={() =>
                        void store.patch(
                          "entry",
                          id,
                          { [field]: v.value },
                          "resolve-conflict",
                        )
                      }
                    >
                      {t("采用此版本并合并", "Choose and resolve")}
                    </button>
                  </div>
                ))}
              </section>
            ))}
            {[...(doc?.history ?? [])].reverse().map((e) => (
              <details key={e.hash}>
                <summary>
                  {new Date(e.op.at).toLocaleString()} · {e.op.source} ·{" "}
                  {Object.keys(e.op.patch).join(", ")}
                </summary>
                <p className="muted">
                  {t(
                    "来源进程仅在平台捕获可用时记录；网页无法读取其他进程。",
                    "Process provenance is only available to supported native capture flows.",
                  )}
                </p>
                <RevisionDiff event={e} history={doc?.history ?? []} />
                <pre>{JSON.stringify(e.op.patch, null, 2)}</pre>
              </details>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
