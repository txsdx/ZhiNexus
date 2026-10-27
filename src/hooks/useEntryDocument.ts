/** Resumable entry drafts, scoped block state and reviewed saves independent from the entry page's AI tools. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { Entry, Json } from "../core/types";
import { store } from "../core/store";
import { entryWorkspace } from "../core/workspace";
import { useT } from "../components/common";
import {
  entryDocument,
  storedDocument,
  createBlockFocus,
  type BlockFocus,
  sourceOnlyMarkdown,
} from "../components/editor/document";
/** Keep tab-local edits durable and require comparison when another writer changed the saved entry. */
export function useEntryDocument(
  id: string,
  entry: Entry | undefined,
  notify: (message: string) => void,
) {
  const t = useT();
  const draft = entryWorkspace.getSnapshot().drafts[id];
  const hasDraftEdits =
    !!draft &&
    (draft.content !== draft.base.content ||
      draft.title !== draft.base.title ||
      draft.summary !== draft.base.summary);
  const resumable =
    !!draft?.editing &&
    hasDraftEdits &&
    (!entry ||
      draft.content !== entry.content ||
      draft.title !== entry.title ||
      draft.summary !== (entry.summary ?? ""));
  const [editing, setEditing] = useState(resumable),
    [content, setContent] = useState(
      resumable ? (draft?.content ?? "") : (entry?.content ?? ""),
    ),
    [title, setTitle] = useState(
      resumable ? (draft?.title ?? "") : (entry?.title ?? ""),
    ),
    [summary, setSummary] = useState(
      resumable ? (draft?.summary ?? "") : (entry?.summary ?? ""),
    ),
    [sourceMode, setSourceMode] = useState(
      draft?.sourceMode ?? sourceOnlyMarkdown(entry?.content ?? ""),
    ),
    [focus, setFocus] = useState<BlockFocus | null>(draft?.focus ?? null),
    [richCache, setRichCache] = useState<{
      source: string;
      json: JSONContent;
    } | null>(() =>
      draft?.editorDocument
        ? {
            source: draft.content,
            json: entryDocument({
              content: draft.content,
              editorDocument: {
                schema: 1,
                markdown: draft.content,
                json: draft.editorDocument as Json,
              },
            }),
          }
        : null,
    ),
    [compareSave, setCompareSave] = useState(false),
    [saving, setSaving] = useState(false);
  const base = useRef(
    (resumable ? draft?.base : undefined) ?? {
      title: entry?.title ?? "",
      content: entry?.content ?? "",
      summary: entry?.summary ?? "",
    },
  );
  const document = useMemo(
    () =>
      editing
        ? richCache?.source === content
          ? richCache.json
          : entryDocument({ content })
        : richCache && richCache.source === entry?.content
          ? richCache.json
          : entryDocument({
              content: entry?.content ?? "",
              editorDocument: entry?.editorDocument,
            }),
    [editing, richCache, content, entry?.content, entry?.editorDocument],
  );
  const sourceOnly = sourceOnlyMarkdown(content);
  const focusId = focus?.id ?? null;
  /** Freeze outside siblings when zooming so subsequent edits stay inside that region. */
  const setFocusId = (id: string | null) =>
    setFocus(id ? createBlockFocus(document, id) : null);
  const dirty =
    editing &&
    (content !== base.current.content ||
      title !== base.current.title ||
      summary !== base.current.summary);
  useEffect(() => {
    if (!editing && entry) {
      setContent(entry.content);
      setTitle(entry.title);
      setSummary(entry.summary ?? "");
      base.current = {
        title: entry.title,
        content: entry.content,
        summary: entry.summary ?? "",
      };
    }
  }, [entry?.content, entry?.title, entry?.summary, editing]);
  useEffect(() => {
    if (!entry) return;
    entryWorkspace.draft(id, {
      title,
      content,
      summary,
      editing,
      sourceMode,
      focus,
      base: base.current,
      editorDocument: JSON.parse(JSON.stringify(document)),
    });
  }, [id, title, content, summary, editing, sourceMode, focus, document]);
  useEffect(() => {
    const receive = (event: Event) => {
      if ((event as CustomEvent<{ id: string }>).detail?.id !== id) return;
      const saved = entryWorkspace.getSnapshot().drafts[id];
      if (!saved) return;
      base.current = saved.base;
      setContent(saved.content);
      setTitle(saved.title);
      setSummary(saved.summary);
      setEditing(saved.editing);
      setSourceMode(saved.sourceMode);
      setFocus(saved.focus);
      setRichCache(
        saved.editorDocument
          ? { source: saved.content, json: saved.editorDocument as JSONContent }
          : null,
      );
    };
    window.addEventListener("zhinexus:ai-draft", receive);
    return () => window.removeEventListener("zhinexus:ai-draft", receive);
  }, [id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        saving ||
        (entryWorkspace.getSnapshot().pending &&
          entryWorkspace.getSnapshot().tabs.some((tab) =>
            entryWorkspace.isDirty(
              tab,
              store.getSnapshot().entries.find((e) => e.id === tab),
            ),
          ))
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);
  /** Commit knowledge first, then durably clear its old draft before acknowledging success. */
  const save = async (force = false) => {
    if (!entry) return;
    const remoteChanged =
      entry.content !== base.current.content ||
      entry.title !== base.current.title ||
      (entry.summary ?? "") !== base.current.summary;
    if (dirty && remoteChanged && !force) {
      setCompareSave(true);
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, Json> = {
        updatedAt: new Date().toISOString(),
      };
      if (content !== base.current.content) patch.content = content;
      if (title !== base.current.title) {
        if (!title.trim())
          throw Error(t("标题不能为空", "Title cannot be empty"));
        patch.title = title.trim();
      }
      if (summary !== base.current.summary) patch.summary = summary.trim();
      const body =
        typeof patch.content === "string" ? patch.content : entry.content;
      if (body === content && !sourceOnly)
        patch.editorDocument = storedDocument(
          body,
          document,
        ) as unknown as Json;
      await store.patch("entry", id, patch);
      entryWorkspace.clearDraft(id);
      await entryWorkspace.flush();
      setEditing(false);
      setCompareSave(false);
      notify(t("已保存", "Saved"));
    } finally {
      setSaving(false);
    }
  };
  /** Enter from the latest saved entry, or explicitly discard a cancelled local edit. */
  const beginEditing = () => {
    if (!entry) return;
    if (editing) {
      entryWorkspace.clearDraft(id);
      setEditing(false);
      setRichCache(null);
      return;
    }
    base.current = {
      title: entry.title,
      content: entry.content,
      summary: entry.summary ?? "",
    };
    if (sourceOnlyMarkdown(entry.content)) setSourceMode(true);
    setContent(entry.content);
    setTitle(entry.title);
    setSummary(entry.summary ?? "");
    setRichCache({ source: entry.content, json: document });
    setEditing(true);
  };
  const latest = useRef({ editing, content, title, entry, document });
  latest.current = { editing, content, title, entry, document };
  /** Async attachments append to the latest tab draft, preserving edits made while the provider was responding. */
  const appendImage = (hash: string, alt: string) => {
    const current = latest.current,
      e = current.entry;
    if (!e) return;
    if (!current.editing)
      base.current = {
        title: e.title,
        content: e.content,
        summary: e.summary ?? "",
      };
    const next =
      (current.editing ? current.content : e.content) +
      `\n\n![${alt}](asset:${hash})\n`;
    setRichCache({
      source: next,
      json: {
        ...current.document,
        content: [
          ...(current.document.content ?? []),
          {
            type: "image",
            attrs: { src: "asset:" + hash, alt, blockId: crypto.randomUUID() },
          },
        ],
      },
    });
    setContent(next);
    setTitle(current.editing ? current.title : e.title);
    setEditing(true);
  };
  /** Exit zoom before locating a block in the complete document. */
  const locate = (blockId: string) => {
    setFocusId(null);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => documentGlobal(blockId)),
    );
  };
  /** Escape untrusted IDs before constructing a DOM selector. */
  const documentGlobal = (blockId: string) => {
    const target = window.document.querySelector(
      `[data-blockid="${CSS.escape(blockId)}"]`,
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return {
    saving,
    editing,
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
    richCache,
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
  };
}
