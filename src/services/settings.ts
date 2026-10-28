/** Global settings autosave and native side effects, shared by every settings panel and app shutdown. */
import { invoke } from "@tauri-apps/api/core";
import { native } from "../core/database";
import { AutoSave, mergeEdits } from "../core/auto-save";
import { store } from "../core/store";
import type { AIConfig, DeviceConfig, Json } from "../core/types";
import { apiBaseUrl, normalizeApiKey, secureUrl, serviceUrl } from "./network";
import { normalizeProxy, ensureNativeProxy } from "./proxy";
import { flushKeySync, saveAIAndKey } from "./key-sync";
import { enableNotifications } from "./device";
import { reviewTarget } from "../core/review-policy";
import { diagnostics } from "./diagnostics";
import { defaultNotifications } from "./notifications";

/** Working provider and device preferences; file-backup passphrases are not preferences. */
export interface SettingsDraft {
  ai: AIConfig;
  device: DeviceConfig;
  appearance: Record<string, Json>;
  review: { retention: number };
}
const source = (): SettingsDraft => {
  const s = store.getSnapshot();
  return {
    ai: s.ai,
    device: s.device,
    review: { retention: reviewTarget(s.docs) },
    appearance:
      s.docs.find((d) => d.collection === "setting" && d.id === "appearance")
        ?.fields ?? {},
  };
};
const changed = (a: unknown, b: unknown) =>
  JSON.stringify(a) !== JSON.stringify(b);

