/** Knowledge editor, AI enrichment, revision audit trail and prerequisite capture. */
import { useEffect, useState, type ChangeEvent } from "react";
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
  onBack,
  onOpen,
  onChat,
  notify,
}: {
  id: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onChat: (id: string) => void;
  notify: (s: string) => void;
}) {
  const s = useKnowledge(),
    t = useT(),
    entry = s.entries.find((e) => e.id === id),
    doc = s.docs.find((d) => d.collection === "entry" && d.id === id);
  const [editing, setEditing] = useState(false),
    [content, setContent] = useState(entry?.content ?? ""),
    [title, setTitle] = useState(entry?.title ?? ""),
    [history, setHistory] = useState(false),
    [busy, setBusy] = useState(""),
    [imagePrompt, setImagePrompt] = useState<string | null>(null),
    [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    setContent(entry?.content ?? "");
    setTitle(entry?.title ?? "");
    setEditing(false);
  }, [id]);
  const dirty =
    editing && (content !== entry?.content || title !== entry?.title);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const navigate = (e: Event) => {
      if (
        dirty &&
        !window.confirm(t("放弃尚未保存的修改？", "Discard unsaved changes?"))
      )
        e.preventDefault();
    };
    window.addEventListener("zhinexus:navigate", navigate);
    window.addEventListener("beforeunload", f);
    return () => {
      window.removeEventListener("zhinexus:navigate", navigate);
      window.removeEventListener("beforeunload", f);
    };
  }, [dirty]);
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
  const save = async () => {
    const patch: Record<string, string> = {
      updatedAt: new Date().toISOString(),
    };
    if (content !== entry.content) patch.content = content;
    if (title !== entry.title) {
      if (!title.trim()) throw Error("标题不能为空");
      patch.title = title.trim();
    }
    await store.patch("entry", id, patch);
    setEditing(false);
    notify(t("已保存", "Saved"));
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
    setContent(
      (editing ? content : entry.content) +
        `\n\n![${file.name.replace(/[\[\]\n]/g, "")}](asset:${hash})\n`,
    );
    setEditing(true);
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
          <button
            onClick={() => {
              setContent(entry.content);
              setTitle(entry.title);
              setEditing(!editing);
            }}
          >
            <Edit3 size={16} />
            {editing ? t("取消", "Cancel") : t("编辑", "Edit")}
          </button>
          {editing && (
            <button
              className="primary"
              onClick={() => void act(t("保存中", "Saving"), save)}
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
          {editing ? (
            <textarea
              className="content-editor"
              aria-label="Markdown"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          ) : (
            <Markdown>
              {entry.content ||
                t(
                  "点击编辑，记录你的理解。",
                  "Edit to start capturing your understanding.",
                )}
            </Markdown>
          )}
        </article>
        <aside className="entry-aside">
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
                if (
                  window.confirm(
                    t(
                      "删除此条目？日志将保留，可在数据库管理中恢复。",
                      "Delete this entry? Its history remains recoverable.",
                    ),
                  )
                )
                  void store.patch("entry", id, { deleted: true }).then(onBack);
              }}
            >
              <Trash2 size={15} />
              {t("删除词条", "Delete entry")}
            </button>
          </section>
        </aside>
      </div>
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
                setContent(
                  (editing ? content : entry.content) +
                    `\n\n![AI illustration](asset:${hash})\n`,
                );
                setTitle(entry.title);
                setEditing(true);
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
                <pre>{JSON.stringify(e.op.patch, null, 2)}</pre>
              </details>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
