/** Native desktop event ownership, live DPI observation and safe storage handoff. */
import { flushSettings } from "./settings";
import { diagnostics } from "./diagnostics";
import { invoke } from "@tauri-apps/api/core";
import { autoUpdates } from "./auto-updates";
import { applyUpdate, type UpdateInfo } from "./updates";
import { native } from "../core/database";
import { store } from "../core/store";
import { prepareCaptureShutdown, resumeCaptureWindows } from "./quick-capture";
import { entryWorkspace } from "../core/workspace";
import type { DesktopPreferences } from "../core/types";
export const desktopAvailable = native && !/Android/i.test(navigator.userAgent);
export const defaultDesktop: DesktopPreferences = {
  background: true,
  autostart: false,
  captureShortcut: "CommandOrControl+Shift+N",
  ocrShortcut: "CommandOrControl+Shift+O",
  showShortcut: "CommandOrControl+Shift+Space",
};
/** Pending payloads survive the gap between native hotkey callbacks and webview listener setup. */
export interface DesktopAction {
  kind: "capture" | "quick-capture" | "ocr" | "quit" | "error";
  text: string;
  source: string;
  image?: string;
}
/** Observe actual OS scale without multiplying WebView CSS by devicePixelRatio a second time. */
export async function observeSystemScale() {
  if (!desktopAvailable) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  const apply = (scale: number) => {
    document.documentElement.dataset.systemScale = String(scale);
    document.documentElement.style.setProperty("--system-dpi", String(scale));
  };
  apply(await window.scaleFactor());
  return window.onScaleChanged((event) => apply(event.payload.scaleFactor));
}
/** Register wakeups before draining the native queue; each action is delivered once to the main workspace. */
export async function listenDesktop(open: (action: DesktopAction) => void) {
  if (!desktopAvailable) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  let running = false,
    pending = false,
    closed = false;
  const drain = async () => {
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending && !closed) {
        pending = false;
        for (const action of await invoke<DesktopAction[]>(
          "take_desktop_actions",
        ))
          open(action);
      }
    } finally {
      running = false;
    }
  };
  const unlisten = await listen("desktop:pending", () => void drain());
  await drain();
  return () => {
    closed = true;
    unlisten();
  };
}
/** User-requested quit respects unsaved entry changes, then releases SQLite before terminating the app. */
let quitting = false;
export async function quitDesktop(update?: UpdateInfo) {
  if (quitting) return;
  if (
    !window.dispatchEvent(new Event("zhinexus:navigate", { cancelable: true }))
  )
    return;
  quitting = true;
  try {
    await flushSettings();
    await prepareCaptureShutdown();
    await (await import("./ai-jobs")).stopAIJobsForShutdown();
    await diagnostics.flush().catch(() => {});
    await entryWorkspace.init();
    await entryWorkspace.flush();
    await store.suspend();
    const automatic = store.getSnapshot().device.autoUpdate !== false;
    const ready = autoUpdates.getSnapshot();
    if (
      ready.phase === "ready" &&
      ready.update &&
      (update || automatic) &&
      ready.update.kind === "portable"
    ) {
      try {
        await autoUpdates.install((info) =>
          applyUpdate(info, { restart: !!update }),
        );
      } catch (error) {
        if (update) throw error;
      }
    }
    await invoke("quit_desktop");
  } catch (error) {
    await store.resume();
    await resumeCaptureWindows();
    throw error;
  } finally {
    quitting = false;
  }
}
/** A constrained native preview describes source/target paths and any retained previous target. */
export interface MigrationPlan {
  id: string;
  source: string;
  target: string;
  portable: boolean;
  bytes: number;
  files: number;
  targetExists: boolean;
}
/** Freeze local writes only after the user reviews the plan; helper failure restores the original connection. */
export async function migrateStorage(plan: MigrationPlan) {
  await flushSettings();
  await diagnostics.flush().catch(() => {});
  if (
    !window.dispatchEvent(new Event("zhinexus:navigate", { cancelable: true }))
  )
    return;
  try {
    await prepareCaptureShutdown();
    await (await import("./ai-jobs")).stopAIJobsForShutdown();
    await entryWorkspace.init();
    await entryWorkspace.flush();
    await store.suspend();
    await invoke("launch_storage_migration", { id: plan.id });
  } catch (error) {
    await store.resume();
    await resumeCaptureWindows();
    throw error;
  }
}
