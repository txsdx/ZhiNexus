/** Shared durable capture editor: paste/drop media, import documents and save raw material before AI enrichment. */
import { formatMarkdown, type MarkdownAction } from "../core/markdown-edit";
import { editTextarea } from "../services/textarea-edit";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useId,
  lazy,
  Suspense,
  useSyncExternalStore,
} from "react";
import {
  BookOpen,
  ChevronRight,
  FileUp,
  Clipboard,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  CaptureSession,
  registerCaptureEditor,
  type CaptureClient,
  type CaptureContext,
  type CaptureSaved,
  type CaptureSeed,
} from "../core/capture-draft";
import { captureRepository } from "../services/capture-repository";
import {
  captureImageReferences,
  removeCaptureImage,
  captureClipboardImages,
} from "../services/capture-images";
import {
  importCaptureFile,
  insertCaptureMaterial,
} from "../services/capture-import";
import { CategoryPicker } from "./CategoryPicker";
import { Modal, useT, useKnowledge } from "./common";
import { prepareInAppCapture } from "../services/quick-capture";
import { useConfirmation } from "../hooks/useConfirmation";
/** The OS close handler and modal dismissal both wait for the same pending import/draft work. */
export interface CaptureHandle {
  close(): Promise<void>;
  refresh(): Promise<void>;
}
interface EditorProps {
  client: CaptureClient;
  seed?: CaptureSeed;
  context: CaptureContext;
  onClose: () => void | Promise<void>;
  onOpen: (id: string) => void | Promise<void>;
  onSaved: (result: CaptureSaved) => void | Promise<void>;
}
/** Display a verified local draft image without opening SQLite inside the auxiliary webview. */
function DraftImage({
  client,
  draftId,
  hash,
  onRemove,
}: {
  client: CaptureClient;
  draftId: string;
  hash: string;
  onRemove: () => void;
}) {
  const t = useT(),
    [src, setSrc] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void client
      .request<string>({ type: "preview", draftId, hash })
      .then((value) => {
        if (active) setSrc(value);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [client, draftId, hash]);
  return (
    <div className="capture-image">
      {src ? (
        <img src={src} alt={t("草稿图片", "Draft image")} />
      ) : (
        <span title={error}>
          {error ? t("图片不可用", "Image unavailable") : "…"}
        </span>
      )}
      <button
        type="button"
        className="icon"
        aria-label={t("移除草稿图片", "Remove draft image")}
        onClick={onRemove}
      >
        <X size={14} />
      </button>
    </div>
  );
}
const CaptureMarkdown = lazy(() =>
  import("./Markdown").then((module) => ({ default: module.Markdown })),
);
/** Keep input local and editable during asynchronous work; only explicit submit promotes staged media into knowledge. */
export const CaptureEditor = forwardRef<CaptureHandle, EditorProps>(
  function CaptureEditor(
    { client, seed, context, onClose, onOpen, onSaved },
    ref,
  ) {
    const materialId = useId();
    const t = useT(),
      [session] = useState(() => new CaptureSession(client, seed));
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const [error, setError] = useState(""),
      [frozen, setFrozen] = useState(false),
      [saving, setSaving] = useState(false),
      [closing, setClosing] = useState(false),
      [preview, setPreview] = useState(false),
      [importing, setImporting] = useState(0),
      [dragging, setDragging] = useState(false),
      [warnings, setWarnings] = useState<string[]>([]),
      [matches, setMatches] = useState<{ id: string; title: string }[]>([]);
    const text = useRef<HTMLTextAreaElement>(null),
      title = useRef<HTMLInputElement>(null),
      fileInput = useRef<HTMLInputElement>(null),
      form = useRef<HTMLFormElement>(null),
      imports = useRef(Promise.resolve()),
      submitting = useRef(false),
      closePending = useRef(false),
      blocked = useRef(false),
      alive = useRef(true);
    const resolvePreview = useCallback(
      (hash: string) =>
        client.request<string>({
          type: "preview",
          draftId: session.getSnapshot().draft!.id,
          hash,
        }),
      [client, session],
    );
    const format = (action: MarkdownAction) => {
      const field = text.current,
        current = session.getSnapshot().draft;
      if (
        !field ||
        !current ||
        blocked.current ||
        submitting.current ||
        closePending.current ||
        preview
      )
        return;
      try {
        const edit = formatMarkdown(
          current.content,
          field.selectionStart,
          field.selectionEnd,
          action,
          t("文字", "text"),
        );
        editTextarea(field, current.content, edit);
        if (session.getSnapshot().draft?.content !== edit.value)
          session.patch({ content: edit.value });
      } catch (error) {
        setError(String(error instanceof Error ? error.message : error));
      }
    };
    const confirmation = useConfirmation(setError, {
      title: t("清空草稿", "Clear draft"),
      confirmLabel: t("清空", "Clear"),
    });
    const flush = async () => {
      await imports.current;
      await session.flush();
    };
    const close = async () => {
      if (closePending.current) return;
      if (submitting.current)
        throw Error(t("正在保存条目，请稍候…", "Saving entry; please wait…"));
      closePending.current = true;
      setClosing(true);
      try {
        if (session.getSnapshot().draft) await flush();
        await onClose();
      } finally {
        closePending.current = false;
        if (alive.current) setClosing(false);
      }
    };
    useImperativeHandle(ref, () => ({
      close,
      refresh: async () => {
        await imports.current;
        await session.reload();
      },
    }));
    useEffect(() => {
      alive.current = true;
      void session.init().catch(() => {});
      return () => {
        alive.current = false;
      };
    }, [session]);
    useEffect(
      () =>
        registerCaptureEditor({
          flush,
          freeze: (value) => {
            blocked.current = value;
            setFrozen(value);
          },
        }),
      [session],
    );
    useEffect(() => {
      let active = true;
      const timer = setTimeout(() => {
        void client
          .request<{ id: string; title: string }[]>({
            type: "search",
            query: state.draft?.title ?? "",
          })
          .then((value) => {
            if (active) setMatches(value);
          })
          .catch(() => {});
      }, 150);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [state.draft?.title, client]);
    const queueFiles = (files: File[] | Promise<File[]>, plainText = "") => {
      if (
        (Array.isArray(files) && !files.length) ||
        blocked.current ||
        closePending.current ||
        submitting.current
      )
        return;
      const original = session.getSnapshot().draft?.content ?? "",
        start = text.current?.selectionStart ?? original.length,
        end = text.current?.selectionEnd ?? original.length;
      setImporting((value) => value + 1);
      setError("");
      const task = imports.current
        .then(async () => {
          await session.init();
          let material = plainText,
            proposedTitle = "";
          const messages: string[] = [];
          for (const file of await files) {
            const current = session.getSnapshot().draft!;
            try {
              const imported = await importCaptureFile(
                file,
                client,
                current.id,
              );
              material += (material ? "\n\n" : "") + imported.markdown;
              proposedTitle ||= imported.title;
              messages.push(
                ...imported.warnings.map((w) => file.name + ": " + w),
              );
            } catch (error) {
              messages.push(
                file.name +
                  ": " +
                  String(error instanceof Error ? error.message : error),
              );
            }
          }
          const current = session.getSnapshot().draft!;
          if (material)
            session.patch({
              content: insertCaptureMaterial(
                current.content,
                original,
                start,
                end,
                material,
              ),
              ...(!current.title && proposedTitle
                ? { title: proposedTitle }
                : {}),
            });
          if (alive.current)
            setWarnings((previous) => [...previous, ...messages].slice(-30));
          await session.flush();
        })
        .catch((error) => {
          if (alive.current)
            setError(String(error instanceof Error ? error.message : error));
          throw error;
        })
        .finally(() => {
          if (alive.current) setImporting((value) => value - 1);
        });
      imports.current = task.catch(() => {});
    };
    const submit = async () => {
      if (submitting.current || blocked.current || closePending.current) return;
      submitting.current = true;
      setSaving(true);
      setError("");
      try {
        await flush();
        const result = await session.submit();
        if (result.created) setPreview(false);
        setWarnings([]);
        await onSaved(result);
        if (result.created) requestAnimationFrame(() => title.current?.focus());
      } catch (error) {
        setError(String(error instanceof Error ? error.message : error));
      } finally {
        submitting.current = false;
        if (alive.current) setSaving(false);
      }
    };
    useEffect(() => {
      const paste = () => {
        if (!blocked.current && !closePending.current && !submitting.current)
          queueFiles(captureClipboardImages());
      };
      window.addEventListener("zhinexus:capture-paste-image", paste);
      return () =>
        window.removeEventListener("zhinexus:capture-paste-image", paste);
    }, [client, frozen, saving]);
    if (!state.draft)
      return (
        <div className="capture-loading">
          <p>{state.error || t("正在恢复草稿…", "Restoring draft…")}</p>
          {state.error && (
            <button onClick={() => void session.init().catch(() => {})}>
              {t("重试", "Retry")}
            </button>
          )}
        </div>
      );
    const draft = state.draft,
      disabled = frozen || saving || closing,
      hashes = [
        ...new Set(captureImageReferences(draft.content).map((r) => r.hash)),
      ];
    return (
      <>
        <form
          ref={form}
          className="capture-form"
          data-dragging={dragging}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onKeyDown={(event) => {
            if (
              event.target === text.current &&
              !event.nativeEvent.isComposing &&
              (event.ctrlKey || event.metaKey) &&
              !event.altKey &&
              ["b", "i"].includes(event.key.toLowerCase())
            ) {
              event.preventDefault();
              event.stopPropagation();
              format(event.key.toLowerCase() === "b" ? "bold" : "italic");
              return;
            }
            if (
              event.key === "Enter" &&
              (event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229 ||
                event.repeat)
            ) {
              event.preventDefault();
              event.stopPropagation();
            } else if (
              event.key === "Enter" &&
              (event.ctrlKey || event.metaKey)
            ) {
              event.preventDefault();
              void submit();
            }
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.files].filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              event.stopPropagation();
              queueFiles(files);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDragging(true);
            }
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDragging(false);
          }}
          onDrop={(event) => {
            if (event.dataTransfer.files.length) {
              event.preventDefault();
              event.stopPropagation();
              setDragging(false);
              queueFiles([...event.dataTransfer.files]);
            }
          }}
        >
          <div className="capture-fields">
            {draft.source !== "manual-capture" && (
              <small className="capture-source" title={draft.source}>
                {t("来源：", "Source: ")}
                {draft.source}
              </small>
            )}
            <label>
              {t("概念 / 知识名称", "Concept / knowledge name")}
              <input
                ref={title}
                autoFocus
                maxLength={300}
                disabled={disabled}
                value={draft.title}
                onChange={(event) =>
                  !blocked.current &&
                  !closePending.current &&
                  !submitting.current &&
                  session.patch({ title: event.target.value })
                }
                placeholder={t(
                  "例如：认知负荷、贝叶斯定理…",
                  "For example: cognitive load, Bayes’ theorem…",
                )}
              />
            </label>
            {!!matches.length && (
              <div className="capture-matches">
                <small>
                  {t(
                    "你可能想复习这些概念",
                    "Perhaps you want to revisit these concepts",
                  )}
                </small>
                {matches.map((entry) => (
                  <button
                    type="button"
                    disabled={disabled}
                    key={entry.id}
                    onClick={() =>
                      void flush()
                        .then(() => onOpen(entry.id))
                        .catch((error) => setError(String(error)))
                    }
                  >
                    <BookOpen size={15} />
                    {entry.title}
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            )}
            <label>
              {t("所属分类", "Category")}
              <CategoryPicker
                value={draft.category}
                onChange={(category) => {
                  if (
                    !blocked.current &&
                    !closePending.current &&
                    !submitting.current
                  )
                    session.patch({ category });
                }}
                categories={context.categories}
                disabled={disabled}
              />
            </label>
            <div className="capture-material">
              <label htmlFor={materialId}>
                {t(
                  "随手记下的理解或原始材料（可选）",
                  "Your understanding or source material (optional)",
                )}
              </label>
              <div
                className="capture-markdown-tools"
                role="toolbar"
                aria-label={t("Markdown 格式", "Markdown formatting")}
              >
                {(
                  [
                    ["bold", t("加粗", "Bold"), "B"],
                    ["italic", t("斜体", "Italic"), "I"],
                    ["heading", t("二级标题", "Heading 2"), "H2"],
                    ["list", t("无序列表", "Bullet list"), "•"],
                    ["code", t("代码块", "Code block"), "</>"],
                    ["link", t("链接", "Link"), "↗"],
                  ] as const
                ).map(([action, label, symbol]) => (
                  <button
                    key={action}
                    type="button"
                    disabled={disabled || preview}
                    aria-label={label}
                    title={label}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => format(action)}
                  >
                    {symbol}
                  </button>
                ))}
                <button
                  type="button"
                  className="capture-preview-toggle"
                  aria-pressed={preview}
                  disabled={disabled}
                  onClick={() => setPreview((value) => !value)}
                >
                  {preview ? t("编辑", "Edit") : t("预览", "Preview")}
                </button>
              </div>
              {preview ? (
                <div
                  className="capture-markdown-preview"
                  aria-label={t("正文预览", "Content preview")}
                  tabIndex={0}
                >
                  <Suspense
                    fallback={<p>{t("正在打开预览…", "Opening preview…")}</p>}
                  >
                    <CaptureMarkdown resolveAsset={resolvePreview}>
                      {draft.content || t("（空正文）", "(Empty content)")}
                    </CaptureMarkdown>
                  </Suspense>
                </div>
              ) : (
                <textarea
                  ref={text}
                  id={materialId}
                  rows={10}
                  disabled={disabled}
                  value={draft.content}
                  onChange={(event) =>
                    !blocked.current &&
                    !closePending.current &&
                    !submitting.current &&
                    session.patch({ content: event.target.value })
                  }
                  placeholder={t(
                    "支持 Markdown；可粘贴图片，或拖入图片、MD、DOCX 文件。",
                    "Markdown supported. Paste images or drop images, MD and DOCX files.",
                  )}
                />
              )}
            </div>
            {!!hashes.length && (
              <div
                className="capture-images"
                aria-label={t("草稿图片", "Draft images")}
              >
                {hashes.slice(0, 24).map((hash) => (
                  <DraftImage
                    key={draft.id + hash}
                    client={client}
                    draftId={draft.id}
                    hash={hash}
                    onRemove={() => {
                      if (
                        !blocked.current &&
                        !closePending.current &&
                        !submitting.current
                      )
                        session.patch({
                          content: removeCaptureImage(
                            session.getSnapshot().draft!.content,
                            hash,
                          ),
                        });
                    }}
                  />
                ))}
                {hashes.length > 24 && <small>+{hashes.length - 24}</small>}
              </div>
            )}
            {!!warnings.length && (
              <details className="capture-warnings" open>
                <summary>
                  {t("导入提示", "Import notices")} ({warnings.length})
                </summary>
                {warnings.map((message, index) => (
                  <p key={index}>{message}</p>
                ))}
              </details>
            )}
            {(error || state.error) && (
              <div role="alert" className="capture-error">
                <p>{error || state.error}</p>
                <button
                  type="button"
                  onClick={() =>
                    void flush().catch((error) => setError(String(error)))
                  }
                >
                  {t("重试保存草稿", "Retry draft save")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void confirmation.request(
                      t(
                        "重新加载会替换当前输入，请先复制需要保留的内容。",
                        "Reload replaces current input. Copy anything you need to keep first.",
                      ),
                      () => session.reload(true),
                    )
                  }
                >
                  {t("重新加载草稿", "Reload draft")}
                </button>
              </div>
            )}
          </div>
          <footer className="capture-footer">
            <div className="actions">
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                accept=".md,.markdown,.txt,.docx,image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  queueFiles([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
              >
                <FileUp size={16} />
                {t("添加图片或文档", "Add images or documents")}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (
                    !blocked.current &&
                    !closePending.current &&
                    !submitting.current
                  )
                    queueFiles(captureClipboardImages());
                }}
              >
                <Clipboard size={16} />
                {t("粘贴图片", "Paste image")}
              </button>
              <button
                type="button"
                className="icon"
                disabled={disabled || !!importing}
                aria-label={t("清空草稿", "Clear draft")}
                onClick={() =>
                  void confirmation.request(
                    t(
                      "清空这份未提交草稿及其图片？",
                      "Clear this unsubmitted draft and its images?",
                    ),
                    () => session.discard(),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
              <small
                role="status"
                data-capture-save-status={
                  state.error ? "error" : state.pending ? "pending" : "saved"
                }
              >
                {importing ? (
                  <>
                    <LoaderCircle size={14} className="spin" />
                    {t("正在导入…", "Importing…")}
                  </>
                ) : state.pending ? (
                  t("草稿保存中…", "Saving draft…")
                ) : (
                  t("草稿已保存", "Draft saved")
                )}
              </small>
            </div>
            <button
              className="primary full"
              disabled={!draft.title.trim() || disabled || !!importing}
              title="Ctrl / ⌘ + Enter"
            >
              <Plus size={16} />
              {t("保存到知识库", "Save to knowledge library")}
            </button>
          </footer>
        </form>
        {confirmation.dialog}
      </>
    );
  },
);
/** In-app capture keeps its familiar modal while sharing the same durable draft with the floating editor. */
export function Capture({
  onClose,
  onOpen,
  initial = "",
  source = "manual-capture",
  image = "",
  notify,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  initial?: string;
  source?: string;
  image?: string;
  notify: (text: string) => void;
}) {
  const t = useT(),
    s = useKnowledge(),
    editor = useRef<CaptureHandle>(null),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void prepareInAppCapture()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((error) => notify(String(error)));
    return () => {
      active = false;
    };
  }, []);
  const context = { categories: s.categories, appearance: {} };
  return (
    <Modal
      title={t("捕捉一个新的概念", "Capture a new concept")}
      className="capture-modal"
      onClose={() => {
        if (editor.current)
          void editor.current.close().catch((error) => notify(String(error)));
        else onClose();
      }}
    >
      {ready ? (
        <CaptureEditor
          ref={editor}
          client={captureRepository}
          context={context}
          seed={{ text: initial, source, image }}
          onClose={onClose}
          onOpen={(id) => {
            onClose();
            onOpen(id);
          }}
          onSaved={(result) => {
            if (result.warning) notify(result.warning);
            onClose();
            onOpen(result.id);
          }}
        />
      ) : (
        <p>{t("正在恢复草稿…", "Restoring draft…")}</p>
      )}
    </Modal>
  );
}
