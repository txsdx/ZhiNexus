/** Commands reuse the same app actions as visible controls; local history contains IDs only. */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ActionPicker } from "./ActionPicker";
import { useT } from "./common";
import type { PickerItem } from "../core/action-picker";
import { rememberPickerAction } from "../core/action-picker";
import { store } from "../core/store";
/** An explicitly chosen app command can navigate or open a workflow without submitting AI or deleting knowledge. */
export interface AppCommand extends PickerItem {
  run: () => void | boolean | Promise<void | boolean>;
}
/** Store successful command usage after closing the picker so focus returns before a destination opens. */
export function CommandPalette({
  commands,
  onClose,
  onError,
  onSearch,
}: {
  commands: AppCommand[];
  onClose: () => void;
  onError: (message: string) => void;
  onSearch: (query: string) => void;
}) {
  const t = useT(),
    [recent, setRecent] = useState<string[]>([]),
    running = useRef(false),
    query = useRef("");
  useEffect(() => {
    void store.db
      .local<unknown>("command-recents-v1", [])
      .then((value) =>
        setRecent(
          Array.isArray(value)
            ? value
                .filter((id): id is string => typeof id === "string")
                .slice(0, 8)
            : [],
        ),
      )
      .catch(() => {});
  }, []);
  return (
    <ActionPicker
      title={t("命令面板", "Command palette")}
      placeholder={t("搜索命令或设置…", "Search commands or settings…")}
      items={commands}
      recent={recent}
      onClose={onClose}
      extra={(value) => {
        query.current = value;
        return value.trim()
          ? {
              id: "search-knowledge",
              label: t(
                `在知识库搜索：${value.trim().slice(0, 40)}`,
                `Search knowledge: ${value.trim().slice(0, 40)}`,
              ),
            }
          : undefined;
      }}
      onChoose={(id) => {
        if (running.current) return;
        running.current = true;
        flushSync(onClose);
        void (async () => {
          if (id === "search-knowledge") {
            onSearch(query.current.trim());
            return;
          }
          const command = commands.find(
            (item) => item.id === id && !item.disabled,
          );
          if (!command) return;
          const result = await command.run();
          if (result !== false) {
            const next = rememberPickerAction(recent, id);
            await store.db.setLocal("command-recents-v1", next);
          }
        })().catch((error) =>
          onError(String(error instanceof Error ? error.message : error)),
        );
      }}
    />
  );
}
