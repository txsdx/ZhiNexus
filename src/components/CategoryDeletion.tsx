/** Three-way subtree deletion with preserve-by-default keyboard consent and stale-preview protection. */
import { useEffect, useState } from "react";
import { Modal, useT } from "./common";
import { store } from "../core/store";
import {
  removeCategory,
  taxonomySignature,
  categoryCount,
  type CategoryRemoval,
} from "../services/categories";
interface Request {
  id: string;
  resolve: () => void;
  reject: (error: unknown) => void;
}
/** Ask the one application-owned deletion host; opening a request never changes the taxonomy. */
export function requestCategoryDeletion(id: string): Promise<void> {
  return new Promise((resolve, reject) =>
    window.dispatchEvent(
      new CustomEvent<Request>("zhinexus:delete-category", {
        detail: { id, resolve, reject },
      }),
    ),
  );
}
/** Mount once so tree and context-menu deletion share identical choices and atomic writes. */
export function CategoryDeletionHost() {
  const t = useT(),
    [pending, setPending] = useState<
      (Request & { signature: string; name: string; count: number }) | null
    >(null);
  useEffect(() => {
    let active: Request | null = null;
    const receive = (event: Event) => {
      const request = (event as CustomEvent<Request>).detail;
      if (active) {
        request.resolve();
        return;
      }
      const s = store.getSnapshot(),
        category = s.categories.find((c) => c.id === request.id);
      if (!category) {
        request.reject(Error("分类不存在 / Category missing"));
        return;
      }
      active = request;
      const finish = () => {
        active = null;
        request.resolve();
      };
      setPending({
        ...request,
        resolve: finish,
        reject: (error) => {
          active = null;
          request.reject(error);
        },
        signature: taxonomySignature(),
        name: category.name,
        count: categoryCount(s.categories, s.entries, request.id),
      });
    };
    window.addEventListener("zhinexus:delete-category", receive);
    return () => {
      window.removeEventListener("zhinexus:delete-category", receive);
      active?.resolve();
    };
  }, []);
  if (!pending) return null;
  const cancel = () => {
    setPending(null);
    pending.resolve();
  };
  const choose = (mode: CategoryRemoval) => {
    setPending(null);
    void removeCategory(pending.id, mode, pending.signature).then(
      pending.resolve,
      pending.reject,
    );
  };
  return (
    <Modal
      title={t("确认删除", "Confirm deletion")}
      onClose={cancel}
      onConfirm={() => choose("keep")}
    >
      <p>
        {t(
          `删除分类「${pending.name}」？层级内有 ${pending.count} 个词条。`,
          `Remove “${pending.name}”? Its subtree contains ${pending.count} entries.`,
        )}
      </p>
      <div className="actions">
        <button
          autoFocus
          data-confirm
          className="primary"
          onClick={() => choose("keep")}
        >
          {t("保留（移至上一级）", "Keep and move to parent")}
        </button>
        <button className="danger" onClick={() => choose("all")}>
          {t("删除全部条目和子分类", "Delete all entries and subcategories")}
        </button>
        <button onClick={cancel}>{t("取消", "Cancel")}</button>
      </div>
    </Modal>
  );
}