/** Save independent groups so an invalid proxy or WebDAV draft cannot discard valid model/notification edits. */
async function save(next: SettingsDraft, base: SettingsDraft) {
  const current = source(),
    value = mergeEdits(current, base, next);
  const errors: string[] = [];
  const attempt = async (label: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      errors.push(
        label + ": " + (error instanceof Error ? error.message : String(error)),
      );
    }
  };
  if (changed(value.appearance, current.appearance))
    await attempt("Appearance", () =>
      store.patch("setting", "appearance", value.appearance),
    );
  if (changed(value.review, current.review))
    await attempt("Review policy", async () => {
      if (
        !Number.isFinite(value.review.retention) ||
        value.review.retention < 0.5 ||
        value.review.retention > 0.99
      )
        throw Error("期望保留率须为 50–99% / Desired retention must be 50–99%");
      await store.patch("setting", "review-policy", value.review);
    });
  const aiChanged = changed(value.ai, current.ai);
  const keyChanged =
    changed(value.device.apiKey, current.device.apiKey) ||
    changed(value.device.apiKeySyncKey, current.device.apiKeySyncKey);
  if (aiChanged || keyChanged)
    await attempt("AI", async () => {
      apiBaseUrl(value.ai.baseUrl);
      normalizeApiKey(value.device.apiKey);
      if (keyChanged || changed(value.ai.baseUrl, current.ai.baseUrl))
        await saveAIAndKey(
          value.ai,
          value.device.apiKey,
          value.device.apiKeySyncKey ?? "",
          changed(value.device.apiKey, current.device.apiKey) &&
            !normalizeApiKey(value.device.apiKey),
        );
      else await store.saveAI(value.ai);
    });
  const patch = Object.fromEntries(
    Object.entries(value.device).filter(([key, v]) =>
      changed(v, current.device[key as keyof DeviceConfig]),
    ),
  ) as Partial<DeviceConfig>;
  const group = (keys: (keyof DeviceConfig)[]) =>
    Object.fromEntries(
      keys.filter((key) => key in patch).map((key) => [key, patch[key]]),
    ) as Partial<DeviceConfig>;
  if ("autoUpdate" in patch)
    await attempt("Automatic updates", async () => {
      if (typeof patch.autoUpdate !== "boolean")
        throw Error("Invalid automatic update preference");
      await store.updateDevice({ autoUpdate: patch.autoUpdate });
    });
  const dav = group(["davUrl", "davUser", "davPassword", "syncMinutes"]);
  if ("aiConcurrency" in patch)
    await attempt("AI concurrency", async () => {
      const value = patch.aiConcurrency;
      if (!Number.isInteger(value) || value! < 1 || value! > 16)
        throw Error("AI 并发上限必须为 1–16 / AI concurrency must be 1–16");
      await store.updateDevice({ aiConcurrency: value });
    });
  if (Object.keys(dav).length)
    await attempt("WebDAV", async () => {
      if (value.device.davUrl) secureUrl(value.device.davUrl);
      await store.updateDevice({
        ...dav,
        ...(current.device.davUrl !== value.device.davUrl
          ? { lastSync: "" }
          : {}),
      });
    });
  if (patch.proxy)
    await attempt("Proxy", async () => {
      const proxy = normalizeProxy(patch.proxy!);
      if (!native && proxy.mode !== "system")
        throw Error(
          "自定义代理需要原生客户端 / Custom proxies require the native app",
        );
      await ensureNativeProxy(proxy);
      await store.updateDevice({ proxy });
    });
  if (patch.desktop)
    await attempt("Desktop", async () => {
      if (native && !/Android/i.test(navigator.userAgent))
        await invoke("configure_desktop", { settings: patch.desktop });
      await store.updateDevice({ desktop: patch.desktop });
    });
  if (patch.mcp)
    await attempt("MCP", async () => {
      for (const m of patch.mcp!.filter((m) => m.enabled)) {
        if (m.transport === "stdio") {
          if (!m.command?.trim())
            throw Error("请填写 MCP 可执行程序 / Enter an MCP executable");
        } else serviceUrl(m.url);
      }
      await store.updateDevice({ mcp: patch.mcp });
    });
  const notifications = group(["notifications", "notificationOptions"]);
  if (Object.keys(notifications).length)
    await attempt("Notifications", async () => {
      const before = {
        ...defaultNotifications,
        ...current.device.notificationOptions,
      };
      if (
        patch.notifications === true ||
        (patch.notificationOptions &&
          ["aiWhenUnfocused", "ocrWhenUnfocused", "syncFailures"].some(
            (key) =>
              (patch.notificationOptions as unknown as Record<string, unknown>)[
                key
              ] === true &&
              !(before as unknown as Record<string, unknown>)[key],
          ))
      ) {
        if (!(await enableNotifications()))
          throw Error(
            "未获得系统通知权限 / Notification permission was not granted",
          );
      }
      await store.updateDevice(notifications);
    });
  await attempt("Credential sync", flushKeySync);
  if (errors.length) throw Error(errors.join("\n"));
}
let editor: AutoSave<SettingsDraft> | undefined;
/** Get the one editor, retained across settings tabs and route changes, with live remote updates. */
export function settingsEditor() {
  if (!editor) {
    editor = new AutoSave(source, save, (error) =>
      diagnostics.error(
        "settings",
        "配置自动保存失败 / Settings autosave failed",
        error,
      ),
    );
    store.subscribe(editor.receive);
  }
  return editor;
}
/** Complete pending settings before performing an action, exiting or relocating storage. */
export async function flushSettings() {
  await editor?.flush();
  await flushKeySync();
}

/** AI uses valid saved provider settings even when an unrelated settings group still has an invalid draft. */
export async function flushAISettings() {
  try {
    await flushSettings();
  } catch (error) {
    const draft = editor?.getSnapshot().value,
      current = source();
    if (!draft) throw error;
    try {
      const ai = { ...draft.ai, baseUrl: apiBaseUrl(draft.ai.baseUrl) };
      if (
        changed(ai, current.ai) ||
        normalizeApiKey(draft.device.apiKey) !== current.device.apiKey ||
        changed(
          draft.device.apiKeySyncKey ?? "",
          current.device.apiKeySyncKey ?? "",
        )
      )
        throw error;
    } catch {
      throw error;
    }
  }
}
