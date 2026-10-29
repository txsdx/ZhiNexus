/** Application shell, responsive navigation, capture flow and per-device background services. */
import { needsReview, reviewTarget, nextReviewAt } from "./core/review-policy";
import { useReviewClock } from "./hooks/useReviewClock";
import { diagnostics } from "./services/diagnostics";
import {
  navigationHistory,
  startNavigationHistory,
} from "./services/navigation";
import { NavigationButtons } from "./components/NavigationButtons";
import { ContextMenu } from "./components/ContextMenu";
import { CategoryPicker } from "./components/CategoryPicker";
import { CategoryDeletionHost } from "./components/CategoryDeletion";
import { UpdateStatus } from "./components/UpdateStatus";
import { SyncStatus } from "./components/SyncStatus";
import { aiJobs } from "./services/ai-jobs";
import { useAIJobs } from "./hooks/useAIJobs";
import type { AITarget, AIJob } from "./core/ai-jobs";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BookOpen,
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
import Fuse from "fuse.js";
import { reconcileReminders } from "./services/reminders";
import { enrichEntry } from "./services/enrichment";
import { native } from "./core/database";
import {
  listenDesktop,
  observeSystemScale,
  quitDesktop,
  type DesktopAction,
} from "./services/desktop";
import { EntryTabs } from "./components/editor/EntryTabs";
import { useEntryWorkspace } from "./hooks/useEntryWorkspace";
import { OcrResult } from "./components/OcrResult";
import { unbase64 } from "./core/crypto";
import { Locale, useKnowledge, useT, Modal } from "./components/common";
import { Library } from "./pages/Library";
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
/** Collect new concepts while treating fuzzy duplicates as a request to revisit existing knowledge. */
function Capture({
  onClose,
  onOpen,
  initial = "",
  notify,
  source = "manual-capture",
  image = "",
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  initial?: string;
  image?: string;
  source?: string;
  notify: (text: string) => void;
}) {
  const s = useKnowledge(),
    t = useT(),
    [title, setTitle] = useState(initial.split(/\r?\n/)[0].slice(0, 120)),
    [content, setContent] = useState(initial),
    [category, setCategory] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    submitting = useRef(false);
  const matches = title.trim()
    ? new Fuse(s.entries, { keys: ["title"], threshold: 0.35 })
        .search(title)
        .slice(0, 5)
    : [];
  return (
    <Modal
      title={t("捕捉一个新的概念", "Capture a new concept")}
      className="capture-modal"
      onClose={onClose}
    >
      {initial && <p className="muted">{t("来源：", "Source: ") + source}</p>}
      <form
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              event.repeat)
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setSaving(true);
          const exact = s.entries.find(
            (e) =>
              e.title.toLocaleLowerCase() === title.trim().toLocaleLowerCase(),
          );
          const action = exact
            ? Promise.resolve(exact.id)
            : (async () => {
                let material = content;
                if (image) {
                  const hash = await store.db.putBlob(
                    unbase64(image.split(",")[1]),
                    "image/png",
                  );
                  material += `

![截图 / Screenshot](asset:${hash})`;
                }
                return store.createEntry(
                  title,
                  material || undefined,
                  source,
                  category,
                );
              })();
          void action
            .then((id) => {
              onClose();
              onOpen(id);
              if (!exact)
                void enrichEntry(id)
                  .then(() => {
                    if (store.getSnapshot().device.apiKey)
                      notify(
                        t(
                          "整理任务已排队，生成后请到 AI 任务队列审阅",
                          "Enrichment queued; review the result in AI tasks",
                        ),
                      );
                  })
                  .catch((e) =>
                    notify(
                      t(
                        "原始词条已保存；自动整理未完成：",
                        "Raw entry saved; enrichment incomplete: ",
                      ) + String(e.message),
                    ),
                  );
            })
            .catch((e) => {
              diagnostics.error(
                "ai",
                "词条自动整理失败 / Entry enrichment failed",
                e,
              );
              setError(String(e));
            })
            .finally(() => {
              submitting.current = false;
              setSaving(false);
            });
        }}
      >
        <label>
          {t("概念 / 知识名称", "Concept / knowledge name")}
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t(
              "例如：认知负荷、贝叶斯定理…",
              "For example: cognitive load, Bayes’ theorem…",
            )}
          />
        </label>
        {matches.length > 0 && (
          <div className="capture-matches">
            <small>
              {t(
                "你可能想复习这些概念",
                "Perhaps you want to revisit these concepts",
              )}
            </small>
            {matches.map((r) => (
              <button
                type="button"
                key={r.item.id}
                onClick={() => {
                  onClose();
                  onOpen(r.item.id);
                }}
              >
                <BookOpen size={15} />
                {r.item.title}
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        )}
        <label>
          {t("所属分类", "Category")}
          <CategoryPicker value={category} onChange={setCategory} />
        </label>
        <label>
          {t(
            "随手记下的理解或原始材料（可选）",
            "Your understanding or source material (optional)",
          )}
          <textarea
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t(
              "支持 Markdown。创建后可用 AI 生成标准解释。",
              "Markdown supported. Use AI to create a structured explanation after capture.",
            )}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary full" disabled={!title.trim() || saving}>
          <Plus size={16} />
          {t("保存到知识库", "Save to knowledge library")}
        </button>
      </form>
    </Modal>
  );
}
/** Choose locale from synced preferences while retaining automatic system detection. */
export default function App() {
  const s = useKnowledge(),
    appearance =
      s.docs.find((d) => d.collection === "setting" && d.id === "appearance")
        ?.fields ?? {};
  const language = String(appearance.language ?? "auto"),
    locale =
      language === "auto"
        ? navigator.language.toLowerCase().startsWith("zh")
          ? "zh"
          : "en"
        : language === "en"
          ? "en"
          : "zh";
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.theme = String(
      appearance.theme ?? "light",
    );
    document.documentElement.dataset.layout = String(
      appearance.layout ?? "comfortable",
    );
    document.documentElement.dataset.mobile = String(
      appearance.mobileLayout ?? "bottom",
    );
    document.documentElement.dataset.font = String(appearance.font ?? "sans");
    document.documentElement.style.setProperty(
      "--accent",
      String(appearance.accent ?? "#7562d9"),
    );
    document.documentElement.style.setProperty(
      "--scale",
      String(appearance.scale ?? 1),
    );
  }, [appearance, locale]);
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
    void listenDesktop((action) =>
      setActions((previous) => [...previous, action]),
    )
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
  useEffect(() => {
    if (capture || ocr || !actions.length) return;
    const action = actions[0];
    setActions((previous) => previous.slice(1));
    if (action.kind === "quit") {
      void quitDesktop().catch((e) => setToast(String(e)));
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
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        search.current?.focus();
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
          <kbd>⇧ N</kbd>
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
                <kbd>
                  <Command size={11} /> K
                </kbd>
              )}
            </div>
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
