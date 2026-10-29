/** Explicit outgoing/incoming Markdown references stay separate from inferred graph relationships. */
import { useMemo } from "react";
import { useKnowledge, useT } from "./common";
import { entryReferenceIndex } from "../core/entry-links";
/** Derive references from saved knowledge only; drafts do not publish links before Save. */
export function EntryReferences({ id }: { id: string }) {
  const s = useKnowledge(),
    t = useT(),
    index = useMemo(() => entryReferenceIndex(s.entries), [s.entries]);
  const incoming = index.incoming.get(id) ?? [],
    outgoing = index.outgoing.get(id) ?? [];
  const open = (id: string) =>
    window.dispatchEvent(
      new CustomEvent("zhinexus:open-entry", { detail: id }),
    );
  if (!incoming.length && !outgoing.length) return null;
  return (
    <details className="entry-references">
      <summary>
        {t("引用", "Links")} {outgoing.length} · {t("被引用", "Backlinks")}{" "}
        {incoming.length}
      </summary>
      <div>
        <h3>{t("引用的词条", "Links from this entry")}</h3>
        {outgoing.map((link) => {
          const target = s.entries.find((entry) => entry.id === link.id);
          return (
            <button
              key={link.id}
              disabled={!target}
              title={
                target?.title ??
                t("词条不存在或已删除", "Entry missing or deleted")
              }
              onClick={() => open(link.id)}
            >
              {target?.title ?? link.label}{" "}
              {!target && t("（已删除）", " (missing)")}
            </button>
          );
        })}
        {!outgoing.length && <span>—</span>}
      </div>
      <div>
        <h3>{t("引用此词条", "Backlinks")}</h3>
        {incoming.map((source) => (
          <button key={source} onClick={() => open(source)}>
            {s.entries.find((entry) => entry.id === source)?.title}
          </button>
        ))}
        {!incoming.length && <span>—</span>}
      </div>
    </details>
  );
}
