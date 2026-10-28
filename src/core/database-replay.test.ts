/** Startup recovery validates existing copies without re-journaling or re-encrypting every local record. */
import { beforeEach, afterAll, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  return {
    invoke: vi.fn(),
    execute: vi.fn(),
    select: vi.fn(),
    journal: {
      events: [] as { id: string; data: string }[],
      blobs: [] as { id: string; data: string }[],
      meta: [] as { id: string; data: string }[],
    },
    meta: [] as { key: string; value: string }[],
    blob: undefined as { hash: string; mime: string; data: string } | undefined,
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      execute: fixture.execute,
      select: fixture.select,
      close: async () => true,
    }),
  },
}));
import { Database } from "./database";
import { base64, sha256 } from "./crypto";
beforeEach(async () => {
  vi.clearAllMocks();
  const bytes = new TextEncoder().encode("original asset");
  fixture.blob = {
    hash: await sha256(bytes),
    mime: "image/png",
    data: base64(bytes),
  };
  fixture.meta = Array.from({ length: 12 }, (_, i) => ({
    key: "local-" + i,
    value: JSON.stringify({ value: i }),
  }));
  fixture.journal = {
    events: [],
    blobs: [
      {
        id: fixture.blob.hash,
        data: JSON.stringify({
          mime: fixture.blob.mime,
          data: fixture.blob.data,
        }),
      },
    ],
    meta: await Promise.all(
      fixture.meta.map(async (row) => ({
        id: await sha256(row.key),
        data: JSON.stringify({ key: row.key, value: JSON.parse(row.value) }),
      })),
    ),
  };
  fixture.invoke.mockImplementation(async (command, args) =>
    command === "storage_configuration"
      ? { root: "/fixture", connection: "sqlite:fixture.db" }
      : command === "read_storage_journal"
        ? fixture.journal[args.kind as keyof typeof fixture.journal]
        : null,
  );
  fixture.select.mockImplementation(async (sql: string) => {
    if (sql === "SELECT json FROM events") return [];
    if (sql === "SELECT key,value FROM meta") return fixture.meta;
    if (sql === "SELECT hash FROM blobs")
      return fixture.blob ? [{ hash: fixture.blob.hash }] : [];
    if (sql.startsWith("SELECT mime,data FROM blobs"))
      return fixture.blob ? [fixture.blob] : [];
    return [];
  });
  fixture.execute.mockResolvedValue({ rowsAffected: 1 });
});
afterAll(() => vi.unstubAllGlobals());
it("ordinary startup has zero metadata/blob writes and zero checkpoint calls when journal data is already present", async () => {
  const db = new Database();
  await db.open();
  fixture.execute.mockClear();
  fixture.invoke.mockClear();
  await db.replayJournal();
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(fixture.invoke.mock.calls.map((call) => call[0])).toEqual([
    "read_storage_journal",
    "read_storage_journal",
    "read_storage_journal",
  ]);
});
it("missing metadata is restored once from the verified journal in a single SQL batch", async () => {
  fixture.meta = [];
  const db = new Database();
  await db.open();
  fixture.execute.mockClear();
  await db.replayJournal();
  expect(fixture.execute).toHaveBeenCalledOnce();
  expect(fixture.execute.mock.calls[0][0]).toContain(
    "INSERT OR REPLACE INTO meta",
  );
  expect(
    fixture.invoke.mock.calls.some((call) => call[0] === "journal_storage"),
  ).toBe(false);
});
it("a damaged journal attachment cannot overwrite the existing SQL copy", async () => {
  fixture.journal.blobs[0].data = JSON.stringify({
    mime: "image/png",
    data: base64(new TextEncoder().encode("changed")),
  });
  const db = new Database();
  await db.open();
  fixture.execute.mockClear();
  await expect(db.replayJournal()).rejects.toThrow("address mismatch");
  expect(fixture.execute).not.toHaveBeenCalled();
});
