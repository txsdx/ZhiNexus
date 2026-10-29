/** Startup/online update scheduling and durable native staging; foreground editing never owns the updater task. */
import { z } from "zod";
import { native } from "../core/database";
import { store } from "../core/store";
import { diagnostics } from "./diagnostics";
import { UpdateController } from "./update-controller";
import {
  checkUpdates,
  prepareUpdate,
  applyUpdate,
  isNewer,
  validateReleaseAsset,
  type UpdateInfo,
} from "./updates";
const cachedInfo = z.object({
  platform: z.string(),
  current: z.string(),
  version: z.string(),
  notes: z.string(),
  kind: z.enum(["portable", "apk", "deb"]),
  url: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().optional(),
  available: z.boolean(),
});
/** Restore only a newer update for this binary's exact platform and supported artifact format. Native bytes are reverified next. */
async function restoreUpdate(): Promise<UpdateInfo | null> {
  if (!native) return null;
  const saved = cachedInfo.safeParse(
    await store.db.local("pending-platform-update", null),
  );
  if (!saved.success) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const identity = await invoke<{
    platform: string;
    version: string;
    portable: boolean;
  }>("update_identity");
  const expected =
    identity.platform === "windows-x86_64"
      ? "portable"
      : identity.platform === "android-arm64"
        ? "apk"
        : "deb";
  if (
    saved.data.platform !== identity.platform ||
    saved.data.kind !== expected ||
    !isNewer(saved.data.version, identity.version)
  ) {
    await store.db.setLocal("pending-platform-update", null);
    return null;
  }
  validateReleaseAsset(saved.data.url);
  return { ...saved.data, current: identity.version, available: true };
}
/** Application-wide controller shared by automatic checks, the global ready button and About. */
export const autoUpdates = new UpdateController({
  check: checkUpdates,
  prepare: prepareUpdate,
  restore: restoreUpdate,
  remember: (info) => store.db.setLocal("pending-platform-update", info),
  failed: (error) =>
    diagnostics.error("app", "自动更新未完成 / Update incomplete", error),
});
let running = false;
/** Check shortly after startup and every six hours; online recovery retries with bounded backoff and no startup toast. */
export function startAutomaticUpdates() {
  if (!native || running) return () => {};
  running = true;
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    failures = 0;
  let enabled = store.getSnapshot().device.autoUpdate !== false;
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped && enabled) timer = setTimeout(() => void attempt(), delay);
  };
  const attempt = async () => {
    if (stopped || !enabled) return;
    if (navigator.onLine === false) {
      schedule(60000);
      return;
    }
    try {
      await autoUpdates.check();
      failures = 0;
    } catch {
      failures++;
    }
    schedule(
      failures
        ? Math.min(60 * 60 * 1000, 60000 * 2 ** Math.min(failures - 1, 6))
        : 6 * 60 * 60 * 1000,
    );
  };
  const online = () => schedule(1000);
  window.addEventListener("online", online);
  const unsubscribe = store.subscribe(() => {
    const next = store.getSnapshot().device.autoUpdate !== false;
    if (next !== enabled) {
      enabled = next;
      failures = 0;
      schedule(1000);
    }
  });
  schedule(3000);
  return () => {
    stopped = true;
    running = false;
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("online", online);
  };
}
/** Launch OS installation explicitly; Windows uses the same durable shutdown path as a normal exit. */
export async function installReadyUpdate() {
  const info = autoUpdates.getSnapshot().update;
  if (!info || autoUpdates.getSnapshot().phase !== "ready") return;
  if (info.kind === "portable") {
    await (await import("./desktop")).quitDesktop(info);
  } else {
    await autoUpdates.install(async (update) => {
      await (await import("./settings")).flushSettings();
      const { entryWorkspace } = await import("../core/workspace");
      await entryWorkspace.init();
      await entryWorkspace.flush();
      await (await import("./ai-jobs")).flushAIJobs();
      await store.db.checkpoint();
      await applyUpdate(update);
    });
  }
}
