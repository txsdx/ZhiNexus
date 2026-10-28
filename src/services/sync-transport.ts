/** Conditional WebDAV publication and bounded gzip operation objects; no browser or platform TLS exceptions. */
import { base64, sha256 } from "../core/crypto";
import { boundedBytes, gunzipText, gzipText } from "../core/compression";
import { PACK_LIMITS, packedPath } from "../core/sync-packs";
import { request, boundedText, secureUrl } from "./network";
/** Authoritative bytes and an opaque version, protected by ETag CAS or a fenced WebDAV lock. */
export interface VersionedHead {
  body: string;
  etag: string;
}
/** Immutable payloads plus one conditional pointer; `read`/`write` expose uncompressed UTF-8 text. */
export interface SyncTransport {
  init(): Promise<void>;
  list(folder: string): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, body: string): Promise<void>;
  remove(path: string): Promise<void>;
  quarantine(path: string): Promise<string>;
  readHead(): Promise<VersionedHead | null>;
  replaceHead(expected: string | null, body: string): Promise<boolean>;
}
/** A disappeared old object can be retried from a newer authoritative head after compaction. */
export class RemoteMissing extends Error {
  constructor(public readonly path: string) {
    super("云端对象不存在 / Remote object missing: " + path);
  }
}
type PublicationMode = "etag" | "lock";
const preparedRoots = new Map<string, PublicationMode>();
const headPath = "state/HEAD.json";
const lockInfo =
  '<?xml version="1.0"?><d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype><d:owner>ZhiNexus</d:owner></d:lockinfo>';
