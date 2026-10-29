/** Restricted floating-editor RPC, main-window request ownership and coordinated capture shutdown. */
import { native } from "../core/database";
import {
  flushCaptureEditors,
  resumeCaptureEditors,
  type CaptureClient,
  type CaptureRequest,
} from "../core/capture-draft";
const channel = "zhinexus-capture-v1";
const desktop = native && !/Android/i.test(navigator.userAgent);
type BrowserReply = {
  channel: string;
  id: string;
  value?: unknown;
  error?: string;
};
let hostDrain: (() => Promise<void>) | undefined;
/** Invoke the main writer directly in native builds; browser previews use their specific opener, never another SQL connection. */
export const remoteCaptureClient: CaptureClient = {
  async request<T>(request: CaptureRequest): Promise<T> {
    if (desktop) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<T>("capture_request", { body: request });
    }
    if (!window.opener)
      throw Error(
        "请从主窗口打开快速记录 / Open quick capture from the main window",
      );
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", receive);
        reject(Error("Capture request timed out; input retained"));
      }, 60000);
      const receive = (event: MessageEvent<BrowserReply>) => {
        if (
          event.source !== window.opener ||
          event.origin !== location.origin ||
          event.data?.channel !== channel ||
          event.data.id !== id
        )
          return;
        clearTimeout(timer);
        window.removeEventListener("message", receive);
        if (event.data.error) reject(Error(event.data.error));
        else resolve(event.data.value as T);
      };
      window.addEventListener("message", receive);
      window.opener.postMessage({ channel, id, request }, location.origin);
    });
  },
};
/** Install a single main-webview host. The child is limited to the repository's validated capture operations. */
export async function startCaptureHost() {
  const [{ captureRepository }, { store }] = await Promise.all([
    import("./capture-repository"),
    import("../core/store"),
  ]);
  const execute = async (request: CaptureRequest) => {
    const value = await captureRepository.request(request);
    if (request.type === "open-entry") {
      if (desktop) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("show_main_window");
      } else window.focus();
    }
    return value;
  };
  const children = new Set<Window>();
  const message = (event: MessageEvent) => {
    if (
      desktop ||
      event.origin !== location.origin ||
      !event.source ||
      event.source === window ||
      event.data?.channel !== channel ||
      typeof event.data.id !== "string" ||
      !event.data.request
    )
      return;
    const child = event.source as Window;
    children.add(child);
    void execute(event.data.request)
      .then((value) =>
        child.postMessage(
          { channel, id: event.data.id, value },
          location.origin,
        ),
      )
      .catch((error) =>
        child.postMessage(
          {
            channel,
            id: event.data.id,
            error: String(error instanceof Error ? error.message : error),
          },
          location.origin,
        ),
      );
  };
  if (!desktop) window.addEventListener("message", message);
  let stop = () => {};
  if (desktop) {
    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);
    let activeDrain: Promise<void> = Promise.resolve();
    let running = false,
      pending = false,
      closed = false;
    const drain = async () => {
      pending = true;
      if (running) {
        await activeDrain;
        return;
      }
      running = true;
      const task = (async () => {
        try {
          while (pending && !closed) {
            pending = false;
            const requests = await invoke<
              { id: string; body: CaptureRequest }[]
            >("take_capture_requests");
            for (const request of requests) {
              try {
                const value = await execute(request.body);
                await invoke("complete_capture_request", {
                  id: request.id,
                  value: value ?? null,
                  error: null,
                });
              } catch (error) {
                await invoke("complete_capture_request", {
                  id: request.id,
                  value: null,
                  error: String(error instanceof Error ? error.message : error),
                });
              }
            }
          }
        } finally {
          running = false;
        }
      })();
      activeDrain = task;
      await task;
    };
    hostDrain = drain;
    const off = await listen("capture:requests", () => void drain());
    await drain();
    stop = () => {
      closed = true;
      off();
      if (hostDrain === drain) hostDrain = undefined;
    };
  }
  const unsubscribe = store.subscribe(() => {
    if (desktop)
      void import("@tauri-apps/api/event")
        .then(({ emitTo }) => emitTo("quick-capture", "capture:context", null))
        .catch(() => {});
    else
      for (const child of children) {
        if (child.closed) children.delete(child);
        else child.postMessage({ channel, type: "context" }, location.origin);
      }
  });
  return () => {
    stop();
    unsubscribe();
    window.removeEventListener("message", message);
  };
}
/** Flush all capture surfaces before SQLite is suspended; normal opening does not freeze input. */
export async function flushCaptureWindows(freeze = false) {
  await flushCaptureEditors(freeze);
  if (desktop) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("flush_capture_window", { freeze });
  }
  await hostDrain?.();
  const { captureRepository } = await import("./capture-repository");
  await captureRepository.flush();
}
/** Release frozen capture controls after another shutdown step fails. */
export async function resumeCaptureWindows() {
  maintenance = false;
  resumeCaptureEditors();
  if (desktop) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("resume_capture_window");
  }
}
let transitionTail: Promise<unknown> = Promise.resolve();
let maintenance = false;
function transition<T>(work: () => Promise<T>) {
  const task = transitionTail.then(work);
  transitionTail = task.catch(() => {});
  return task;
}
/** Freeze capture ownership before the database enters a shutdown or migration transaction. */
export function prepareCaptureShutdown() {
  return transition(async () => {
    maintenance = true;
    await flushCaptureWindows(true);
  });
}
/** Preserve the old draft, append an explicitly captured selection and raise the dedicated floating window. */
export function showQuickCapture(
  seed?: { text: string; source: string },
  prepared?: () => void,
) {
  return transition(async () => {
    if (maintenance)
      throw Error(
        "正在退出或迁移，请稍后重试 / Capture unavailable during shutdown or migration",
      );
    try {
      await flushCaptureWindows(true);
      prepared?.();
      const { captureRepository } = await import("./capture-repository");
      await captureRepository.request({ type: "load", seed });
      await resumeCaptureWindows();
      if (desktop) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("open_quick_capture");
      } else
        window.open(
          "/?quick-capture=1",
          "zhinexus-quick-capture",
          "popup=yes,width=560,height=640,resizable=yes",
        );
    } catch (error) {
      await resumeCaptureWindows();
      throw error;
    }
  });
}
/** Transfer the acknowledged draft back to the in-app editor before revealing another editable surface. */
export function prepareInAppCapture() {
  if (!desktop) return Promise.resolve();
  return transition(async () => {
    if (maintenance)
      throw Error(
        "正在退出或迁移，请稍后重试 / Capture unavailable during shutdown or migration",
      );
    try {
      await flushCaptureWindows(true);
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("hide_quick_capture");
    } finally {
      await resumeCaptureWindows();
    }
  });
}
