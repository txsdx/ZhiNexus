/** Line-level audit diffs against the actual causal predecessor, retaining concurrent history separately. */
import { diffLines } from "diff";
import type { Envelope } from "../core/types";
import { dominates, materialize } from "../core/crdt";
import { useT } from "./common";
/** Compare a content mutation with only operations the writer had observed before that mutation. */
export function RevisionDiff({
  event,
  history,
}: {
  event: Envelope;
  history: Envelope[];
}) {
  const t = useT();
  if (typeof event.op.patch.content !== "string") return null;
  const previous = materialize(
    history.filter(
      (e) => e.hash !== event.hash && dominates(event.op.vector, e.op.vector),
    ),
  ).find(
    (d) => d.id === event.op.entity && d.collection === event.op.collection,
  )?.fields.content;
  return (
    <div className="revision-diff">
      <h4>
        {t(
          "内容改动（相对于当时已知版本）",
          "Content changes (relative to causal predecessor)",
        )}
      </h4>
      <pre>
        {diffLines(
          typeof previous === "string" ? previous : "",
          event.op.patch.content,
        ).map((p, i) => (
          <span
            key={i}
            className={p.added ? "added" : p.removed ? "removed" : ""}
          >
            {p.value.split(/(?<=\n)/).map((line, j) => (
              <span key={j}>
                {p.added ? "+ " : p.removed ? "- " : "  "}
                {line}
              </span>
            ))}
          </span>
        ))}
      </pre>
    </div>
  );
}
