/** Accessible entry tabs preserve local drafts and expose their real save status on every workspace page. */
import { X } from "lucide-react";
import { useKnowledge, useT } from "../common";
import { useConfirmation } from "../../hooks/useConfirmation";
import type { useEntryWorkspace } from "../../hooks/useEntryWorkspace";
import "./editor.css";
/** Close only after the user confirms dropping an unsaved draft; selecting another tab never discards it. */
export function EntryTabs({
  workspace,
  active,
  onOpen,
  onClose,
  notify,
}: {
  workspace: ReturnType<typeof useEntryWorkspace>;
  active: boolean;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  notify: (message: string) => void;
}) {
  const s = useKnowledge(),
    t = useT();
  const confirmation = useConfirmation(notify, {
    title: t("确认丢弃草稿", "Confirm discarding draft"),
    confirmLabel: t("丢弃并关闭", "Discard and close"),
  });
  if (!workspace.tabs.length) return null;
  return (
    <>
      <div
        className="entry-tabs"
        role="tablist"
        aria-label={t("已打开的词条", "Open entries")}
      >
        {workspace.tabs.map((id) => {
          const entry = s.entries.find((e) => e.id === id);
          return (
            <div
              key={id}
              className={
                "entry-tab " +
                (workspace.active === id && active ? "active" : "")
              }
            >
              <button
                role="tab"
                aria-selected={workspace.active === id && active}
                onClick={() => onOpen(id)}
              >
                {workspace.controller.isDirty(id, entry) ? "● " : ""}
                {workspace.drafts[id]?.title ||
                  entry?.title ||
                  t("已删除词条", "Deleted entry")}
              </button>
              <button
                className="close-tab"
                aria-label={
                  t("关闭标签：", "Close tab: ") + (entry?.title ?? id)
                }
                onClick={() => {
                  if (workspace.controller.isDirty(id, entry)) {
                    void confirmation.request(
                      t(
                        "关闭此标签并丢弃本机未保存草稿？",
                        "Close this tab and discard its unsaved local draft?",
                      ),
                      async () => onClose(id),
                    );
                  } else onClose(id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        <span className="entry-tabs-status" role="status">
          {workspace.error ||
            (workspace.pending
              ? t("草稿保存中…", "Saving local draft…")
              : t(
                  "本机草稿已保存；保存词条后同步",
                  "Local drafts saved; save entry to sync",
                ))}
        </span>
      </div>
      {confirmation.dialog}
    </>
  );
}
