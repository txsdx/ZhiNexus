/** SQLite persistence: native plugin on Tauri, WASM SQLite with IndexedDB durability in browsers. */
import initSqlJs, { type Database as WasmDB } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { get, set } from "idb-keyval";
import type { Envelope } from "./types";
import { base64, unbase64, sha256 } from "./crypto";
export const native =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
interface NativeDB {
  execute(sql: string, bind?: unknown[]): Promise<unknown>;
  select<T>(sql: string, bind?: unknown[]): Promise<T>;
}
/** Keep storage mutations serialized and commit each imported batch atomically. */
export class Database {
  private wasm?: WasmDB;
  private db?: NativeDB;
  private engine?: Awaited<ReturnType<typeof initSqlJs>>;
  private tail: Promise<unknown> = Promise.resolve();
  /** Open the device database and create only the current development schema. */
  async open() {
    if (native) {
      const { default: SQL } = await import("@tauri-apps/plugin-sql");
      this.db = await SQL.load("sqlite:zhinexus.db");
    } else {
      this.engine = await initSqlJs({ locateFile: () => wasmUrl });
      const bytes = await get<Uint8Array>("zhinexus.sqlite.v1");
      this.wasm = bytes
        ? new this.engine.Database(bytes)
        : new this.engine.Database();
    }
    for (const sql of [
      "CREATE TABLE IF NOT EXISTS events (hash TEXT PRIMARY KEY, json TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ])
      await this.exec(sql);
    await this.flush();
  }
  /** Execute a SQL statement using bound parameters on either platform. */
  private async exec(sql: string, args: unknown[] = []) {
    if (this.db) await this.db.execute(sql, args);
    else this.wasm!.run(sql, args as (string | number | null)[]);
  }
  /** Query rows as named objects without leaking database handles. */
  private async query<T>(sql: string, args: unknown[] = []): Promise<T[]> {
    if (this.db) return this.db.select<T[]>(sql, args);
    const stmt = this.wasm!.prepare(sql);
    try {
      stmt.bind(args as string[]);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }
  /** Persist the browser database before acknowledging a write. */
  private async flush() {
    if (this.wasm) await set("zhinexus.sqlite.v1", this.wasm.export());
  }
  /** Refresh browser state while holding a cross-tab write lock and roll back failed durability. */
  private write<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const body = async () => {
        if (this.engine) {
          const bytes = await get<Uint8Array>("zhinexus.sqlite.v1");
          if (bytes) {
            this.wasm?.close();
            this.wasm = new this.engine.Database(bytes);
          }
        }
        const before = this.wasm?.export();
        try {
          const result = await fn();
          await this.flush();
          return result;
        } catch (e) {
          if (before && this.engine) {
            this.wasm?.close();
            this.wasm = new this.engine.Database(before);
          }
          throw e;
        }
      };
      return navigator.locks
        ? navigator.locks.request("zhinexus-sqlite", body)
        : body();
    };
    const task = this.tail.then(run, run);
    this.tail = task.catch(() => {});
    return task;
  }
  /** Read all immutable operations; derived indexes may be rebuilt at any time. */
  async events(): Promise<Envelope[]> {
    const read = async (): Promise<Envelope[]> => {
      if (this.engine) {
        const bytes = await get<Uint8Array>("zhinexus.sqlite.v1");
        if (bytes) {
          this.wasm?.close();
          this.wasm = new this.engine.Database(bytes);
        }
      }
      return (
        await this.query<{ json: string }>("SELECT json FROM events")
      ).map((r) => JSON.parse(r.json));
    };
    const run = async (): Promise<Envelope[]> => {
      if (this.engine && navigator.locks)
        return await navigator.locks.request("zhinexus-sqlite", read);
      return read();
    };
    return this.tail.then(run, run);
  }

  /** Insert an atomic, idempotent batch using one SQLite statement. */
  async append(events: Envelope[]) {
    if (!events.length) return;
    await this.write(async () => {
      await this.exec(
        "INSERT OR IGNORE INTO events(hash,json) SELECT json_extract(value,'$.hash'), json(value) FROM json_each(?)",
        [JSON.stringify(events)],
      );
    });
  }
  /** Read a local preference; credentials are never included in replicated documents. */
  async local<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.query<{ value: string }>(
      "SELECT value FROM meta WHERE key=?",
      [key],
    );
    return rows.length ? JSON.parse(rows[0].value) : fallback;
  }
  /** Persist a device-specific preference. */
  async setLocal(key: string, value: unknown) {
    await this.write(() =>
      this.exec("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)", [
        key,
        JSON.stringify(value),
      ]),
    );
  }
  /** Address attachment bytes by digest and verify before committing them. */
  async putBlob(
    bytes: Uint8Array,
    mime: string,
    expected?: string,
  ): Promise<string> {
    if (bytes.length > 20 * 1024 * 1024) throw Error("单个附件上限 20 MiB");
    const hash = await sha256(bytes);
    if (expected && hash !== expected) throw Error("附件 SHA-256 不匹配");
    await this.write(() =>
      this.exec("INSERT OR IGNORE INTO blobs(hash,mime,data) VALUES (?,?,?)", [
        hash,
        mime,
        base64(bytes),
      ]),
    );
    return hash;
  }
  /** Retrieve verified attachment data for rendering or transfer. */
  async blob(
    hash: string,
  ): Promise<{ mime: string; bytes: Uint8Array } | undefined> {
    const row = (
      await this.query<{ mime: string; data: string }>(
        "SELECT mime,data FROM blobs WHERE hash=?",
        [hash],
      )
    )[0];
    if (!row) return;
    const bytes = unbase64(row.data);
    if ((await sha256(bytes)) !== hash) throw Error("本地附件损坏");
    return { mime: row.mime, bytes };
  }
  /** List content hashes without loading all attachment bytes. */
  async blobHashes(): Promise<string[]> {
    return (await this.query<{ hash: string }>("SELECT hash FROM blobs")).map(
      (r) => r.hash,
    );
  }
  /** Run SQLite integrity checking in addition to logical checksums. */
  async integrity(): Promise<string> {
    const rows = await this.query<Record<string, string>>(
      "PRAGMA integrity_check",
    );
    return rows.map((r) => Object.values(r)[0]).join("\n");
  }
  /** Reclaim SQLite free pages; immutable history remains recoverable. */
  async vacuum() {
    await this.write(() => this.exec("VACUUM"));
  }
  /** Report actual allocated SQLite pages rather than approximate JSON size. */
  async size(): Promise<number> {
    const pages = await this.query<{ page_count: number }>("PRAGMA page_count"),
      size = await this.query<{ page_size: number }>("PRAGMA page_size");
    return pages[0].page_count * size[0].page_size;
  }
}