/** Require standard conditional writes before allowing atomic synchronization or garbage collection. */
function strongETag(response: Response) {
  const value = response.headers.get("etag");
  if (!value || value.startsWith("W/") || !/^"[^"\r\n]+"$/.test(value))
    throw Error(
      "WebDAV 未提供强 ETag，无法安全同步和清理 / Strong ETag required for safe synchronization",
    );
  return value;
}
/** TLS WebDAV transport that probes preconditions only on a disposable private object. */
export class WebDAV implements SyncTransport {
  private root: URL;
  private auth: string;
  private mode: PublicationMode = "etag";
  constructor(root: string, user: string, password: string) {
    this.root = secureUrl(root.endsWith("/") ? root : root + "/");
    this.auth =
      "Basic " + base64(new TextEncoder().encode(user + ":" + password));
  }
  /** Internal paths never come from model output or an unvalidated external URL. */
  private async call(
    path: string,
    method: string,
    body?: string | Uint8Array,
    headers: Record<string, string> = {},
  ) {
    if (path.includes("..") || path.startsWith("/") || /[?#\\]/.test(path))
      throw Error("Invalid WebDAV path");
    const response = await request(new URL(path, this.root).href, {
      method,
      headers: { Authorization: this.auth, ...headers },
      body: body as BodyInit,
    });
    if (!["GET", "PROPFIND", "LOCK"].includes(method))
      await response.body?.cancel();
    return response;
  }
  /** Probe a reliable publication primitive once per endpoint; SFTPGo uses its fenced WebDAV locks. */
  async init() {
    const key = await sha256({ root: this.root.href, auth: this.auth }),
      cached = preparedRoots.get(key);
    if (cached) {
      this.mode = cached;
      return;
    }
    let sftpgo = false;
    for (const path of [
      "",
      "packs/",
      "checkpoints/",
      "blobs/",
      "quarantine/",
      "state/",
    ]) {
      const response = await this.call(path, "MKCOL");
      if (!response.ok && response.status !== 405)
        throw Error(`WebDAV MKCOL HTTP ${response.status}`);
      sftpgo ||= /sftpgo/i.test(response.headers.get("server") ?? "");
    }
    const modes: PublicationMode[] = sftpgo
      ? ["lock", "etag"]
      : ["etag", "lock"];
    const failures: string[] = [];
    for (const mode of modes) {
      try {
        if (mode === "etag") await this.probe();
        else await this.probeLock();
        this.mode = mode;
        preparedRoots.set(key, mode);
        return;
      } catch (error) {
        failures.push(
          mode +
            ": " +
            (error instanceof Error ? error.message : String(error)),
        );
        if (mode === modes.at(-1))
          throw Error(
            "WebDAV 未通过原子发布验证，未修改同步数据 / WebDAV has no verified atomic publication: " +
              failures.join("; "),
          );
      }
    }
  }
  /** Acquire an exclusive ancestor lock; a token remains mandatory on child writes even if the lease expires. */
  private async acquire(path: string, depth: "0" | "infinity") {
    for (let attempt = 0; attempt < 7; attempt++) {
      const response = await this.call(path, "LOCK", lockInfo, {
        Depth: depth,
        Timeout: "Second-60",
        "Content-Type": "application/xml",
      });
      if (response.status === 423) {
        await response.body?.cancel();
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            50 * 2 ** attempt + Math.floor(Math.random() * 50),
          ),
        );
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`WebDAV LOCK HTTP ${response.status}`);
      }
      const token = response.headers.get("lock-token");
      await boundedText(response, 65536);
      if (!token || token.length > 2048 || !/^<[^<>\s]+>$/.test(token))
        throw Error("WebDAV 未返回有效锁凭证 / Invalid WebDAV lock token");
      return token;
    }
    throw Error(
      "其他设备正在发布同步，请稍后重试 / Another device is publishing; retry shortly",
    );
  }
  /** Expired lock tokens cannot authorize further writes; releasing an already-expired lock is harmless. */
  private async unlock(path: string, token: string) {
    const response = await this.call(path, "UNLOCK", undefined, {
      "Lock-Token": token,
    });
    if (!response.ok && response.status !== 409 && response.status !== 404)
      throw Error(`WebDAV UNLOCK HTTP ${response.status}`);
  }
  /** Serialize only the tiny head read/write; immutable payload transfer happens outside the lock. */
  private async withLock<T>(work: (token: string) => Promise<T>): Promise<T> {
    const token = await this.acquire("state/", "infinity");
    try {
      return await work(token);
    } finally {
      await this.unlock("state/", token);
    }
  }
  /** Verify ancestor mutual exclusion, guarded writes, and rejection of a token after unlock. */
  private async probeLock() {
    const folder = "quarantine/lock-probe-" + crypto.randomUUID() + "/",
      path = folder + "probe.json";
    const created = await this.call(folder, "MKCOL");
    if (!created.ok)
      throw Error(`WebDAV lock probe MKCOL HTTP ${created.status}`);
    let token: string | undefined;
    try {
      const initial = await this.call(path, "PUT", '{"probe":1}', {
        "Content-Type": "application/json",
      });
      if (!initial.ok)
        throw Error(`WebDAV lock probe PUT HTTP ${initial.status}`);
      token = await this.acquire(folder, "infinity");
      const competing = await this.call(folder, "LOCK", lockInfo, {
        Depth: "infinity",
        Timeout: "Second-60",
        "Content-Type": "application/xml",
      });
      await competing.body?.cancel();
      if (competing.status !== 423) {
        const other = competing.headers.get("lock-token");
        if (other) await this.unlock(folder, other);
        throw Error(
          "WebDAV 未提供排他锁 / Exclusive WebDAV lock is not enforced",
        );
      }
      const absent = await this.call(path, "PUT", '{"probe":2}');
      if (absent.status !== 423 && absent.status !== 412)
        throw Error(
          "WebDAV 锁未阻止未授权写入 / WebDAV lock did not fence an unguarded write",
        );
      const changed = await this.call(path, "PUT", '{"probe":2}', {
        If: `(${token})`,
      });
      if (!changed.ok || (await this.read(path)) !== '{"probe":2}')
        throw Error("WebDAV 锁写入验证失败 / Guarded WebDAV write failed");
      await this.unlock(folder, token);
      const expired = token;
      token = undefined;
      const stale = await this.call(path, "PUT", '{"probe":1}', {
        If: `(${expired})`,
      });
      if (stale.status !== 412 && stale.status !== 423)
        throw Error(
          "WebDAV 接受了过期锁写入 / Expired WebDAV token was accepted",
        );
    } finally {
      if (token) await this.unlock(folder, token);
      const removed = await this.call(folder, "DELETE");
      if (!removed.ok && removed.status !== 404)
        throw Error(`WebDAV lock probe DELETE HTTP ${removed.status}`);
    }
  }
  /** A server ignoring If-Match/If-None-Match must fail before authoritative data is changed. */
  private async probe() {
    const path = "quarantine/probe-" + crypto.randomUUID() + ".json",
      first = '{"probe":1}';
    let created = false;
    try {
      const response = await this.call(path, "PUT", first, {
        "If-None-Match": "*",
        "Content-Type": "application/json",
      });
      if (!response.ok)
        throw Error(`WebDAV conditional create HTTP ${response.status}`);
      created = true;
      const read = await this.call(path, "GET", undefined, {
        "Cache-Control": "no-cache",
      });
      if (!read.ok || (await boundedText(read, 1024)) !== first)
        throw Error("WebDAV 条件写入探测失败 / Conditional-write probe failed");
      const initialTag = strongETag(read);
      const conditions: Record<string, string>[] = [
        { "If-Match": '"invalid-' + crypto.randomUUID() + '"' },
        { "If-None-Match": "*" },
      ];
      for (const condition of conditions) {
        const rejected = await this.call(path, "PUT", '{"probe":2}', {
          ...condition,
          "Content-Type": "application/json",
        });
        if (rejected.status !== 412)
          throw Error(
            "WebDAV 不支持可靠条件写入，未修改同步数据 / WebDAV preconditions are not enforced",
          );
      }
      if ((await this.read(path)) !== first)
        throw Error(
          "WebDAV 条件写入探测内容被修改 / WebDAV probe was overwritten",
        );
      const changed = await this.call(path, "PUT", '{"probe":2}', {
        "If-Match": initialTag,
        "Content-Type": "application/json",
      });
      if (!changed.ok)
        throw Error(
          "WebDAV 拒绝有效的条件写入 / Valid conditional write rejected",
        );
      const updated = await this.call(path, "GET", undefined, {
        "Cache-Control": "no-cache",
      });
      if (
        !updated.ok ||
        strongETag(updated) === initialTag ||
        (await boundedText(updated, 1024)) !== '{"probe":2}'
      )
        throw Error(
          "WebDAV ETag 未随内容更新，无法安全清理 / ETag does not track content changes",
        );
      const stale = await this.call(path, "PUT", first, {
        "If-Match": initialTag,
      });
      if (stale.status !== 412)
        throw Error("WebDAV 接受了过期写入 / Stale conditional write accepted");
    } finally {
      if (created) await this.remove(path);
    }
  }
  /** List only immediate application objects; ignore unknown names rather than deleting them. */
  async list(folder: string) {
    if (
      !/^(packs|checkpoints|blobs|quarantine|events|snapshots|devices)$/.test(
        folder,
      )
    )
      throw Error("Invalid WebDAV collection");
    const response = await this.call(
      folder + "/",
      "PROPFIND",
      '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      { Depth: "1", "Content-Type": "application/xml" },
    );
    if (response.status === 404) return [];
    if (response.status !== 207)
      throw Error(`WebDAV PROPFIND HTTP ${response.status}`);
    const document = new DOMParser().parseFromString(
      await boundedText(response),
      "application/xml",
    );
    if (document.querySelector("parsererror"))
      throw Error("WebDAV 列表 XML 损坏");
    const prefix = new URL(folder + "/", this.root),
      names = new Set<string>();
    for (const node of Array.from(
      document.getElementsByTagNameNS("DAV:", "href"),
    )) {
      const url = new URL(node.textContent ?? "", this.root);
      if (
        url.origin !== prefix.origin ||
        !url.pathname.startsWith(prefix.pathname)
      )
        continue;
      const name = decodeURIComponent(
        url.pathname.slice(prefix.pathname.length),
      );
      if (
        /^[a-f0-9]{64}\.json$/.test(name) ||
        (folder === "devices" && /^[a-f0-9-]{36}\.json$/.test(name)) ||
        packedPath(folder + "/" + name)
      )
        names.add(name);
    }
    return [...names].sort();
  }
  /** Transfer packed logs as binary gzip; all other objects remain bounded canonical JSON. */
  async read(path: string): Promise<string> {
    const response = await this.call(path, "GET");
    if (response.status === 404) throw new RemoteMissing(path);
    if (!response.ok) throw Error(`WebDAV GET HTTP ${response.status}`);
    if (path.endsWith(".json.gz")) {
      const bytes = response.body
        ? await boundedBytes(response.body, PACK_LIMITS.hardBytes + 65536)
        : new Uint8Array(await response.arrayBuffer());
      if (bytes.length > PACK_LIMITS.hardBytes + 65536)
        throw Error(
          "压缩日志超过大小限制 / Compressed pack exceeds size limit",
        );
      return gunzipText(bytes, PACK_LIMITS.hardBytes);
    }
    return boundedText(
      response,
      (path.startsWith("snapshots/")
        ? 256
        : path.startsWith("checkpoints/")
          ? 16
          : 32) *
        1024 *
        1024,
    );
  }
  /** Repeating an immutable write is idempotent; the digest is verified by the caller on readback. */
  async write(path: string, body: string) {
    const compressed = path.endsWith(".json.gz"),
      payload = compressed ? await gzipText(body, PACK_LIMITS.hardBytes) : body;
    const response = await this.call(path, "PUT", payload, {
      "Content-Type": compressed ? "application/gzip" : "application/json",
    });
    if (!response.ok) throw Error(`WebDAV PUT HTTP ${response.status}`);
  }
  /** Collect only explicitly selected object paths; an interrupted prior delete is harmless. */
  async remove(path: string) {
    if (
      !packedPath(path) &&
      !/^(events|snapshots|devices|blobs|quarantine)\/[a-f0-9]{64}\.json$/.test(
        path,
      ) &&
      !/^devices\/[a-f0-9-]{36}\.json$/.test(path) &&
      !/^quarantine\/probe-[a-f0-9-]{36}\.json$/.test(path)
    )
      throw Error(
        "拒绝删除未知云端路径 / Refusing to delete an unknown cloud path",
      );
    const response = await this.call(path, "DELETE");
    if (!response.ok && response.status !== 404)
      throw Error(`WebDAV DELETE HTTP ${response.status}`);
  }
  /** Preserve exact damaged wire bytes, even when gzip cannot be decoded, before a verified repair. */
  async quarantine(path: string): Promise<string> {
    const response = await this.call(path, "GET");
    if (!response.ok)
      throw Error(`WebDAV quarantine GET HTTP ${response.status}`);
    const limit = PACK_LIMITS.hardBytes + 65536;
    const bytes = response.body
      ? await boundedBytes(response.body, limit)
      : new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit)
      throw Error(
        "损坏文件超过隔离限制 / Damaged object exceeds quarantine limit",
      );
    const digest = await sha256(bytes),
      copy = "quarantine/" + digest + ".bin";
    const saved = await this.call(copy, "PUT", bytes, {
      "Content-Type": "application/octet-stream",
    });
    if (!saved.ok) throw Error(`WebDAV quarantine PUT HTTP ${saved.status}`);
    const verification = await this.call(copy, "GET");
    if (!verification.ok)
      throw Error("隔离副本读取失败 / Quarantine readback failed");
    const actual = verification.body
      ? await boundedBytes(verification.body, limit)
      : new Uint8Array(await verification.arrayBuffer());
    if ((await sha256(actual)) !== digest)
      throw Error("隔离副本校验失败 / Quarantine verification failed");
    const metadata = { path, wireHash: digest, bytes: bytes.length },
      manifest = "quarantine/" + (await sha256(metadata)) + ".json";
    await this.write(manifest, JSON.stringify(metadata));
    return copy;
  }
  /** Read under the same lock used by writers when the service lacks conditional PUT support. */
  async readHead(): Promise<VersionedHead | null> {
    return this.mode === "lock"
      ? this.withLock(() => this.readHeadUnlocked())
      : this.readHeadUnlocked();
  }
  /** A lock-mode fingerprint compares exact bytes and does not assume timestamp-derived ETags are strong. */
  private async readHeadUnlocked(): Promise<VersionedHead | null> {
    const response = await this.call(headPath, "GET", undefined, {
      "Cache-Control": "no-cache",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`WebDAV head GET HTTP ${response.status}`);
    const body = await boundedText(response, 4096);
    return {
      body,
      etag:
        this.mode === "lock"
          ? '"sha256-' + (await sha256(new TextEncoder().encode(body))) + '"'
          : strongETag(response),
    };
  }
  /** Compare within an exclusive ancestor lock or use verified HTTP preconditions; stale writes never publish. */
  async replaceHead(expected: string | null, body: string): Promise<boolean> {
    if (this.mode === "lock")
      return this.withLock(async (token) => {
        const current = await this.readHeadUnlocked();
        if ((current?.etag ?? null) !== expected) return false;
        const response = await this.call(headPath, "PUT", body, {
          If: `(${token})`,
          "Content-Type": "application/json",
        });
        if (response.status === 412 || response.status === 423) return false;
        if (!response.ok)
          throw Error(`WebDAV guarded head PUT HTTP ${response.status}`);
        return true;
      });
    const response = await this.call(headPath, "PUT", body, {
      ...(expected === null
        ? { "If-None-Match": "*" }
        : { "If-Match": expected }),
      "Content-Type": "application/json",
    });
    if (response.status === 412) return false;
    if (!response.ok) throw Error(`WebDAV head PUT HTTP ${response.status}`);
    return true;
  }
}
