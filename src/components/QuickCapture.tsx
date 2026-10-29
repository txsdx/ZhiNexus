/** Small capture-only webview: opaque, resizable and independent of the main window's database and background services. */
import { useEffect, useRef, useState } from "react";
import { Pin, X } from "lucide-react";
import { CaptureEditor, type CaptureHandle } from "./Capture";
import { Locale } from "./common";
import { ContextMenu } from "./ContextMenu";
import { useAppearance } from "../hooks/useAppearance";
import { remoteCaptureClient } from "../services/quick-capture";
import {
  flushCaptureEditors,
  resumeCaptureEditors,
  type CaptureContext,
} from "../core/capture-draft";
import { native } from "../core/database";
/** Render only the capture form; this branch never calls store.init, starts synchronization or owns AI tasks. */
export function QuickCapture() {
  const pinBusy = useRef(false),
    editor = useRef<CaptureHandle>(null),
    [context, setContext] = useState<CaptureContext>({
      categories: [],
      appearance: {},
    }),
    [ready, setReady] = useState(!native),
    [pinned, setPinned] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const locale = useAppearance(context.appearance),
    t = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const refresh = async () => {
    setContext(
      await remoteCaptureClient.request<CaptureContext>({ type: "context" }),
    );
    setError("");
    setReady(true);
  };
  const hide = async () => {
    if (native) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } else window.close();
  };
  useEffect(() => {
    let active = true;
    const cleanup: (() => void)[] = [];
    document.documentElement.dataset.window = "quick-capture";
    void (async () => {
      if (native) {
        const [{ listen }, { invoke }] = await Promise.all([
          import("@tauri-apps/api/event"),
          import("@tauri-apps/api/core"),
        ]);
        cleanup.push(
          await listen(
            "capture:close",
            () =>
              void (editor.current ? editor.current.close() : hide()).catch(
                (error) => setError(String(error)),
              ),
          ),
        );
        cleanup.push(
          await listen(
            "capture:opened",
            () =>
              void Promise.all([refresh(), editor.current?.refresh()]).catch(
                (error) => setError(String(error)),
              ),
          ),
        );
        cleanup.push(
          await listen(
            "capture:context",
            () => void refresh().catch((error) => setError(String(error))),
          ),
        );
        cleanup.push(
          await listen("capture:resume", () => resumeCaptureEditors()),
        );
        cleanup.push(
          await listen<{ id: string; freeze: boolean }>(
            "capture:flush",
            (event) => {
              void flushCaptureEditors(event.payload.freeze)
                .then(() =>
                  invoke("complete_capture_flush", {
                    id: event.payload.id,
                    error: null,
                  }),
                )
                .catch((error) =>
                  invoke("complete_capture_flush", {
                    id: event.payload.id,
                    error: String(
                      error instanceof Error ? error.message : error,
                    ),
                  }),
                );
            },
          ),
        );
        if (!active) {
          cleanup.forEach((stop) => stop());
          return;
        }
        await invoke("capture_window_ready", { ready: true });
      } else {
        const update = (event: MessageEvent) => {
          if (
            event.origin === location.origin &&
            event.source === window.opener &&
            event.data?.channel === "zhinexus-capture-v1" &&
            event.data.type === "context"
          )
            void refresh().catch((error) => setError(String(error)));
        };
        window.addEventListener("message", update);
        cleanup.push(() => window.removeEventListener("message", update));
      }
      await refresh();
      if (active) setReady(true);
    })().catch((error) => {
      if (active)
        setError(String(error instanceof Error ? error.message : error));
    });
    return () => {
      active = false;
      cleanup.forEach((stop) => stop());
      if (native)
        void import("@tauri-apps/api/core")
          .then(({ invoke }) =>
            invoke("capture_window_ready", { ready: false }),
          )
          .catch(() => {});
    };
  }, []);
  return (
    <Locale value={locale}>
      <div className="quick-capture-window">
        <header className="quick-capture-tools">
          <h1>{t("记录新知识", "Capture knowledge")}</h1>
          <div className="actions">
            {native && (
              <button
                className={pinned ? "active" : ""}
                aria-pressed={pinned}
                onClick={() => {
                  if (pinBusy.current) return;
                  pinBusy.current = true;
                  void import("@tauri-apps/api/core")
                    .then(({ invoke }) =>
                      invoke("set_capture_topmost", { topmost: !pinned }),
                    )
                    .then(() => setPinned(!pinned))
                    .catch((error) => setError(String(error)))
                    .finally(() => {
                      pinBusy.current = false;
                    });
                }}
              >
                <Pin size={16} />
                {t("置顶", "Pin")}
              </button>
            )}
            {!native && (
              <button
                className="icon"
                aria-label={t("关闭快速记录", "Close quick capture")}
                onClick={() =>
                  void editor.current
                    ?.close()
                    .catch((error) => setError(String(error)))
                }
              >
                <X size={16} />
              </button>
            )}
          </div>
        </header>
        {error && (
          <div role="alert">
            <p>{error}</p>
            {!ready && (
              <button
                onClick={() =>
                  void refresh().catch((error) => setError(String(error)))
                }
              >
                {t("重试", "Retry")}
              </button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="capture-notice">
            {notice}
          </p>
        )}
        {ready ? (
          <CaptureEditor
            ref={editor}
            client={remoteCaptureClient}
            context={context}
            onClose={hide}
            onOpen={async (id) => {
              await remoteCaptureClient.request({ type: "open-entry", id });
              await hide();
            }}
            onSaved={async (result) => {
              setNotice(
                result.warning ||
                  t(
                    result.created
                      ? "已保存到知识库"
                      : "已找到同名条目，原草稿继续保留",
                    result.created
                      ? "Saved to knowledge library"
                      : "Existing entry found; draft retained",
                  ),
              );
              if (!result.created) {
                await remoteCaptureClient.request({
                  type: "open-entry",
                  id: result.id,
                });
                await hide();
              }
            }}
          />
        ) : (
          !error && <p>{t("正在恢复草稿…", "Restoring draft…")}</p>
        )}
        <ContextMenu notify={setNotice} />
      </div>
    </Locale>
  );
}
