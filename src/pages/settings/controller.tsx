/** Typed settings state, draft edits and action feedback shared by independent configuration panels. */
import {
  Bell,
  Cloud,
  Database,
  FolderTree,
  Globe,
  Palette,
  Plug,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useKnowledge, useT } from "../../components/common";
import { store } from "../../core/store";
import type { AIConfig, DeviceConfig, Task } from "../../core/types";
import { type Classification } from "../../services/classification";
/** useSettingsState exposes one focused settings workflow. */
export function useSettingsState(
  notify: (s: string) => void,
  initialTab: string,
) {
  const s = useKnowledge(),
    t = useT(),
    [tab, setTab] = useState(initialTab),
    [ai, setAI] = useState<AIConfig>(structuredClone(s.ai)),
    [device, setDevice] = useState<DeviceConfig>(structuredClone(s.device)),
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
  const appearance =
    s.docs.find((d) => d.collection === "setting" && d.id === "appearance")
      ?.fields ?? {};
  useEffect(() => {
    void store.db.size().then(setSize);
  }, [s.revision]);
  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const updateAppearance = (key: string, value: string | number) =>
    void store.patch("setting", "appearance", { [key]: value });
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
    { id: "sync", label: t("数据同步", "Data synchronization"), icon: Cloud },
    { id: "network", label: t("网络与代理", "Network & proxy"), icon: Globe },
    { id: "notifications", label: t("通知设置", "Notifications"), icon: Bell },
    {
      id: "desktop",
      label: t("后台与快捷键", "Background & shortcuts"),
      icon: Settings2,
    },
    {
      id: "database",
      label: t("数据库与备份", "Database & backup"),
      icon: Database,
    },
    { id: "about", label: t("关于与更新", "About & updates"), icon: Globe },
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
  };
}
export type SettingsValue = ReturnType<typeof useSettingsState>;
