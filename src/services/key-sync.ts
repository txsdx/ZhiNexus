/** Automatically replicate endpoint-bound API-key ciphertext, using a built-in key unless the user chooses a custom key. */
import { z } from "zod";
import { store } from "../core/store";
import { encryptSecret, decryptSecret } from "../core/secrets";
import { apiBaseUrl, normalizeApiKey } from "./network";
import type { AIConfig } from "../core/types";
const payload = z.object({ apiKey: z.string(), baseUrl: z.string() });
const listeners = new Set<() => void>();
let state = { status: "ready", message: "" };
let lastCipher = "";
let lastLocal = "";
let paused = false;
let pending = false;
let running: Promise<void> | null = null;
/** Observe synchronization status without putting credentials into React diagnostics. */
export const keySyncStatus = {
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot: () => state,
};
/** Publish only changed user-facing synchronization diagnostics. */
function report(status: string, message = "") {
  if (state.status === status && state.message === message) return;
  state = { status, message };
  for (const fn of listeners) fn();
}
/** Apply downloaded keys only to their authenticated endpoint; never send one server's credential to another. */
async function reconcile() {
  const s = store.getSnapshot();
  if (!s.ready || paused) return;
  const vault = s.docs.find(
    (d) => d.collection === "setting" && d.id === "ai-key-vault",
  )?.fields;
  const local = JSON.stringify([
    s.device.apiKey,
    s.device.apiKeyEndpoint ?? s.ai.baseUrl,
    s.device.apiKeySyncKey ?? "",
  ]);
  if (typeof vault?.cipher === "string" && vault.cipher !== lastCipher) {
    if (vault.keyMode === "custom" && !s.device.apiKeySyncKey) {
      report(
        "locked",
        "该设备需要相同的自定义同步密钥 / Enter the same custom synchronization key",
      );
      return;
    }
    try {
      const decoded = payload.parse(
        await decryptSecret(
          vault.cipher,
          "sync-api-key",
          vault.keyMode === "custom" ? s.device.apiKeySyncKey : "",
        ),
      );
      if (apiBaseUrl(decoded.baseUrl) !== apiBaseUrl(s.ai.baseUrl)) {
        report(
          "waiting",
          "密钥已下载，等待匹配的 AI 接口配置 / Waiting for matching AI endpoint settings",
        );
        return;
      }
      if (store.getSnapshot().device !== s.device) return;
      lastCipher = vault.cipher;
      lastLocal = JSON.stringify([
        decoded.apiKey,
        apiBaseUrl(decoded.baseUrl),
        s.device.apiKeySyncKey ?? "",
      ]);
      await store.updateDevice({
        apiKey: decoded.apiKey,
        apiKeyEndpoint: apiBaseUrl(decoded.baseUrl),
      });
      report("ready");
    } catch {
      report(
        "locked",
        "自定义同步密钥不匹配，原密钥已保留 / Synchronization key mismatch; current credentials retained",
      );
    }
    return;
  }
  if (local === lastLocal || !s.device.apiKey) return;
  if (
    s.device.apiKeyEndpoint &&
    apiBaseUrl(s.device.apiKeyEndpoint) !== apiBaseUrl(s.ai.baseUrl)
  )
    return;
  const custom = s.device.apiKeySyncKey ?? "";
  if (vault?.keyMode === "custom" && !custom) {
    report(
      "locked",
      "请填写自定义同步密钥 / Custom synchronization key required",
    );
    return;
  }
  const cipher = await encryptSecret(
    {
      apiKey: normalizeApiKey(s.device.apiKey),
      baseUrl: apiBaseUrl(s.ai.baseUrl),
    },
    "sync-api-key",
    custom,
  );
  lastLocal = local;
  lastCipher = cipher;
  await store.patch(
    "setting",
    "ai-key-vault",
    {
      cipher,
      keyMode: custom ? "custom" : "builtin",
      updatedAt: new Date().toISOString(),
    },
    "encrypted-api-key-sync",
  );
  report("ready");
}
/** Serialize local saves and remote decryptions, avoiding feedback loops and duplicate synchronization operations. */
function schedule() {
  pending = true;
  if (!running)
    running = (async () => {
      while (pending) {
        pending = false;
        await reconcile();
      }
    })()
      .catch(() =>
        report(
          "error",
          "密钥同步未完成，请重新保存配置 / Key synchronization incomplete",
        ),
      )
      .finally(() => {
        running = null;
        if (pending) schedule();
      });
}
/** Start after storage loads; no passphrase prompt is required for the built-in convenience mode. */
export function startKeySync() {
  const cleanup = store.subscribe(schedule);
  schedule();
  return cleanup;
}
/** Save AI settings and atomically prepare their encrypted key record before notifying the user. */
export async function saveAIAndKey(
  ai: AIConfig,
  apiKey: string,
  customKey: string,
) {
  const normalized = { ...ai, baseUrl: apiBaseUrl(ai.baseUrl) },
    key = normalizeApiKey(apiKey);
  const existing = store
    .getSnapshot()
    .docs.find(
      (d) => d.collection === "setting" && d.id === "ai-key-vault",
    )?.fields;
  if (
    existing?.keyMode === "custom" &&
    !customKey &&
    !store.getSnapshot().device.apiKeySyncKey
  )
    throw Error(
      "请填写自定义密钥以保留现有加密方式 / Enter the custom synchronization key",
    );
  paused = true;
  try {
    let value = key;
    if (
      (!value ||
        (value === store.getSnapshot().device.apiKey &&
          existing?.cipher !== lastCipher)) &&
      typeof existing?.cipher === "string"
    ) {
      const remote = payload.parse(
        await decryptSecret(
          existing.cipher,
          "sync-api-key",
          existing.keyMode === "custom" ? customKey : "",
        ),
      );
      if (apiBaseUrl(remote.baseUrl) !== normalized.baseUrl)
        throw Error(
          "同步密钥对应另一 AI 接口 / The synchronized key belongs to a different endpoint",
        );
      value = remote.apiKey;
    }
    await store.saveAI(normalized);
    await store.updateDevice({
      apiKey: value,
      apiKeyEndpoint: normalized.baseUrl,
      apiKeySyncKey: customKey,
    });
    if (value) {
      const cipher = await encryptSecret(
        { apiKey: value, baseUrl: normalized.baseUrl },
        "sync-api-key",
        customKey,
      );
      lastCipher = cipher;
      lastLocal = JSON.stringify([value, normalized.baseUrl, customKey]);
      await store.patch(
        "setting",
        "ai-key-vault",
        {
          cipher,
          keyMode: customKey ? "custom" : "builtin",
          updatedAt: new Date().toISOString(),
        },
        "encrypted-api-key-sync",
      );
    }
    report("ready");
  } finally {
    paused = false;
    schedule();
  }
}
