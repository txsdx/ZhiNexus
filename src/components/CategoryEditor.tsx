/** Complete category management controls; deletion reassigns knowledge rather than deleting it. */
import { useState } from "react";
import { Edit3, Trash2, Check, X } from "lucide-react";
import { useKnowledge, useT } from "./common";
import { editCategory } from "../services/categories";
import { requestCategoryDeletion } from "./CategoryDeletion";
/** Edit names and hierarchy with explicit destructive confirmation and recoverable operation history. */
export function CategoryEditor() {
  const s = useKnowledge(),
    t = useT(),
    [editing, setEditing] = useState(""),
    [name, setName] = useState(""),
    [parent, setParent] = useState(""),
    [error, setError] = useState("");
  return (
    <section className="category-editor">
      <h3>{t("管理分类", "Manage categories")}</h3>
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      {s.categories.map((c) => (
        <div className="category-edit-row" key={c.id} data-category-id={c.id}>
          {editing === c.id ? (
            <>
              <input
                aria-label={t("修改分类名称", "Edit category name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <select
                aria-label={t("修改父分类", "Edit parent category")}
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">{t("顶层大类", "Top level")}</option>
                {s.categories
                  .filter((p) => p.id !== c.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button
                className="icon"
                aria-label={t("保存分类", "Save category")}
                onClick={() => {
                  setError("");
                  void editCategory(c.id, name, parent)
                    .then(() => setEditing(""))
                    .catch((e) => setError(String(e.message)));
                }}
              >
                <Check size={17} />
              </button>
              <button
                className="icon"
                aria-label="Cancel"
                onClick={() => setEditing("")}
              >
                <X size={16} />
              </button>
            </>
          ) : (
            <>
              <strong>{c.name}</strong>
              <small>
                {s.categories.find((p) => p.id === c.parent)?.name ||
                  t("顶层", "Top level")}
              </small>
              <button
                className="icon"
                aria-label={t("编辑分类 ", "Edit category ") + c.name}
                onClick={() => {
                  setEditing(c.id);
                  setName(c.name);
                  setParent(c.parent);
                  setError("");
                }}
              >
                <Edit3 size={16} />
              </button>
              <button
                className="icon danger"
                aria-label={t("删除分类 ", "Remove category ") + c.name}
                onClick={() => {
                  void requestCategoryDeletion(c.id).catch((error) =>
                    setError(String(error.message)),
                  );
                }}
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
