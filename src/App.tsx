/** Application shell, responsive navigation, capture flow and per-device background services. */
import { needsReview, reviewTarget, nextReviewAt } from "./core/review-policy";
import { useReviewClock } from "./hooks/useReviewClock";
import {
  navigationHistory,
  startNavigationHistory,
} from "./services/navigation";
import { NavigationButtons } from "./components/NavigationButtons";
import { ContextMenu } from "./components/ContextMenu";
import { Capture } from "./components/Capture";
import type { AppCommand } from "./components/CommandPalette";
import { shortcutModifier } from "./core/action-picker";
import { startCaptureHost, showQuickCapture } from "./services/quick-capture";
import { useAppearance } from "./hooks/useAppearance";
import { flushSync } from "react-dom";
import { CategoryDeletionHost } from "./components/CategoryDeletion";
import { UpdateStatus } from "./components/UpdateStatus";
import { SyncStatus } from "./components/SyncStatus";
import { aiJobs } from "./services/ai-jobs";
import { useAIJobs } from "./hooks/useAIJobs";
import type { AITarget, AIJob } from "./core/ai-jobs";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Brain,
  ChartSpline,
  ChevronRight,
  Command,
  GitBranch,
  Home,
  LibraryBig,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  X,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { reconcileReminders } from "./services/reminders";
