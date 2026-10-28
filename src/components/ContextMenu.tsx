/** Accessible application menus for editors, knowledge, taxonomy, tabs, topics and task lists. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { store } from "../core/store";
import { copyText, pasteText } from "../services/clipboard";
import {
  openContextMenu,
  contextMenuHandled,
  type MenuItem,
} from "../services/context-menu";
import { requestCategoryDeletion } from "./CategoryDeletion";
import { editCategory, moveEntry } from "../services/categories";
import { entryColors } from "../core/entry-colors";
import { useConfirmation } from "../hooks/useConfirmation";
import { useT } from "./common";
interface Menu {
  x: number;
  y: number;
  items: MenuItem[];
  keyboard?: boolean;
}
/** Own one globally bounded menu and the consent gate for destructive menu actions. */
export function ContextMenu({ notify }: { notify: (message: string) => void }) {
  const t = useT(),
    [menu, setMenu] = useState<Menu | null>(null),
    [parents, setParents] = useState<Menu[]>([]),
    ref = useRef<HTMLDivElement>(null),
    previousFocus = useRef<HTMLElement | null>(null),
    confirmation = useConfirmation(notify);
  useEffect(() => {
    const receive = (event: Event) => {
      previousFocus.current = document.activeElement as HTMLElement | null;
      setMenu((event as CustomEvent<Menu>).detail);
      setParents([]);
    };
    const block = (event: MouseEvent) => event.preventDefault();
    const fallback = (event: MouseEvent) => {
      if (contextMenuHandled(event)) return;
      const target =
          event.target instanceof Element ? event.target : document.body,
        s = store.getSnapshot();
      const input = target.closest("textarea,input") as
        HTMLTextAreaElement | HTMLInputElement | null;
      const selected = input
        ? input.type === "password"
          ? ""
          : input.value.slice(
              input.selectionStart ?? 0,
              input.selectionEnd ?? 0,
            )
        : (window.getSelection()?.toString() ?? "");
      const selection = input
        ? [input.selectionStart ?? 0, input.selectionEnd ?? input.value.length]
        : null;
      const editable =
        input &&
        !input.disabled &&
        !input.readOnly &&
        ![
          "checkbox",
          "radio",
          "file",
          "button",
          "submit",
          "reset",
          "color",
          "range",
        ].includes(input.type);
      const replace = (text: string) => {
        if (!input || !selection) return;
        input.focus();
        try {
          input.setSelectionRange(selection[0], selection[1]);
        } catch {}
        const next =
          input.value.slice(0, selection[0]) +
          text +
          input.value.slice(selection[1]);
        if (input.type === "number" && next && !Number.isFinite(Number(next)))
          throw Error(
            t("粘贴内容不是有效数字", "Pasted content is not a valid number"),
          );
        const prototype =
          input.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
          input,
          next,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
        try {
          input.setSelectionRange(
            selection[0] + text.length,
            selection[0] + text.length,
          );
        } catch {}
      };
      const items: MenuItem[] = [
        {
          label: t("复制所选文本", "Copy selection"),
          disabled: !selected,
          run: () => copyText(selected),
        },
      ];
      if (editable)
        items.push(
          {
            label: t("剪切", "Cut"),
            disabled: !selected,
            run: async () => {
              await copyText(selected);
              replace("");
            },
          },
          {
            label: t("粘贴", "Paste"),
            run: async () => replace(await pasteText()),
          },
        );
      if (input && input.type !== "password")
        items.push({
          label: t("全选", "Select all"),
          run: () => {
            input.focus();
            input.select();
          },
        });
      if (
        !input &&
        !(target instanceof HTMLElement && target.isContentEditable)
      ) {
        const entryId =
          target.closest<HTMLElement>("[data-entry-id]")?.dataset.entryId;
        const entry = s.entries.find((e) => e.id === entryId);
        if (entry) {
          items.push(
            {
              label: t("打开词条", "Open entry"),
              run: () => {
                window.dispatchEvent(
                  new CustomEvent("zhinexus:open-entry", { detail: entry.id }),
                );
              },
            },
            {
              label: t("复制标题", "Copy title"),
              run: () => copyText(entry.title),
            },
            {
              label: t("复制 Markdown", "Copy Markdown"),
              run: () => copyText(entry.content),
            },
            {
              label: t("移动到…", "Move to…"),
              children: [
                { id: "", name: t("未分类", "Uncategorized") },
                ...s.categories,
              ].map((c) => ({
                label: c.name,
                disabled: entry.category === c.id,
                run: () => moveEntry(entry.id, c.id),
              })),
            },
            {
              label: t("背景颜色", "Background color"),
              children: entryColors.map((color, index) => ({
                label: t(
                  ["默认", "浅红", "浅绿", "浅蓝", "浅黄", "浅紫"][index],
                  [
                    "Default",
                    "Soft red",
                    "Soft green",
                    "Soft blue",
                    "Soft yellow",
                    "Soft purple",
                  ][index],
                ),
                color,
                run: () =>
                  store.patch("entry", entry.id, {
                    color,
                    updatedAt: new Date().toISOString(),
                  }),
              })),
            },
            {
              label: t("删除词条", "Delete entry"),
              danger: true,
              run: () =>
                confirmation.request(
                  t(`删除词条「${entry.title}」？`, `Delete “${entry.title}”?`),
                  () => store.patch("entry", entry.id, { deleted: true }),
                ),
            },
          );
          const tab = target.closest(".entry-tab");
          if (tab)
            items.push({
              label: t("关闭标签", "Close tab"),
              run: () =>
                (tab.querySelector(".close-tab") as HTMLButtonElement)?.click(),
            });
        }
        const categoryId =
          target.closest<HTMLElement>("[data-category-id]")?.dataset.categoryId;
        const category = s.categories.find((c) => c.id === categoryId);
        if (category)
          items.push(
            {
              label: t("复制分类名称", "Copy category name"),
              run: () => copyText(category.name),
            },
            {
              label: t("移动分类到…", "Move category to…"),
              children: [
                { id: "", name: t("顶层", "Top level") },
                ...s.categories.filter((c) => c.id !== category.id),
              ].map((c) => ({
                label: c.name,
                disabled: c.id === category.parent,
                run: () => editCategory(category.id, category.name, c.id),
              })),
            },
            {
              label: t("删除分类…", "Delete category…"),
              danger: true,
              run: () => requestCategoryDeletion(category.id),
            },
          );
        const topicNode = target.closest<HTMLElement>("[data-topic-id]");
        const topic = s.topics.find(
          (topic) => topic.id === topicNode?.dataset.topicId,
        );
        if (topic && topicNode)
          items.push(
            {
              label: t("复制对话", "Copy conversation"),
              run: () =>
                copyText(
                  topic.messages
                    .map((m) => `${m.role}: ${m.content ?? ""}`)
                    .join("\n\n"),
                ),
            },
            {
              label: t("编辑标题", "Edit title"),
              run: () =>
                (
                  topicNode.querySelector(".topic-rename") as HTMLButtonElement
                )?.click(),
            },
            {
              label: t("删除对话", "Delete conversation"),
              danger: true,
              run: () =>
                (
                  topicNode.querySelector(
                    '[aria-label="Delete topic"]',
                  ) as HTMLButtonElement
                )?.click(),
            },
          );
        const job = target.closest<HTMLElement>(".ai-job-card");
        if (job)
          items.push(
            {
              label: t("复制任务内容", "Copy task content"),
              run: () => copyText(job.innerText),
            },
            {
              label: t("打开任务", "Open task"),
              run: () =>
                (
                  job.querySelector(".ai-job-link") as HTMLButtonElement
                )?.click(),
            },
          );
      }
      openContextMenu(event, items);
    };
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setMenu(null);
    };
    const close = () => setMenu(null);
    const keyboard = (event: KeyboardEvent) => {
      if (!ref.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
      } else if (
        ["ArrowDown", "ArrowUp"].includes(event.key) &&
        !ref.current.contains(document.activeElement)
      ) {
        event.preventDefault();
        event.stopPropagation();
        ref.current
          .querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus();
      } else if (event.key === "Tab") setMenu(null);
    };
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("contextmenu", block, true);
    document.addEventListener("contextmenu", fallback);
    window.addEventListener("zhinexus:context-menu", receive);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("contextmenu", block, true);
      document.removeEventListener("contextmenu", fallback);
      window.removeEventListener("zhinexus:context-menu", receive);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [t]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!menu) {
      if (
        previousFocus.current?.isConnected &&
        (document.activeElement === document.body ||
          !document.activeElement?.isConnected)
      )
        previousFocus.current.focus({ preventScroll: true });
      return;
    }
    if (!node) return;
    const box = node.getBoundingClientRect();
    node.style.left =
      Math.max(6, Math.min(menu.x, window.innerWidth - box.width - 6)) + "px";
    node.style.top =
      Math.max(6, Math.min(menu.y, window.innerHeight - box.height - 6)) + "px";
    if (menu.keyboard)
      node.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu]);
  return (
    <>
      {menu && (
        <div
          ref={ref}
          className="context-menu"
          role="menu"
          aria-label={t("操作菜单", "Actions")}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setMenu(null);
            }
            const buttons = [
              ...(ref.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) ?? []),
            ];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }
          }}
        >
          {!!parents.length && (
            <button
              role="menuitem"
              onClick={() => {
                setMenu(parents.at(-1)!);
                setParents(parents.slice(0, -1));
              }}
            >
              {t("← 返回", "← Back")}
            </button>
          )}
          {menu.items.map((item, index) => (
            <button
              key={index}
              role="menuitem"
              disabled={item.disabled}
              className={item.danger ? "danger" : ""}
              aria-haspopup={item.children ? "menu" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (item.children) {
                  setParents([...parents, menu]);
                  setMenu({ ...menu, items: item.children });
                  return;
                }
                setMenu(null);
                void Promise.resolve()
                  .then(item.run)
                  .catch((error) =>
                    notify(
                      error instanceof Error ? error.message : String(error),
                    ),
                  );
              }}
            >
              {item.color && (
                <i className="color-swatch" data-entry-color={item.color} />
              )}
              {item.label}
              {item.children && <span aria-hidden="true">›</span>}
            </button>
          ))}
        </div>
      )}
      {confirmation.dialog}
    </>
  );
}
