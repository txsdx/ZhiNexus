/** Resolve retained concurrent versions for every replicated collection without discarding audit history. */
import { useKnowledge, useT } from "./common";
import { store } from "../core/store";
/** Show all field alternatives, including settings, taxonomy, conversations and deleted documents. */
export function ConflictManager() {
  const s = useKnowledge(),
    t = useT(),
    conflicts = s.docs.filter((d) => Object.keys(d.conflicts).length);
  return (
    <section>
      <h3>{t("并发版本处理", "Concurrent versions")}</h3>
      {!conflicts.length ? (
        <p className="muted">
          {t("没有待处理的并发字段。", "No unresolved concurrent fields.")}
        </p>
      ) : (
        conflicts.map((d) => (
          <details key={d.collection + d.id}>
            <summary>
              {d.collection} · {String(d.fields.title ?? d.fields.name ?? d.id)}
            </summary>
            {Object.entries(d.conflicts).map(([field, versions]) => (
              <section key={field}>
                <h4>{field}</h4>
                {versions.map((v) => (
                  <div className="conflict" key={v.event.hash}>
                    <small>
                      {v.event.op.device.slice(0, 8)} ·{" "}
                      {new Date(v.event.op.at).toLocaleString()}
                    </small>
                    <pre>
                      {typeof v.value === "string"
                        ? v.value
                        : JSON.stringify(v.value, null, 2)}
                    </pre>
                    <button
                      onClick={() =>
                        void store.patch(
                          d.collection,
                          d.id,
                          { [field]: v.value },
                          "resolve-conflict",
                        )
                      }
                    >
                      {t("采用此版本并合并", "Choose this version and resolve")}
                    </button>
                  </div>
                ))}
              </section>
            ))}
          </details>
        ))
      )}
    </section>
  );
}
