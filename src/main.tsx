/** Bootstrap persistent storage before mounting the learning workspace. */
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startAutomaticUpdates } from "./services/auto-updates";
import { OcrOverlay } from "./components/OcrOverlay";
import { startKeySync } from "./services/key-sync";
import { store } from "./core/store";
import "./styles.css";
import { diagnostics, initDiagnostics } from "./services/diagnostics";
import { flushSettings } from "./services/settings";
import { initAIJobs, flushAIJobs } from "./services/ai-jobs";
/** Keep storage and rendering failures visible without clearing user data. */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  componentDidCatch(error: Error) {
    diagnostics.error("app", "界面渲染错误 / Render failure", error);
  }
  render() {
    return this.state.error ? (
      <div className="boot-error">
        <h1>知枢 · ZhiNexus</h1>
        <p>
          发生错误，数据未被清除。请重新加载。 / An error occurred. Your data
          has not been cleared.
        </p>
        <pre>{this.state.error}</pre>
        <button onClick={() => location.reload()}>重新加载 / Reload</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <div className="boot-error">知枢 · ZhiNexus · 正在打开本地知识库…</div>,
);
if (new URLSearchParams(location.search).has("quick-capture")) {
  document.documentElement.dataset.window = "quick-capture";
  void import("./components/QuickCapture").then(({ QuickCapture }) =>
    root.render(
      <ErrorBoundary>
        <QuickCapture />
      </ErrorBoundary>,
    ),
  );
} else if (new URLSearchParams(location.search).has("ocr-overlay")) {
  root.render(
    <ErrorBoundary>
      <OcrOverlay />
    </ErrorBoundary>,
  );
} else
  store
    .init()
    .then(async () => {
      performance.mark("zhinexus:storage-ready");
      window.addEventListener("error", (event) =>
        diagnostics.error(
          "app",
          "运行错误 / Runtime error",
          event.error ?? event.message,
        ),
      );
      window.addEventListener("unhandledrejection", (event) =>
        diagnostics.error(
          "app",
          "未处理错误 / Unhandled rejection",
          event.reason,
        ),
      );
      const flush = () => {
        void flushSettings().catch(() => {});
        void diagnostics.flush().catch(() => {});
        void flushAIJobs().catch(() => {});
      };
      window.addEventListener("blur", flush);
      window.addEventListener("pagehide", flush);

      root.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          performance.mark("zhinexus:first-frame");
          void (async () => {
            await initDiagnostics().catch((error) => {
              diagnostics.storageError = String(error);
              diagnostics.error(
                "app",
                "日志加载失败 / Log initialization failed",
                error,
              );
            });

            await initAIJobs();
            performance.mark("zhinexus:ai-ready");
            startKeySync();
            startAutomaticUpdates();
            await store.db.checkpoint();
            const id = diagnostics.start({
              kind: "app",
              message: "启动阶段耗时 / Startup timings",
            });
            diagnostics.update(id, {
              level: "info",
              durationMs: performance.getEntriesByName(
                "zhinexus:first-frame",
              )[0]?.startTime,
              response: JSON.stringify(
                Object.fromEntries(
                  performance
                    .getEntriesByType("mark")
                    .filter((m) => m.name.startsWith("zhinexus:"))
                    .map((m) => [m.name, Math.round(m.startTime)]),
                ),
              ),
            });
          })().catch((error) =>
            diagnostics.error(
              "app",
              "后台启动任务失败 / Background startup failed",
              error,
            ),
          );
        }),
      );
    })
    .catch((e) =>
      root.render(
        <div className="boot-error">
          <h1>无法打开本地数据库 / Storage unavailable</h1>
          <p>请检查浏览器存储权限与可用空间。不会自动清除任何数据。</p>
          <pre>{String(e)}</pre>
          <button onClick={() => location.reload()}>重试 / Retry</button>
        </div>,
      ),
    );
