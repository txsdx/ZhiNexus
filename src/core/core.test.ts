/** Regression tests for convergence, integrity, causal closure, encryption and scheduling. */
import { describe, it, expect } from "vitest";
import {
  canonical,
  sha256,
  merkle,
  encryptBackup,
  decryptBackup,
} from "./crypto";
import { materialize, stateHash, validateEnvelope } from "./crdt";
import { assertCausalClosure, validateDocuments } from "./validation";
import { newCard, schedule, gradeSchema, questionSchema } from "./review";
import type { Operation, Envelope, Vector } from "./types";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
/** Construct authentic immutable events for independent replicas. */
async function event(
  device: string,
  seq: number,
  vector: Vector,
  patch: Operation["patch"],
): Promise<Envelope> {
  const op: Operation = {
    schema: 1,
    device,
    seq,
    vector,
    entity: "concept",
    collection: "entry",
    patch,
    at: "2026-10-26T00:00:00.000Z",
    source: "test",
  };
  return { op, hash: await sha256(op) };
}
describe("causal multi-value registers", () => {
  it("converges for permutations and repeated delivery while retaining concurrent content", async () => {
    const a = await event(A, 1, { [A]: 1 }, { content: "A", title: "base" }),
      b = await event(B, 1, { [B]: 1 }, { content: "B" });
    const first = materialize([a, b]),
      second = materialize([b, a, b, a]);
    expect(first).toEqual(second);
    expect(first[0].conflicts.content).toHaveLength(2);
    expect(await stateHash([a, b])).toBe(await stateHash([b, a]));
  });
  it("causal resolution clears alternatives without erasing the log", async () => {
    const a = await event(A, 1, { [A]: 1 }, { content: "A" }),
      b = await event(B, 1, { [B]: 1 }, { content: "B" }),
      c = await event(A, 2, { [A]: 2, [B]: 1 }, { content: "merged" });
    for (const input of [
      [a, b, c],
      [c, b, a],
      [b, c, a],
    ]) {
      const d = materialize(input)[0];
      expect(d.fields.content).toBe("merged");
      expect(d.conflicts).toEqual({});
      expect(d.history).toHaveLength(3);
    }
  });
  it("merges independent fields without a document-level overwrite", async () => {
    const a = await event(A, 1, { [A]: 1 }, { title: "new title" }),
      b = await event(B, 1, { [B]: 1 }, { category: "science" });
    expect(materialize([a, b])[0].fields).toMatchObject({
      title: "new title",
      category: "science",
    });
  });
  it("retains deletion and recovery as auditable state changes", async () => {
    const a = await event(A, 1, { [A]: 1 }, { deleted: true }),
      b = await event(B, 1, { [B]: 1, [A]: 1 }, { deleted: false });
    expect(materialize([b, a])[0].fields.deleted).toBe(false);
  });
  it("rejects tampering, inconsistent dot counters and prototype field names", async () => {
    const e = await event(A, 1, { [A]: 1 }, { content: "safe" });
    await expect(
      validateEnvelope({
        ...e,
        op: { ...e.op, patch: { content: "corrupted" } },
      }),
    ).rejects.toThrow();
    const wrong = await event(A, 2, { [A]: 1 }, { content: "bad" });
    await expect(validateEnvelope(wrong)).rejects.toThrow();
    const evil = await event(
      A,
      1,
      { [A]: 1 },
      JSON.parse('{"__proto__":"bad"}'),
    );
    await expect(validateEnvelope(evil)).rejects.toThrow();
  });
  it("rejects missing causal predecessors and invalid domain shapes", async () => {
    const e = await event(A, 2, { [A]: 2 }, { title: 4 });
    expect(() => assertCausalClosure([e])).toThrow();
    expect(() => validateDocuments(materialize([e]))).toThrow();
  });
});
describe("portable integrity and backup", () => {
  it("canonicalizes nested keys and reduces an order-independent Merkle set", async () => {
    expect(canonical({ b: { d: 1, a: 2 }, a: [] })).toBe(
      canonical({ a: [], b: { a: 2, d: 1 } }),
    );
    const a = await sha256("a"),
      b = await sha256("b");
    expect(await merkle([a, b, a])).toBe(await merkle([b, a]));
    expect(await merkle([a])).not.toBe(await merkle([b]));
  });
  it("round-trips encrypted backups and rejects the wrong password or modified ciphertext", async () => {
    const payload = { note: "知识", credentials: { token: "test-only" } };
    const encrypted = await encryptBackup(payload, "a strong test password");
    expect(encrypted).not.toContain("test-only");
    expect(await decryptBackup(encrypted, "a strong test password")).toEqual(
      payload,
    );
    await expect(decryptBackup(encrypted, "wrong password")).rejects.toThrow();
    const data = JSON.parse(encrypted);
    data.data = (data.data[0] === "A" ? "B" : "A") + data.data.slice(1);
    await expect(
      decryptBackup(JSON.stringify(data), "a strong test password"),
    ).rejects.toThrow();
  });
});
describe("review scheduling", () => {
  it("schedules failed cards earlier than well-understood cards and revives JSON dates", () => {
    const now = new Date("2026-10-26T00:00:00.000Z"),
      card = newCard(),
      raw = JSON.parse(JSON.stringify(card));
    expect(schedule(raw, 30, now).due.getTime()).toBeLessThan(
      schedule(raw, 95, now).due.getTime(),
    );
    expect(schedule(raw, 95, now).reps).toBe(1);
  });
  it("rejects out-of-range AI grades and invalid multiple-choice questions", () => {
    expect(() =>
      gradeSchema.parse({
        score: 101,
        feedback: "ok",
        missing: "",
        lesson: "",
      }),
    ).toThrow();
    expect(() =>
      questionSchema.parse({
        question: "why",
        type: "choice",
        choices: [],
        answer: "a",
        rubric: "explain",
      }),
    ).toThrow();
  });
});
