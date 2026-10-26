/** Typed settings state, draft edits and action feedback shared by independent configuration panels. */
import {
  Bell,
  Database,
  FolderTree,
  Globe,
  Palette,
  Plug,
  Settings2,
  Sparkles,
  ScrollText,
} from "lucide-react";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { useKnowledge, useT } from "../../components/common";
import { store } from "../../core/store";
import type { AIConfig, DeviceConfig, Task } from "../../core/types";
import { type Classification } from "../../services/classification";
import { settingsEditor, flushSettings } from "../../services/settings";
import { diagnostics } from "../../services/diagnostics";
/** useSettingsState exposes one focused settings workflow. */
export function useSettingsState(
  notify: (s: string) => void,
  initialTab: string,
) {
  const s = useKnowledge(),
    t = useT(),
    [tab, setTab] = useState(initialTab === "sync" ? "database" : initialTab),
    [task, setTask] = useState<Task>("explain"),
    [busy, setBusy] = useState(""),
    [report, setReport] = useState(""),
    [categoryName, setCategoryName] = useState(""),
    [parent, setParent] = useState(""),
    [proposal, setProposal] = useState<Classification | null>(null),
    [archive, setArchive] = useState<{
      mode: "export" | "import";
      text: string;
    } | null>(null),
    [password, setPassword] = useState(""),
    [size, setSize] = useState(0);
  const editor = settingsEditor();
  const saved = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const { ai, device } = saved.value;
  const setAI = (update: SetStateAction<AIConfig>) =>
    editor.update((previous) => ({
      ...previous,
      ai: typeof update === "function" ? update(previous.ai) : update,
    }));
  const setDevice = (update: SetStateAction<DeviceConfig>) =>
    editor.update((previous) => ({
      ...previous,
      device: typeof update === "function" ? update(previous.device) : update,
    }));
  useEffect(
    () => () => {
      void editor.flush().catch(() => {});
    },
    [editor],
  );
  const appearance = saved.value.appearance;
  useEffect(() => {
    void store.db.size().then(setSize);
  }, [s.revision]);
  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await flushSettings();
      await fn();
    } catch (e) {
      diagnostics.error("app", label, e);
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const updateAppearance = (key: string, value: string | number) =>
    editor.update((previous) => ({
      ...previous,
      appearance: { ...previous.appearance, [key]: value },
    }));
  const tabs = [
    { id: "appearance", label: t("外观与语言", "Appearance"), icon: Palette },
    { id: "ai", label: t("AI 与模型", "AI & models"), icon: Sparkles },
    {
      id: "prompts",
      label: t("任务与提示词", "Tasks & prompts"),
      icon: Settings2,
    },
    { id: "mcp", label: "MCP", icon: Plug },
    { id: "categories", label: t("知识分类", "Categories"), icon: FolderTree },
    {
      id: "database",
      label: t("数据库与云同步", "Database & cloud sync"),
      icon: Database,
    },
    { id: "network", label: t("网络与代理", "Network & proxy"), icon: Globe },
    { id: "notifications", label: t("通知设置", "Notifications"), icon: Bell },
    {
      id: "desktop",
      label: t("后台与快捷键", "Background & shortcuts"),
      icon: Settings2,
    },
    { id: "about", label: t("关于与更新", "About & updates"), icon: Globe },
    { id: "logs", label: t("日志", "Logs"), icon: ScrollText },
  ];
  return {
    s,
    t,
    tab,
    setTab,
    ai,
    setAI,
    device,
    setDevice,
    task,
    setTask,
    busy,
    setBusy,
    report,
    setReport,
    categoryName,
    setCategoryName,
    parent,
    setParent,
    proposal,
    setProposal,
    archive,
    setArchive,
    password,
    setPassword,
    size,
    setSize,
    appearance,
    act,
    updateAppearance,
    tabs,
    notify,
    saveState: saved,
    flushSettings,
  };
}
export type SettingsValue = ReturnType<typeof useSettingsState>;
