/** Knowledge editor, AI enrichment, revision audit trail and prerequisite capture. */
import { useEntryDocument } from "../hooks/useEntryDocument";
import { useConfirmation } from "../hooks/useConfirmation";
import { BlockEditor } from "../components/editor/BlockEditor";
import { DocumentOutline } from "../components/editor/DocumentOutline";
import { entryDocument, documentBlocks } from "../components/editor/document";
import { RevisionDiff } from "../components/RevisionDiff";
import { useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  Check,
  Edit3,
  GitBranch,
  History,
  ImagePlus,
  MessageSquare,
  Save,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { z } from "zod";
import { useKnowledge, useT, Modal, Busy } from "../components/common";
import { Markdown } from "../components/Markdown";
import { store } from "../core/store";
import {
  generateImage,
  parseJson,
  renderPrompt,
  runTask,
} from "../services/ai";
import { json } from "../core/store";
/** Render and edit one entry; save only changed fields so concurrent category changes are preserved. */
export function EntryPage({
  id,
  active = true,
  onBack,
  onOpen,
  onChat,
  notify,
}: {
  id: string;
  active?: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onChat: (id: string) => void;
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
    summary,
    setSummary,
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
    locate,
  } = useEntryDocument(id, entry, notify);
  const [history, setHistory] = useState(false),
    [busy, setBusy] = useState(""),
    [imagePrompt, setImagePrompt] = useState<string | null>(null),
    [preview, setPreview] = useState<string | null>(null);
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
    <div className="page entry-page">
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
        <div>
          <span className="category-dot">
            {s.categories.find((c) => c.id === entry.category)?.name ||
              t("未分类", "Uncategorized")}
          </span>
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
          <p>
            {t("创建于", "Created")}{" "}
            {new Date(entry.createdAt).toLocaleDateString()} ·{" "}
            {t("最近更新", "Updated")}{" "}
            {new Date(entry.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="actions">
          <button
            className="icon"
            title={t("变更历史", "History")}
            onClick={() => setHistory(true)}
          >
            <History size={19} />
          </button>
          <button disabled={saving} onClick={beginEditing}>
            <Edit3 size={16} />
            {editing ? t("取消", "Cancel") : t("编辑", "Edit")}
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
        <article className="paper">
          <div className="editor-toolbar">
            <button
              disabled={!!busy || dirty}
              onClick={() =>
                void act(t("生成解释…", "Generating…"), async () =>
                  setPreview(await runTask("explain", vars)),
                )
              }
            >
              <WandSparkles size={16} />
              {t("AI 标准解释", "AI explanation")}
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
              onFocus={(id) => setFocusId(id)}
              onChange={(json, markdown) => {
                setRichCache({ source: markdown, json });
                setContent(markdown);
              }}
            />
          )}
        </article>
        <aside className="entry-aside">
          <DocumentOutline
            document={document}
            focusId={focusId}
            onFocus={setFocusId}
            allowFocus={!sourceOnly}
            onLocate={locate}
          />
          <section className="entry-summary-editor">
            <h3>{t("一句话解释", "One-line explanation")}</h3>
            {editing ? (
              <input
                aria-label={t("一句话解释", "One-line explanation")}
                disabled={saving}
                value={summary}
                maxLength={600}
                onChange={(e) => setSummary(e.target.value)}
              />
            ) : (
              <p>
                {entry.summary ||
                  t(
                    "自动提取正文中的一句话解释；编辑可单独设置。",
                    "Uses the one-sentence section from the body; edit to set it explicitly.",
                  )}
              </p>
            )}
          </section>
          <section>
            <h3>
              <GitBranch size={17} />
              {t("知识连接", "Connections")}
            </h3>
            <button
              disabled={!!busy || dirty}
              className="full"
              onClick={() =>
                void act(t("分析关联…", "Finding connections…"), async () => {
                  const r = z
                    .object({
                      prerequisites: z.array(z.string()).max(8),
                      relatedIds: z.array(z.string()),
                    })
                    .parse(
                      parseJson(
                        await runTask("relations", {
                          ...vars,
                          entries: JSON.stringify(
                            s.entries.map((e) => ({
                              id: e.id,
                              title: e.title,
                            })),
                          ),
                        }),
                      ),
                    );
                  await store.patch(
                    "entry",
                    id,
                    { prerequisites: json(r.prerequisites) },
                    "ai-relations",
                  );
                  for (const target of r.relatedIds)
                    if (target !== id && s.entries.some((e) => e.id === target))
                      await store.patch(
                        "edge",
                        crypto.randomUUID(),
                        { source: id, target, label: "related" },
                        "ai-relations",
                      );
                })
              }
            >
              <Sparkles size={15} />
              {t("自动建立关联", "Find connections")}
            </button>
            <h4>{t("前置知识", "Prerequisites")}</h4>
            {entry.prerequisites.length ? (
              entry.prerequisites.map((p) => (
                <button
                  className="prereq"
                  key={p}
                  onClick={() =>
                    void act(t("打开概念", "Opening"), async () => {
                      const existing = s.entries.find(
                        (e) =>
                          e.title.toLocaleLowerCase() === p.toLocaleLowerCase(),
                      );
                      onOpen(
                        existing?.id ??
                          (await store.createEntry(
                            p,
                            undefined,
                            "prerequisite",
                          )),
                      );
                    })
                  }
                >
                  {p}
                  <span>↗</span>
                </button>
              ))
            ) : (
              <p className="muted">
                {t(
                  "AI 可发现理解此概念所需的基础。",
                  "Discover the concepts that come before this one.",
                )}
              </p>
            )}
            <h4>{t("关联条目", "Related entries")}</h4>
            {s.docs
              .filter(
                (d) =>
                  d.collection === "edge" &&
                  !d.fields.deleted &&
                  (d.fields.source === id || d.fields.target === id),
              )
              .map((d) => {
                const other = s.entries.find(
                  (e) =>
                    e.id ===
                    (d.fields.source === id
                      ? d.fields.target
                      : d.fields.source),
                );
                return other ? (
                  <button
                    className="prereq"
                    key={d.id}
                    onClick={() => onOpen(other.id)}
                  >
                    {other.title} ↗
                  </button>
                ) : null;
              })}
          </section>
          <section>
            <h3>
              <MessageSquare size={17} />
              {t("和知识聊一聊", "Think it through")}
            </h3>
            <p>
              {t(
                "从“是什么”到“为什么”，每次提问都是更深一层的理解。",
                "Move from what to why, one question at a time.",
              )}
            </p>
            <button className="primary full" onClick={() => onChat(id)}>
              {t("打开词条助手", "Entry assistant")}
              <span>↗</span>
            </button>
          </section>
          <section>
            <h3>{t("词条信息", "Entry details")}</h3>
            <label>
              {t("所属分类", "Category")}
              <select
                value={entry.category}
                onChange={(e) =>
                  void store.patch("entry", id, { category: e.target.value })
                }
              >
                <option value="">{t("未分类", "Uncategorized")}</option>
                {s.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
            <p>
              {t("复习次数", "Reviews")}: {entry.card.reps}
              <br />
              {t("下次复习", "Next review")}: {entry.card.due.toLocaleString()}
            </p>
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
        </aside>
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
      {preview !== null && (
        <Modal
          wide
          title={t("AI 解释预览", "AI explanation preview")}
          onClose={() => setPreview(null)}
        >
          <div className="modal-scroll">
            <Markdown>{preview}</Markdown>
          </div>
          <button
            className="primary"
            onClick={() => {
              base.current = {
                title: entry.title,
                content: entry.content,
                summary: entry.summary ?? "",
              };
              setRichCache({
                source: preview,
                json: entryDocument({ content: preview }),
              });
              setContent(preview);
              setTitle(entry.title);
              setEditing(true);
              setPreview(null);
            }}
          >
            <Check size={16} />
            {t("采用并编辑（保存后生效）", "Use and edit (save to apply)")}
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
                const hash = await generateImage(imagePrompt);
                appendImage(hash, "AI illustration");
                setImagePrompt(null);
              })
            }
          >
            {busy ? (
              <Busy label={busy} />
            ) : (
              t("生成并插入草稿", "Generate and insert into draft")
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
