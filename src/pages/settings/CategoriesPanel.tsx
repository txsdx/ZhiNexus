/** Categories configuration panel with explicit persistence and verification. */
import { CategoryEditor } from "../../components/CategoryEditor";
import { Sparkles } from "lucide-react";
import { store } from "../../core/store";
import { submitAIJob } from "../../services/ai-jobs";
import { useSettings } from "./context";
import { CategoryTree } from "./shared";
/** CategoriesPanel exposes one focused settings workflow. */
export function CategoriesPanel() {
  const { t, categoryName, setCategoryName, parent, setParent, s, busy, act } =
    useSettings();
  return (
    <>
      <h2>
        {t("为知识留出清晰的生长空间", "Give your knowledge room to grow")}
      </h2>
      <div className="form-grid">
        <label>
          {t("分类名称", "Category name")}
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
          />
        </label>
        <label>
          {t("父分类", "Parent category")}
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">
              {t("新建顶层大类", "New top-level category")}
            </option>
            {s.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        disabled={!categoryName.trim() || !!busy}
        onClick={() =>
          void act(t("添加分类…", "Adding category…"), async () => {
            const name = categoryName;
            const committed = await store.batchWhen(
              [
                {
                  collection: "category",
                  id: crypto.randomUUID(),
                  patch: { name: name.trim(), parent },
                },
              ],
              "category-create",
              () =>
                !parent ||
                store.getSnapshot().categories.some((c) => c.id === parent),
            );
            if (!committed)
              throw Error(
                t(
                  "父分类已不存在，请重新选择",
                  "Parent category no longer exists",
                ),
              );
            setCategoryName((current) => (current === name ? "" : current));
          })
        }
      >
        {t("添加分类", "Add category")}
      </button>
      <CategoryTree
        categories={s.categories}
        assignments={s.entries}
        editable
      />
      <CategoryEditor />
      <button
        className="primary"
        disabled={!!busy || !s.entries.length}
        onClick={() =>
          void act(t("分析全部条目…", "Organizing all entries…"), async () => {
            await submitAIJob("classification", {
              page: "settings",
              tab: "categories",
            });
          })
        }
      >
        <Sparkles size={16} />
        {t("一键智能整理 · 先预览再确认", "Smart organize · preview first")}
      </button>
      <p className="muted">
        {t(
          "保留你的大类，允许 AI 建立子类。确认前不会修改任何分类。",
          "Your top-level categories stay. AI may propose subcategories; nothing changes until confirmed.",
        )}
      </p>
    </>
  );
}
