/** Application shell, responsive navigation, capture flow and per-device background services. */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Brain,
  ChevronRight,
  Cloud,
  Command,
  GitBranch,
  Home,
  LibraryBig,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import Fuse from "fuse.js";
import { enrichEntry } from "./services/enrichment";
import { registerCapture } from "./services/capture";
import { Locale, useKnowledge, useT, Modal } from "./components/common";
import { Library } from "./pages/Library";
const EntryPage = lazy(() =>
  import("./pages/Entry").then((m) => ({ default: m.EntryPage })),
);
const Review = lazy(() =>
  import("./pages/Review").then((m) => ({ default: m.Review })),
);
const Agent = lazy(() =>
  import("./pages/Agent").then((m) => ({ default: m.Agent })),
);
const Graph = lazy(() =>
  import("./pages/Graph").then((m) => ({ default: m.Graph })),
);
const Settings = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Settings })),
);
import { store } from "./core/store";
import { synchronize } from "./services/sync";
import { remind } from "./services/device";
/** Collect new concepts while treating fuzzy duplicates as a request to revisit existing knowledge. */
function Capture({
  onClose,
  onOpen,
  initial = "",
  notify,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  initial?: string;
  notify: (text: string) => void;
}) {
  const s = useKnowledge(),
    t = useT(),
    [title, setTitle] = useState(initial.split(/\r?\n/)[0].slice(0, 120)),
    [content, setContent] = useState(initial.length > 120 ? initial : ""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const matches = title.trim()
    ? new Fuse(s.entries, { keys: ["title"], threshold: 0.35 })
        .search(title)
        .slice(0, 5)
    : [];
  return (
    <Modal
      title={t("捕捉一个新的概念", "Capture a new concept")}
      onClose={onClose}
    >
      <p className="muted">
        {t(
          "先记下来，理解可以慢慢生长。相似词条会自动出现在下方。",
          "Capture it now. Understanding can grow later. Similar entries appear below.",
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          const exact = s.entries.find(
            (e) =>
              e.title.toLocaleLowerCase() === title.trim().toLocaleLowerCase(),
          );
          const action = exact
            ? Promise.resolve(exact.id)
            : store.createEntry(
                title,
                content || undefined,
                initial
                  ? "shortcut:clipboard-source-unknown"
                  : "manual-capture",
              );
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
                          "已执行已配置的自动整理任务",
                          "Configured enrichment tasks completed",
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
            .catch((e) => setError(String(e)))
            .finally(() => setSaving(false));
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
          {t(
            "随手记下的理解或原始材料（可选）",
            "Your understanding or source material (optional)",
          )}
          <textarea
            rows={5}
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
    [entry, setEntry] = useState(""),
    [chatEntry, setChatEntry] = useState(""),
    [query, setQuery] = useState(""),
    [capture, setCapture] = useState(false),
    [captureText, setCaptureText] = useState(""),
    [toast, setToast] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const navigate = (next: string) => {
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
    void registerCapture((text) => {
      setCaptureText(text);
      setCapture(true);
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
  const notify = (text: string) => setToast(text);
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
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "n"
      ) {
        e.preventDefault();
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
  useEffect(() => {
    if (!s.ready || !s.device.davUrl || s.device.syncMinutes <= 0) return;
    const timer = setInterval(
      () => {
        void synchronize()
          .then(() => notify(t("增量同步完成", "Incremental sync complete")))
          .catch((e) => notify(String(e.message)));
      },
      Math.max(1, s.device.syncMinutes) * 60000,
    );
    return () => clearInterval(timer);
  }, [s.ready, s.device.davUrl, s.device.syncMinutes]);
  const open = (id: string) => {
    if (navigate("entry")) setEntry(id);
  };
  const nav = [
    { id: "home", name: t("学习概览", "Overview"), icon: Home },
    { id: "library", name: t("我的知识库", "Knowledge"), icon: LibraryBig },
    {
      id: "review",
      name: t("复习队列", "Review queue"),
      icon: Brain,
      badge: s.entries.filter((e) => e.card.due <= new Date()).length,
    },
    { id: "graph", name: t("知识星图", "Knowledge graph"), icon: GitBranch },
    { id: "agent", name: t("学习伙伴", "AI companion"), icon: MessageSquare },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <span className="brand-mark">知</span>
          <span>
            <strong>知枢</strong>
            <small>ZhiNexus</small>
          </span>
        </a>
        <button
          className="capture-button"
          onClick={() => {
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
              className={
                page === n.id || (page === "entry" && n.id === "library")
                  ? "active"
                  : ""
              }
              onClick={() => {
                navigate(n.id);
                if (n.id === "agent") setChatEntry("");
              }}
            >
              <n.icon size={19} />
              <span>{n.name}</span>
              {!!n.badge && <b>{n.badge}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="status-dot" />
            <div>
              <strong>
                {t("本地优先，安心记录", "Local first. Yours always.")}
              </strong>
              <small>
                {t("你的知识，由你掌握", "Your knowledge, in your hands")}
              </small>
            </div>
            <Cloud size={17} />
          </div>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={19} />
            <span>{t("设置与偏好", "Settings & preferences")}</span>
          </button>
          <div className="profile">
            <span>知</span>
            <div>
              <strong>{t("保持好奇", "Stay curious")}</strong>
              <small>
                {t("每一天，理解多一点", "A little wiser, every day")}
              </small>
            </div>
            <Sparkles size={16} />
          </div>
        </div>
      </aside>
      <main className="main">
        <Suspense
          fallback={<div className="boot-error">ZhiNexus · Loading…</div>}
        >
          <header className="topbar">
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
            <span className="topbar-status">
              <span className="status-dot" />
              {t("本地已保存", "Saved locally")}
            </span>
          </header>
          {page === "home" && (
            <Library
              dashboard
              onOpen={open}
              onCreate={() => setCapture(true)}
              onReview={() => navigate("review")}
            />
          )}{" "}
          {page === "library" && (
            <Library
              query={query}
              onOpen={open}
              onCreate={() => setCapture(true)}
              onReview={() => navigate("review")}
            />
          )}{" "}
          {page === "entry" && (
            <EntryPage
              key={entry}
              id={entry}
              onBack={() => navigate("library")}
              onOpen={open}
              onChat={(id) => {
                if (navigate("agent")) setChatEntry(id);
              }}
              notify={notify}
            />
          )}{" "}
          {page === "review" && <Review notify={notify} />}{" "}
          {page === "graph" && <Graph onOpen={open} />}{" "}
          {page === "agent" && (
            <Agent key={chatEntry} entryId={chatEntry} notify={notify} />
          )}{" "}
          {page === "settings" && <Settings notify={notify} />}
        </Suspense>
      </main>
      {capture && (
        <Capture
          notify={notify}
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
