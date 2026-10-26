/** Reusable taxonomy preview and native/browser backup file export. */
import { categoryCount } from "../../services/categories";
import { useT } from "../../components/common";
import { native } from "../../core/database";
import type { Category } from "../../core/types";
/** CategoryTree exposes one focused settings workflow. */
export function CategoryTree({
  categories,
  assignments,
}: {
  categories: Category[];
  assignments: { category: string }[];
}) {
  const t = useT();
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
            <span>
              {c.name}
              <b>{categoryCount(categories, assignments, c.id)}</b>
            </span>
            <ul>{render(c.id, next)}</ul>
          </li>
        );
      });
  return (
    <ul className="category-tree">
      {render("")}
      <li>
        <span>
          {t("未分类", "Uncategorized")}
          <b>{assignments.filter((a) => !a.category).length}</b>
        </span>
      </li>
    </ul>
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
