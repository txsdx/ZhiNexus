/** Scrollable conversations with inline, cancellable title editing and explicit removal actions. */
import { useEffect, useRef, useState } from "react";
import { Check, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Topic } from "../../core/types";
import { useT } from "../common";

/** Keep edits isolated from streamed topic updates; Enter/blur commits and Escape cancels. */
function ConversationRow({
  topic,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  topic: Topic;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string, expected: string) => Promise<void>;
  onDelete: () => void;
}) {
  const t = useT(),
    [editing, setEditing] = useState(false),
    [value, setValue] = useState(topic.title),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const original = useRef(topic.title),
    pending = useRef(false),
    cancelled = useRef(false),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setValue(topic.title);
  }, [topic.title, editing]);
  useEffect(() => {
    if (editing) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    }
  }, [editing]);
  const start = () => {
    original.current = topic.title;
    cancelled.current = false;
    setValue(topic.title);
    setError("");
    setEditing(true);
  };
  const cancel = () => {
    cancelled.current = true;
    setEditing(false);
    setError("");
    setValue(topic.title);
  };
  const save = async () => {
    if (pending.current || cancelled.current) return;
    if (!value.trim()) {
      setError(t("标题不能为空", "Title is required"));
      input.current?.focus({ preventScroll: true });
      return;
    }
    if (value.trim() === original.current) {
      setEditing(false);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await onRename(value, original.current);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      input.current?.focus({ preventScroll: true });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <div className={"topic " + (active ? "active" : "")}>
      {editing ? (
        <div className="topic-editor">
          <input
            ref={input}
            aria-label={t("会话标题", "Conversation title")}
            value={value}
            maxLength={120}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void save();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
          />
          <button
            className="icon"
            aria-label={t("保存标题", "Save title")}
            disabled={saving}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void save()}
          >
            <Check size={14} />
          </button>
          <button
            className="icon"
            aria-label={t("取消编辑标题", "Cancel title edit")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancel}
          >
            <X size={14} />
          </button>
          {error && <small role="alert">{error}</small>}
        </div>
      ) : (
        <>
          <button
            className="topic-title"
            title={topic.title}
            onClick={onSelect}
            onDoubleClick={start}
          >
            <MessageSquare size={15} />
            <span>{topic.title}</span>
          </button>
          <button
            className="icon topic-rename"
            aria-label={
              t("编辑会话标题：", "Rename conversation: ") + topic.title
            }
            onClick={start}
          >
            <Pencil size={13} />
          </button>
          <button className="icon" aria-label="Delete topic" onClick={onDelete}>
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  );
}

/** The list scrolls independently of the message viewport and never expands the page. */
export function ConversationList({
  topics,
  selected,
  busy,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: {
  topics: Topic[];
  selected?: string;
  busy: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string, expected: string) => Promise<void>;
  onDelete: (topic: Topic) => void;
}) {
  const t = useT();
  return (
    <aside className="topic-list" aria-label={t("会话列表", "Conversations")}>
      <button disabled={busy} className="full" onClick={onNew}>
        <Plus size={16} />
        {t("新话题", "New conversation")}
      </button>
      <div className="topic-items">
        {topics.map((topic) => (
          <ConversationRow
            key={topic.id}
            topic={topic}
            active={topic.id === selected}
            onSelect={() => onSelect(topic.id)}
            onRename={(title, expected) => onRename(topic.id, title, expected)}
            onDelete={() => onDelete(topic)}
          />
        ))}
      </div>
    </aside>
  );
}
