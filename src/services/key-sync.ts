/** Automatically synchronize AI, WebDAV and MCP credentials with one optional custom key. */
import { store, type Snapshot } from "../core/store";
import { encryptSecret, decryptSecret } from "../core/secrets";
import {
  connectionsFrom,
  importedConnections,
  connectionCredentials,
  synchronizedCredentials,
} from "../core/credentials";
import { apiBaseUrl, normalizeApiKey, secureUrl, serviceUrl } from "./network";
import type { AIConfig, DeviceConfig, Json } from "../core/types";
const listeners = new Set<() => void>();
let state = { status: "ready", message: "" };
let lastCipher = "",
  lastLocal = "",
  lastConnectionsCipher = "",
  lastConnectionsLocal = "";
let paused = false,
  pending = false;
let running: Promise<void> | null = null;
/** Observe synchronization status without exposing credentials to React diagnostics. */
export const keySyncStatus = {
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot: () => state,
};
/** Publish only changed synchronization diagnostics. */
function report(status: string, message = "") {
  if (state.status === status && state.message === message) return;
  state = { status, message };
  for (const fn of listeners) fn();
}
/** Preserve the existing API-key address while adding independently merged connection ciphertext. */
function record(s = store.getSnapshot()) {
  return s.docs.find(
    (d) => d.collection === "setting" && d.id === "ai-key-vault",
  )?.fields;
}
/** Bind API credentials to their own authenticated endpoint. */
function credentials(s: Snapshot) {
  return {
    apiKey: normalizeApiKey(s.device.apiKey),
    baseUrl: apiBaseUrl(s.device.apiKeyEndpoint || s.ai.baseUrl),
  };
}
/** Compare plaintext only in memory, excluding unrelated device preferences. */
function fingerprint(s: Snapshot, connections = false) {
  return JSON.stringify([
    connections ? connectionsFrom(s.device) : credentials(s),
    s.device.apiKeySyncKey ?? "",
  ]);
}
/** Do not publish blank connection settings before a new device downloads existing credentials. */
function hasConnections(s: Snapshot) {
  const d = s.device;
  return Boolean(d.davUrl || d.davUser || d.davPassword || d.mcp.length);
}
/** Authenticate the original API-key payload before any device mutation. */
async function decodeAPI(fields: Record<string, Json>, customKey: string) {
  const value = synchronizedCredentials.parse(
    await decryptSecret(
      fields.cipher as string,
      "sync-api-key",
      fields.keyMode === "custom" ? customKey : "",
    ),
  );
  apiBaseUrl(value.baseUrl);
  return value;
}
/** Authenticate connection settings and validate active remote endpoints before applying them. */
async function decodeConnections(
  fields: Record<string, Json>,
  customKey: string,
) {
  const value = connectionCredentials.parse(
    await decryptSecret(
      fields.connectionsCipher as string,
      "sync-connections",
      fields.connectionsKeyMode === "custom" ? customKey : "",
    ),
  );
  if (value.davUrl) secureUrl(value.davUrl);
  for (const m of value.mcp)
    if (m.enabled && m.transport !== "stdio") serviceUrl(m.url);
  return value;
}
/** Commit ciphertext before advancing deduplication markers; never replace a newer in-flight edit. */
async function publish(s: Snapshot, api: boolean, connections: boolean) {
  if (!api && !connections) return;
  const custom = s.device.apiKeySyncKey ?? "";
  const patch: Record<string, Json> = {
    updatedAt: new Date().toISOString(),
  };
  if (api) {
    patch.keyMode = custom ? "custom" : "builtin";
    patch.cipher = await encryptSecret(credentials(s), "sync-api-key", custom);
  }
  if (connections) {
    patch.connectionsKeyMode = custom ? "custom" : "builtin";
    patch.connectionsCipher = await encryptSecret(
      connectionsFrom(s.device),
      "sync-connections",
      custom,
    );
  }
  const current = store.getSnapshot();
  if (
    fingerprint(current) !== fingerprint(s) ||
    fingerprint(current, true) !== fingerprint(s, true) ||
    record(current) !== record(s)
  ) {
    pending = true;
    return;
  }
  await store.patch(
    "setting",
    "ai-key-vault",
    patch,
    "encrypted-credential-sync",
  );
  if (api) {
    lastCipher = patch.cipher as string;
    lastLocal = fingerprint(s);
  }
  if (connections) {
    lastConnectionsCipher = patch.connectionsCipher as string;
    lastConnectionsLocal = fingerprint(s, true);
  }
  if (
    s.device.credentialSyncPending?.api ||
    s.device.credentialSyncPending?.connections
  )
    await store.updateDevice(
      (current) => ({
        credentialSyncPending: {
          api:
            !!current.credentialSyncPending?.api &&
            !(api && fingerprint({ ...s, device: current }) === fingerprint(s)),
          connections:
            !!current.credentialSyncPending?.connections &&
            !(
              connections &&
              fingerprint({ ...s, device: current }, true) ===
                fingerprint(s, true)
            ),
        },
      }),
      true,
    );
}
/** Merge encrypted credential groups independently so first-time WebDAV setup cannot clear a remote API key. */
async function reconcile() {
  const s = store.getSnapshot();
  if (!s.ready || paused) return;
  const shared = record(s);
  const newAPI =
    typeof shared?.cipher === "string" && shared.cipher !== lastCipher;
  const newConnections =
    typeof shared?.connectionsCipher === "string" &&
    shared.connectionsCipher !== lastConnectionsCipher;
  if (
    !s.device.apiKeySyncKey &&
    ((newAPI && shared?.keyMode === "custom") ||
      (newConnections && shared?.connectionsKeyMode === "custom"))
  ) {
    report(
      "locked",
      "该设备需要相同的自定义同步密钥 / Enter the same custom synchronization key",
    );
    return;
  }
  if (newAPI || newConnections) {
    let api, connections;
    try {
      if (newAPI) api = await decodeAPI(shared!, s.device.apiKeySyncKey ?? "");
      if (newConnections)
        connections = await decodeConnections(
          shared!,
          s.device.apiKeySyncKey ?? "",
        );
    } catch {
      report(
        "locked",
        "自定义同步密钥不匹配或凭证记录无效，现有配置已保留 / Key mismatch or invalid credential record; current settings retained",
      );
      return;
    }
    if (store.getSnapshot().device !== s.device || record() !== shared) return;
    const patch: Partial<DeviceConfig> =
      connections && !s.device.credentialSyncPending?.connections
        ? importedConnections(connections, s.device.mcp)
        : {};
    const matches =
      !api || apiBaseUrl(api.baseUrl) === apiBaseUrl(s.ai.baseUrl);
    if (api && matches && !s.device.credentialSyncPending?.api)
      Object.assign(patch, {
        apiKey: api.apiKey,
        apiKeyEndpoint: apiBaseUrl(api.baseUrl),
      });
    const changed = Object.fromEntries(
      Object.entries(patch).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(s.device[key as keyof DeviceConfig]),
      ),
    );
    if (Object.keys(changed).length) await store.updateDevice(changed, true);
    const applied = { ...s, device: { ...s.device, ...patch } };
    if (api && matches) {
      lastCipher = shared!.cipher as string;
      lastLocal = s.device.credentialSyncPending?.api
        ? ""
        : fingerprint(applied);
    }
    if (connections) {
      lastConnectionsCipher = shared!.connectionsCipher as string;
      lastConnectionsLocal = s.device.credentialSyncPending?.connections
        ? ""
        : fingerprint(applied, true);
    }
    if (!matches) {
      report(
        "waiting",
        "凭证已下载，AI Key 等待匹配的接口配置 / Credentials downloaded; AI key awaits matching endpoint settings",
      );
      return;
    }
    pending = true;
    report("ready");
    return;
  }
  const api =
    (s.device.credentialSyncPending?.api || fingerprint(s) !== lastLocal) &&
    Boolean(
      s.device.apiKey || shared?.cipher || s.device.credentialSyncPending?.api,
    );
  const connections =
    (s.device.credentialSyncPending?.connections ||
      fingerprint(s, true) !== lastConnectionsLocal) &&
    Boolean(hasConnections(s) || shared?.connectionsCipher);
  await publish(s, api, connections);
  report("ready");
}
/** Serialize background encryption, downloaded decryption and self-triggered store updates. */
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
          "凭证同步未完成，现有配置已保留，请重试 / Credential synchronization incomplete; retry without clearing settings",
        ),
      )
      .finally(() => {
        running = null;
        if (pending) schedule();
      });
}
/** Start after storage loads; default encryption needs no password or manual unlock. */
export function startKeySync() {
  const cleanup = store.subscribe(schedule);
  schedule();
  return cleanup;
}
/** Finish encryption before exchanging logs so manual synchronization includes current credentials. */
export async function flushKeySync() {
  schedule();
  while (running) await running;
  if (state.status === "error") throw Error(state.message);
}
/** Save AI settings and rotate every shared credential using the same optional synchronization key. */
export async function saveAIAndKey(
  ai: AIConfig,
  apiKey: string,
  customKey: string,
  clearKey = false,
) {
  const normalized = { ...ai, baseUrl: apiBaseUrl(ai.baseUrl) },
    key = normalizeApiKey(apiKey);
  paused = true;
  try {
    await running;
    const s = store.getSnapshot(),
      existing = record(s);
    if (
      (existing?.keyMode === "custom" ||
        existing?.connectionsKeyMode === "custom") &&
      !customKey &&
      !s.device.apiKeySyncKey
    )
      throw Error(
        "现有凭证使用自定义同步密钥，请先输入相同密钥 / Enter the existing custom synchronization key first",
      );
    const unseenAPI =
      typeof existing?.cipher === "string" && existing.cipher !== lastCipher;
    const unseenConnections =
      typeof existing?.connectionsCipher === "string" &&
      existing.connectionsCipher !== lastConnectionsCipher;
    const remote = unseenAPI
      ? await decodeAPI(existing!, customKey)
      : undefined;
    const connections = unseenConnections
      ? await decodeConnections(existing!, customKey)
      : undefined;
    let value = key;
    if (
      !clearKey &&
      (!value || (value === s.device.apiKey && unseenAPI)) &&
      remote &&
      !s.device.credentialSyncPending?.api
    ) {
      if (apiBaseUrl(remote.baseUrl) !== normalized.baseUrl)
        throw Error(
          "同步密钥对应另一 AI 接口 / The synchronized key belongs to a different endpoint",
        );
      value = remote.apiKey;
    }
    await store.saveAI(normalized);
    await store.updateDevice({
      ...(connections && !s.device.credentialSyncPending?.connections
        ? importedConnections(connections, s.device.mcp)
        : {}),
      apiKey: value,
      apiKeyEndpoint: normalized.baseUrl,
      apiKeySyncKey: customKey,
    });
    await publish(
      store.getSnapshot(),
      Boolean(value || clearKey || existing?.cipher),
      Boolean(
        hasConnections(store.getSnapshot()) || existing?.connectionsCipher,
      ),
    );
    report("ready");
  } finally {
    paused = false;
    schedule();
  }
}
