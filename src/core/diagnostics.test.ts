/** Diagnostic contracts: secret removal before storage, local durability, bounds and safe clearing. */
import { expect, it, vi } from "vitest";
import {
  DiagnosticJournal,
  diagnosticText,
  type DiagnosticRecord,
} from "./diagnostics";

it("removes credentials, binary images and signed URL queries while retaining prompt and raw null values", () => {
  const raw = JSON.stringify({
    prompt: "explain private-api-key",
    tool_calls: null,
    authorization: "Bearer token",
    b64_json: "AAA",
    url: "https://images.example/x?sig=signed-secret",
    screenshot: "data:image/png;base64,AA==",
  });
  const safe = diagnosticText(raw, ["private-api-key"]);
  for (const value of [
    "private-api-key",
    "signed-secret",
    "Bearer token",
    '"AAA"',
    "AA==",
  ])
    expect(safe).not.toContain(value);
  expect(safe).toContain('"tool_calls": null');
  expect(safe).toContain("explain [redacted]");
});

it("sanitizes before write and reload, correlates responses and persists clear only on success", async () => {
  let saved: DiagnosticRecord[] = [];
  const write = vi.fn(async (rows) => {
    saved = structuredClone(rows);
  });
  const journal = new DiagnosticJournal(() => ["secret-sentinel"]);
  await journal.init(async () => [], write);
  const id = journal.start({
    kind: "ai",
    task: "agent",
    model: "raw-id",
    message: "request",
    request: "prompt secret-sentinel",
  });
  journal.update(id, {
    level: "error",
    response: '{"tool_calls":null}',
    status: 500,
    error: "server secret-sentinel",
  });
  await journal.flush();
  expect(JSON.stringify(saved)).not.toContain("secret-sentinel");
  expect(saved[0]).toMatchObject({ id, level: "error", status: 500 });
  const reload = new DiagnosticJournal();
  await reload.init(async () => saved, write);
  expect(reload.getSnapshot()[0].id).toBe(id);
  write.mockRejectedValueOnce(Error("storage unavailable"));
  await expect(reload.clear()).rejects.toThrow("storage unavailable");
  expect(reload.getSnapshot()).toHaveLength(1);
  await reload.clear();
  expect(reload.getSnapshot()).toEqual([]);
  expect(saved).toEqual([]);
});

it("caps records and large fields with explicit truncation, and exposes persistence errors", async () => {
  const journal = new DiagnosticJournal();
  await journal.init(
    async () => [],
    async () => {
      throw Error("disk full");
    },
  );
  for (let i = 0; i < 105; i++)
    journal.start({
      kind: "app",
      message: String(i),
      request: "x".repeat(100000),
    });
  await expect(journal.flush()).rejects.toThrow("disk full");
  expect(journal.getSnapshot().length).toBeLessThanOrEqual(100);
  expect(JSON.stringify(journal.getSnapshot()).length).toBeLessThan(
    32 * 1024 * 1024,
  );
  expect(journal.getSnapshot()[0].request).toHaveLength(100000);
  expect(diagnosticText("x".repeat(4 * 1024 * 1024 + 1))).toContain(
    "truncated",
  );
});

it("handles cyclic errors and escaped credentials without breaking the caller", async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(diagnosticText(cyclic)).toContain("unserializable");
  const secret = 'quoted-"credential\\sentinel';
  expect(diagnosticText({ prompt: secret }, [secret])).not.toContain(
    "credential",
  );
  const journal = new DiagnosticJournal();
  await journal.init(
    async () => [
      {
        id: "interrupted",
        at: new Date().toISOString(),
        kind: "ai",
        level: "pending",
        message: "unfinished",
      },
    ],
    async () => {},
  );
  expect(journal.getSnapshot()[0]).toMatchObject({ level: "error" });
  expect(journal.getSnapshot()[0].error).toContain("结果未知");
});
