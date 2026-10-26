/** Bootstrap persistent storage before mounting the learning workspace. */
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { store } from "./core/store";
import "./styles.css";
/** Keep storage and rendering failures visible without clearing user data. */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
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
store
  .init()
  .then(() =>
    root.render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>,
    ),
  )
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