import { native } from "./core/database";
import {
  listenDesktop,
  observeSystemScale,
  quitDesktop,
  defaultDesktop,
  desktopAvailable,
  type DesktopAction,
} from "./services/desktop";
import { EntryTabs } from "./components/editor/EntryTabs";
import { useEntryWorkspace } from "./hooks/useEntryWorkspace";
import { OcrResult } from "./components/OcrResult";
import { Locale, useKnowledge, useT } from "./components/common";
import { Library } from "./pages/Library";
const EntrySwitcher = lazy(() =>
  import("./components/EntrySwitcher").then((m) => ({
    default: m.EntrySwitcher,
  })),
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);
const KeyboardHelp = lazy(() =>
  import("./components/KeyboardHelp").then((module) => ({
    default: module.KeyboardHelp,
  })),
);
const AIJobReview = lazy(() =>
  import("./components/AIJobView").then((m) => ({ default: m.AIJobReview })),
);
const AITaskCenter = lazy(() =>
  import("./components/AIJobView").then((m) => ({ default: m.AITaskCenter })),
);
const EntryPage = lazy(() =>
  import("./pages/Entry").then((m) => ({ default: m.EntryPage })),
);
const Review = lazy(() =>
  import("./pages/Review").then((m) => ({ default: m.Review })),
);
const Agent = lazy(() =>
  import("./pages/Agent").then((m) => ({ default: m.Agent })),
);
const ForgettingCurves = lazy(() =>
  import("./pages/ForgettingCurves").then((m) => ({
    default: m.ForgettingCurves,
  })),
);
const Graph = lazy(() =>
  import("./pages/Graph").then((m) => ({ default: m.Graph })),
);
const Settings = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Settings })),
);
import { store } from "./core/store";
import { startAutomaticSync } from "./services/auto-sync";
import { remind } from "./services/device";
/** Choose locale from synced preferences while retaining automatic system detection. */
export default function App() {
  const s = useKnowledge(),
    appearance =
      s.docs.find((d) => d.collection === "setting" && d.id === "appearance")
        ?.fields ?? {};
  const locale = useAppearance(appearance);
  return (
    <Locale value={locale}>
      <Shell />
    </Locale>
  );
}
/** Keep navigation and global search independent from local-first data operations. */
function Shell() {
  const s = useKnowledge(),
    t = useT(),
    [page, setPage] = useState("home"),
    [chatEntry, setChatEntry] = useState(""),
    [entryChatRequest, setEntryChatRequest] = useState<
      | { entryId: string; topicId?: string; nonce: number; open?: boolean }
      | undefined
    >(),
    [chatTopic, setChatTopic] = useState(""),
    [chatQuote, setChatQuote] = useState(""),
    [reviewSession, setReviewSession] = useState(""),
    [settingsTab, setSettingsTab] = useState("appearance"),
    [selectedJob, setSelectedJob] = useState(""),
    [query, setQuery] = useState(""),
    [capture, setCapture] = useState(false),
    [entrySwitcherOpen, setEntrySwitcherOpen] = useState(false),
    [commandsOpen, setCommandsOpen] = useState(false),
    [shortcutsOpen, setShortcutsOpen] = useState(false),
    [captureText, setCaptureText] = useState(""),
    [captureSource, setCaptureSource] = useState("manual-capture"),
    [captureImage, setCaptureImage] = useState(""),
    [ocr, setOcr] = useState<DesktopAction | null>(null),
    [actions, setActions] = useState<DesktopAction[]>([]),
    [toast, setToast] = useState("");
  const sidebarCollapsed =
    s.device.sidebarCollapsed ??
    s.docs.find((d) => d.id === "appearance" && d.collection === "setting")
      ?.fields.layout === "compact";
  const jobs = useAIJobs();
  const workspace = useEntryWorkspace(),
    entry = workspace.active;
  const interacted = useRef(false),
    restored = useRef(false);
  useEffect(() => {
    if (!workspace.ready || restored.current) return;
    restored.current = true;
    if (!interacted.current && workspace.active) setPage("entry");
  }, [workspace.ready, workspace.active]);
  const reviewNow = useReviewClock(),
    targetRetention = reviewTarget(s.docs);
  const reminderSignature = s.entries
    .map((e) => e.id + ":" + nextReviewAt(e, targetRetention).toISOString())
    .sort()
    .join("|");
  useEffect(() => {
    if (s.ready)
      void reconcileReminders().catch((e) => setToast(String(e.message)));
  }, [s.ready, s.device.notifications, reminderSignature]);
  const search = useRef<HTMLInputElement>(null);
  const navigate = (next: string) => {
    navigationHistory.captureCurrent();
    interacted.current = true;
    if (
      window.dispatchEvent(new Event("zhinexus:navigate", { cancelable: true }))
    ) {
      setPage(next);
      return true;
    }
    return false;
  };
  useEffect(() => {
    let cleanup: undefined | (() => void),
      live = true;
    void startCaptureHost()
      .then(async (stopHost) => {
        const stopDesktop = await listenDesktop((action) =>
          setActions((previous) => [...previous, action]),
        );
        return () => {
          stopDesktop();
          stopHost();
        };
      })
      .then((fn) => {
        if (live) cleanup = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      live = false;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    let stop: (() => void) | undefined,
      live = true;
    void observeSystemScale()
      .then((fn) => {
        if (live) stop = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  const actionRunning = useRef(false);
  useEffect(() => {
    if (ocr || !actions.length || actionRunning.current) return;
    if (capture && !["quick-capture", "quit"].includes(actions[0].kind)) return;
    const action = actions[0];
    setActions((previous) => previous.slice(1));
    if (action.kind === "quick-capture") {
      actionRunning.current = true;
      void showQuickCapture({ text: action.text, source: action.source }, () =>
        flushSync(() => setCapture(false)),
      )
        .catch((error) => setToast(String(error)))
        .finally(() => {
          actionRunning.current = false;
          setActions((previous) => [...previous]);
        });
      return;
    }
    if (action.kind === "quit") {
      actionRunning.current = true;
      void quitDesktop()
        .catch((e) => setToast(String(e)))
        .finally(() => {
          actionRunning.current = false;
          setActions((previous) => [...previous]);
        });
      return;
    }
    if (action.kind === "error") {
      setToast(action.text);
      return;
    }
    if (action.kind === "ocr") {
      setOcr(action);
      return;
    }
    setCaptureSource(action.source);
    setCaptureText(action.text);
    setCaptureImage("");
    setCapture(true);
  }, [actions, capture, ocr]);
  const notify = (text: string) => setToast(text);
  useEffect(() => {
    const receive = (event: Event) =>
      setToast(String((event as CustomEvent).detail));
    window.addEventListener("zhinexus:notify", receive);
    return () => window.removeEventListener("zhinexus:notify", receive);
  }, []);
  useEffect(() => {
    if (store.db.recoveryNotice)
      notify(
        t(
          "数据库已从验证副本恢复，原文件已保留。",
          "Database recovered from a verified copy; original retained.",
        ),
      );
  }, []);
  useEffect(() => {
    const onFailure = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      setToast(
        t(
          "操作未完成，数据不会被自动清空：",
          "Operation failed; your data has not been cleared: ",
        ) +
          String(
            event.reason instanceof Error ? event.reason.message : event.reason,
          ),
      );
    };
    window.addEventListener("unhandledrejection", onFailure);
    return () => window.removeEventListener("unhandledrejection", onFailure);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.repeat) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "p"
      ) {
        e.preventDefault();
        if (!document.querySelector('[role="dialog"]')) setCommandsOpen(true);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        if (!document.querySelector('[role="dialog"]')) search.current?.focus();
      }
      if (
        !native &&
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "n"
      ) {
        e.preventDefault();
        setCaptureSource("in-app-selection:ZhiNexus");
        setCaptureText(window.getSelection()?.toString() ?? "");
        setCapture(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!s.ready) return;
    const timer = setInterval(() => {
      void remind().catch(() => {});
    }, 60000);
    void remind().catch(() => {});
    return () => clearInterval(timer);
  }, [s.ready, s.device.notifications]);
  useEffect(() => startAutomaticSync((message) => setToast(message)), []);
  const open = (id: string) => {
    navigationHistory.captureCurrent();
    if (navigate("entry")) workspace.controller.open(id);
  };
  useEffect(() => {
    const receive = (event: Event) =>
      open((event as CustomEvent<string>).detail);
    window.addEventListener("zhinexus:open-entry", receive);
    return () => window.removeEventListener("zhinexus:open-entry", receive);
  });
  const routeRef = useRef({
    page,
    entryId: entry,
    chatEntry,
    chatTopic,
    settingsTab,
    reviewSession,
  });
  routeRef.current = {
    page,
    entryId: entry,
    chatEntry,
    chatTopic,
    settingsTab,
    reviewSession,
  };
  useEffect(
    () =>
      startNavigationHistory(
        () => routeRef.current,
        (route, sidebar) => {
          if (
            !window.dispatchEvent(
              new Event("zhinexus:navigate", { cancelable: true }),
            )
          )
            return false;
          setPage(route.page);
          setChatEntry(route.chatEntry);
          setChatTopic(route.chatTopic);
          setSettingsTab(route.settingsTab);
          setReviewSession(route.reviewSession);
          if (route.entryId) workspace.controller.open(route.entryId);
          if (route.page === "entry" && route.entryId)
            setEntryChatRequest({
              entryId: route.entryId,
              nonce: Date.now(),
              open: sidebar,
            });
          return true;
        },
      ),
    [],
  );
  useEffect(() => {
    const frame = requestAnimationFrame(() => navigationHistory.record());
    return () => cancelAnimationFrame(frame);
  }, [page, entry, chatEntry, chatTopic, settingsTab, reviewSession]);
  const destination = (target: AITarget) => {
    if (target.page === "entry" && target.entryId) open(target.entryId);
    else if (target.page === "agent" && target.entryId) {
      open(target.entryId);
      setEntryChatRequest({
        entryId: target.entryId,
        topicId: target.topicId,
        nonce: Date.now(),
      });
    } else if (target.page === "agent") {
      setChatEntry(target.entryId ?? "");
      setChatTopic(target.topicId ?? "");
      setChatQuote("");
      navigate("agent");
    } else if (target.page === "review") {
      setReviewSession(target.sessionId ?? "");
      navigate("review");
    } else if (target.page === "tasks") {
      navigate("tasks");
    } else if (target.page === "graph") {
      navigate("graph");
    } else {
      setSettingsTab(target.tab ?? "appearance");
      navigate("settings");
    }
  };
  const openJob = (job: AIJob) => {
    destination(job.target);
    setSelectedJob(job.id);
  };
  const openJobRef = useRef(openJob);
  openJobRef.current = openJob;
  useEffect(() => {
    const handle = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      const job = aiJobs.getSnapshot().jobs.find((j) => j.id === id);
      if (job) openJobRef.current(job);
    };
    window.addEventListener("zhinexus:ai-job", handle);
    const failed = (event: Event) =>
      setToast((event as CustomEvent<{ error: string }>).detail.error);
    window.addEventListener("zhinexus:ai-job-error", failed);
    return () => {
      window.removeEventListener("zhinexus:ai-job", handle);
      window.removeEventListener("zhinexus:ai-job-error", failed);
    };
  }, []);
  useEffect(() => {
    const quick = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "p" &&
        !event.isComposing &&
        !event.repeat
      ) {
        event.preventDefault();
        if (!document.querySelector('[role="dialog"]'))
          setEntrySwitcherOpen(true);
      }
    };
    window.addEventListener("keydown", quick);
    return () => window.removeEventListener("keydown", quick);
  }, []);
  const nav = [
    { id: "home", name: t("学习概览", "Overview"), icon: Home },
    { id: "library", name: t("我的知识库", "Knowledge"), icon: LibraryBig },
    {
      id: "review",
      name: t("复习队列", "Review queue"),
      icon: Brain,
      badge: s.entries.filter((e) => needsReview(e, targetRetention, reviewNow))
        .length,
    },
    {
      id: "curves",
      name: t("遗忘曲线", "Forgetting curves"),
      icon: ChartSpline,
    },
    { id: "graph", name: t("知识星图", "Knowledge graph"), icon: GitBranch },
    { id: "agent", name: t("学习伙伴", "AI companion"), icon: MessageSquare },
    {
      id: "tasks",
      name: t("AI 任务", "AI tasks"),
      icon: ListTodo,
      badge: jobs.jobs.length,
    },
  ];
  const modifier = shortcutModifier();
  const configuredDesktop = { ...defaultDesktop, ...s.device.desktop };
  const settingCommands = [
    [
      "appearance",
      t("外观与语言", "Appearance & language"),
      "theme font language 外观 字体 语言",
    ],
    ["ai", t("AI 与模型", "AI & models"), "model provider API 模型 接口"],
    ["prompts", t("任务与提示词", "Tasks & prompts"), "prompt 提示词 并发"],
    ["mcp", "MCP", "tools 工具 服务"],
    [
      "categories",
      t("知识分类", "Knowledge categories"),
      "category 分类 层级 树",
    ],
    [
      "database",
      t("数据库与云同步", "Database & sync"),
      "WebDAV backup storage 备份 同步",
    ],
    ["network", t("网络与代理", "Network & proxy"), "proxy 网络 代理"],
    [
      "memory",
      t("复习与记忆", "Review & memory"),
      "FSRS retention 复习 记忆 阈值",
    ],
    ["notifications", t("通知设置", "Notifications"), "reminder 通知 提醒"],
    [
      "desktop",
      t("后台与快捷键", "Desktop & shortcuts"),
      "hotkey shortcut 后台 快捷键",
    ],
    ["about", t("关于与更新", "About & updates"), "version update 版本 更新"],
    [
      "logs",
      t("日志", "Logs"),
      "AI request response error 日志 错误 请求 响应",
    ],
  ];
  const commandItems: AppCommand[] = [
    {
      id: "quick-entry",
      label: t("快速切换词条", "Go to entry"),
      shortcut: modifier + "+P",
      run: () => setEntrySwitcherOpen(true),
    },
    {
      id: "starred",
      label: t("查看收藏", "Show starred entries"),
      run: () => {
        if (navigate("library")) setQuery("is:starred");
      },
    },
    {
      id: "capture",
      label: t("新建词条", "New entry"),
      keywords: "create capture 添加 新建 记录",
      shortcut: modifier + "+Shift+N",
      run: () => {
        setCaptureText("");
        setCaptureImage("");
        setCaptureSource("manual-capture");
        setCapture(true);
      },
    },
    ...nav.map((item) => ({
      id: "nav:" + item.id,
      label: item.name,
      keywords: item.id,
      run: () => {
        const accepted = navigate(item.id);
        if (accepted && item.id === "agent") {
          setChatEntry("");
          setChatTopic("");
          setChatQuote("");
        }
        return accepted;
      },
    })),
    ...settingCommands.map(([tab, label, keywords]) => ({
      id: "settings:" + tab,
      label,
      detail: t("设置与偏好", "Settings & preferences"),
      keywords,
      run: () => {
        if (!navigate("settings")) return false;
        setSettingsTab(tab);
        return true;
      },
    })),
    {
      id: "search",
      label: t("搜索知识", "Search knowledge"),
      shortcut: modifier + "+K",
      run: () => {
        search.current?.focus();
      },
    },
    {
      id: "sidebar",
      label: sidebarCollapsed
        ? t("展开左侧栏", "Expand sidebar")
        : t("收起左侧栏", "Collapse sidebar"),
      keywords: "sidebar 侧栏",
      run: () => store.updateDevice({ sidebarCollapsed: !sidebarCollapsed }),
    },
    {
      id: "history:back",
      label: t("后退到上一个位置", "Go to previous position"),
      shortcut: "Alt+←",
      disabled: !navigationHistory.getSnapshot().canBack,
      run: () => navigationHistory.go(-1),
    },
    {
      id: "history:forward",
      label: t("前进到下一个位置", "Go to next position"),
      shortcut: "Alt+→",
      disabled: !navigationHistory.getSnapshot().canForward,
      run: () => navigationHistory.go(1),
    },
    {
      id: "shortcuts",
      label: t("键盘快捷键", "Keyboard shortcuts"),
      keywords: "help keyboard shortcut 帮助 快捷键",
      run: () => setShortcutsOpen(true),
    },
  ];
  if (desktopAvailable)
    commandItems.splice(1, 0, {
      id: "quick-capture",
      label: t("快速记录（独立窗口）", "Quick capture (floating window)"),
      shortcut: configuredDesktop.captureShortcut.replace(
        "CommandOrControl",
        modifier,
      ),
      run: () =>
        showQuickCapture(undefined, () => flushSync(() => setCapture(false))),
    });
  return (
    <div
      className={
        "app-shell" +
        (sidebarCollapsed ? " sidebar-collapsed" : " sidebar-expanded") +
        (page === "agent"
          ? " chat-workspace"
          : page === "graph"
            ? " graph-workspace"
            : "")
      }
    >
      <CategoryDeletionHost />
      <ContextMenu notify={notify} />
      <aside className="sidebar">
        <button
          className="sidebar-toggle icon"
          aria-label={
            sidebarCollapsed
              ? t("展开左侧栏", "Expand sidebar")
              : t("收起左侧栏", "Collapse sidebar")
          }
          aria-expanded={!sidebarCollapsed}
          title={
            sidebarCollapsed
              ? t("展开左侧栏", "Expand sidebar")
              : t("收起左侧栏", "Collapse sidebar")
          }
          onClick={() =>
            void store
              .updateDevice({ sidebarCollapsed: !sidebarCollapsed })
              .catch((error) => notify(String(error)))
          }
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={20} />
          ) : (
            <PanelLeftClose size={20} />
          )}
        </button>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <img className="brand-icon" src="/app-icon.png" alt="" />
          <span>
            <strong>知枢</strong>
            <small>ZhiNexus</small>
          </span>
        </a>
        <button
          className="capture-button"
          aria-label={t("记录新知识", "Capture knowledge")}
          title={t("记录新知识", "Capture knowledge")}
          onClick={() => {
            setCaptureSource("manual-capture");
            setCaptureImage("");
            setCaptureText("");
            setCapture(true);
          }}
        >
          <Plus size={18} />
          <span>{t("记录新知识", "Capture knowledge")}</span>
          <kbd>
            {configuredDesktop.captureShortcut
              .replace("CommandOrControl", modifier)
              .replace("Shift", "⇧")}
          </kbd>
        </button>
        <div className="nav-caption">{t("学习空间", "WORKSPACE")}</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              data-nav={n.id}
              title={n.name}
              className={
                page === n.id || (page === "entry" && n.id === "library")
                  ? "active"
                  : ""
              }
              onClick={() => {
                navigate(n.id);
                if (n.id === "agent") {
                  setChatEntry("");
                  setChatTopic("");
                  setChatQuote("");
                }
              }}
            >
              <n.icon size={19} />
              <span>{n.name}</span>
              {!!n.badge && <b>{n.badge}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={19} />
            <span>{t("设置与偏好", "Settings & preferences")}</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <Suspense
          fallback={<div className="boot-error">ZhiNexus · Loading…</div>}
        >
          <header className="topbar">
            <NavigationButtons />
            <div className="breadcrumb">
              ZhiNexus <ChevronRight size={13} />
              <span>
                {page === "entry"
                  ? s.entries.find((e) => e.id === entry)?.title
                  : page === "settings"
                    ? t("设置", "Settings")
                    : nav.find((n) => n.id === page)?.name}
              </span>
            </div>
            <div className="search-box">
              <Search size={17} />
              <input
                maxLength={500}
                ref={search}
                aria-label={t("搜索知识", "Search knowledge")}
                placeholder={t("搜索你的知识…", "Search your knowledge…")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value) navigate("library");
                }}
              />
              {query ? (
                <button
                  className="icon"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd>{modifier} K</kbd>
              )}
            </div>
            <button
              className="icon command-palette-button"
              aria-label={t("打开命令面板", "Open command palette")}
              title={modifier + "+Shift+P"}
              onClick={() => setCommandsOpen(true)}
            >
              <Command size={18} />
            </button>
            <button
              className="icon mobile-settings"
              aria-label={t("设置", "Settings")}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={18} />
            </button>
            <button
              className="ai-queue-button"
              onClick={() => navigate("tasks")}
              aria-label={t("打开 AI 任务队列", "Open AI task queue")}
            >
              <ListTodo size={17} />
              <span>
                {t("AI 任务", "AI tasks")} {jobs.jobs.length || ""}
              </span>
            </button>
            <UpdateStatus
              onOpen={() => {
                setSettingsTab("about");
                navigate("settings");
              }}
            />
            <SyncStatus notify={notify} />
          </header>
          {page !== "agent" && (
            <EntryTabs
              notify={notify}
              workspace={workspace}
              active={page === "entry"}
              onOpen={open}
              onClose={(id) => {
                const next = workspace.controller.close(id);
                if (page === "entry" && !next) navigate("library");
              }}
            />
          )}
          {page === "home" && (
            <Library
              dashboard
              onOpen={open}
              onCreate={() => {
                setCaptureText("");
                setCaptureSource("manual-capture");
                setCaptureImage("");
                setCapture(true);
              }}
              onReview={() => navigate("review")}
            />
          )}{" "}
          {page === "library" && (
            <Library
              query={query}
              onOpen={open}
              onCreate={() => {
                setCaptureText("");
                setCaptureSource("manual-capture");
                setCaptureImage("");
                setCapture(true);
              }}
              onReview={() => navigate("review")}
            />
          )}{" "}
          {workspace.tabs.map((id) => (
            <EntryPage
              key={id}
              id={id}
              chatRequest={
                entryChatRequest?.entryId === id ? entryChatRequest : undefined
              }
              active={page === "entry" && entry === id}
              onBack={() => navigate("library")}

              notify={notify}
            />
          ))}
          {page === "review" && (
            <Review notify={notify} initialSession={reviewSession} />
          )}{" "}
          {page === "curves" && (
            <ForgettingCurves onOpen={open} notify={notify} />
          )}
          {page === "graph" && (
            <Graph
              onOpen={open}
              onCreate={() => {
                setCaptureText("");
                setCaptureImage("");
                setCaptureSource("manual-capture");
                setCapture(true);
              }}
            />
          )}{" "}
          {page === "agent" && (
            <Agent
              key={chatEntry}
              entryId={chatEntry}
              initialTopic={chatTopic}
              quote={chatQuote}
              onOpenEntry={open}
              notify={notify}
            />
          )}{" "}
          {page === "settings" && (
            <Settings
              key={settingsTab}
              initialTab={settingsTab}
              notify={notify}
            />
          )}
          {page === "tasks" && (
            <AITaskCenter onOpen={openJob} notify={notify} />
          )}
        </Suspense>
      </main>
      {entrySwitcherOpen && (
        <Suspense fallback={null}>
          <EntrySwitcher
            onClose={() => setEntrySwitcherOpen(false)}
            onChoose={open}
          />
        </Suspense>
      )}
      {commandsOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            commands={commandItems}
            onClose={() => setCommandsOpen(false)}
            onError={notify}
            onSearch={(value) => {
              setQuery(value);
              navigate("library");
            }}
          />
        </Suspense>
      )}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <KeyboardHelp
            desktop={desktopAvailable ? configuredDesktop : undefined}
            onClose={() => setShortcutsOpen(false)}
          />
        </Suspense>
      )}
      {selectedJob && (
        <Suspense fallback={null}>
          <AIJobReview
            id={selectedJob}
            onClose={() => setSelectedJob("")}
            onNavigate={destination}
            notify={notify}
          />
        </Suspense>
      )}
      {ocr?.image && (
        <OcrResult
          image={ocr.image}
          source={ocr.source}
          onClose={() => setOcr(null)}
          onUse={(text, image) => {
            setCaptureText(text);
            setCaptureSource(ocr.source);
            setCaptureImage(image);
            setOcr(null);
            setCapture(true);
          }}
        />
      )}
      {capture && (
        <Capture
          notify={notify}
          image={captureImage}
          source={captureSource}
          initial={captureText}
          onClose={() => setCapture(false)}
          onOpen={open}
        />
      )}{" "}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            className="icon"
            aria-label="Dismiss"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
