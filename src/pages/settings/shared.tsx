/** Reusable taxonomy preview and native/browser backup file export. */
import { useState } from "react";
import { Trash2, GripVertical } from "lucide-react";
import { requestCategoryDeletion } from "../../components/CategoryDeletion";
import { editCategory } from "../../services/categories";
import { categoryCount } from "../../services/categories";
import { useT } from "../../components/common";
import { native } from "../../core/database";
import type { Category } from "../../core/types";
/** CategoryTree exposes one focused settings workflow. */
export function CategoryTree({
  categories,
  assignments,
  editable = false,
}: {
  editable?: boolean;
  categories: Category[];
  assignments: { category: string }[];
}) {
  const t = useT(),
    [error, setError] = useState("");
  const drop = (event: React.DragEvent, parent: string) => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData("application/x-zhinexus-category");
    const category = categories.find((c) => c.id === id);
    if (!category) return;
    void editCategory(id, category.name, parent).then(
      () => setError(""),
      (error) => setError(String(error.message)),
    );
  };
  const render = (
    parent: string,
    visited = new Set<string>(),
  ): React.ReactNode =>
    categories
      .filter((c) => c.parent === parent && !visited.has(c.id))
      .map((c) => {
        const next = new Set([...visited, c.id]);
        return (
          <li key={c.id}>
            <span
              data-category-id={c.id}
              draggable={editable}
              onDragStart={(e) => {
                if (editable) {
                  e.stopPropagation();
                  e.dataTransfer.setData(
                    "application/x-zhinexus-category",
                    c.id,
                  );
                  e.dataTransfer.effectAllowed = "move";
                }
              }}
              onDragOver={(e) => {
                if (editable) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(e) => drop(e, c.id)}
            >
              {editable && <GripVertical size={14} aria-hidden="true" />}
              {c.name}
              <b>{categoryCount(categories, assignments, c.id)}</b>
              {editable && (
                <button
                  className="icon danger"
                  aria-label={
                    t("删除树分类 ", "Delete tree category ") + c.name
                  }
                  onClick={() =>
                    void requestCategoryDeletion(c.id).catch((error) =>
                      setError(String(error.message)),
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              )}
            </span>
            <ul>{render(c.id, next)}</ul>
          </li>
        );
      });
  return (
    <div>
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      <ul className="category-tree" aria-label={t("分类树", "Category tree")}>
        {editable && (
          <li>
            <span
              className="tree-root-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, "")}
            >
              {t("拖到这里移至顶层", "Drop here to move to top level")}
            </span>
          </li>
        )}
        {render("")}
        <li>
          <span>
            {t("未分类", "Uncategorized")}
            <b>{assignments.filter((a) => !a.category).length}</b>
          </span>
        </li>
      </ul>
    </div>
  );
}
/** saveFile exposes one focused settings workflow. */
export async function saveFile(text: string) {
  const name = "ZhiNexus-" + new Date().toISOString().slice(0, 10) + ".znb";
  if (native) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: name,
      filters: [{ name: "ZhiNexus encrypted backup", extensions: ["znb"] }],
    });
    if (path) {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, text);
    }
    return;
  }
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
