/** Field-level multi-value registers retain every concurrent edit and converge without wall-clock ordering. */
import { z } from "zod";
import type { Doc, Envelope, Operation, Vector, Register } from "./types";
import { canonical, sha256 } from "./crypto";
const operationSchema = z
  .object({
    schema: z.literal(1),
    device: z.string().uuid(),
    seq: z.number().int().positive().safe(),
    vector: z.record(z.string().uuid(), z.number().int().nonnegative().safe()),
    collection: z.enum([
      "entry",
      "category",
      "topic",
      "review",
      "setting",
      "edge",
    ]),
    entity: z.string().min(1).max(200),
    patch: z.record(z.string().min(1).max(100), z.json()),
    at: z.iso.datetime(),
    source: z.string().max(500),
  })
  .strict();
/** Return true only when a causally observes every component of b. */
export function dominates(a: Vector, b: Vector): boolean {
  return Object.entries(b).every(([d, n]) => (a[d] ?? 0) >= n);
}
/** Merge causal knowledge without assuming contiguous arrivals from other devices. */
export function joinVectors(events: Envelope[]): Vector {
  const v: Vector = {};
  for (const { op } of events)
    for (const [d, n] of Object.entries(op.vector))
      v[d] = Math.max(v[d] ?? 0, n);
  return v;
}
/** Reject corrupted, oversized or inconsistent network records before persistence. */
export async function validateEnvelope(input: unknown): Promise<Envelope> {
  const raw = z
    .object({ hash: z.string().regex(/^[a-f0-9]{64}$/), op: operationSchema })
    .strict()
    .parse(input);
  const op = raw.op as Operation;
  if (
    Object.keys(op.vector).length > 10000 ||
    Object.keys(op.patch).some((k) =>
      ["__proto__", "constructor", "prototype"].includes(k),
    ) ||
    op.vector[op.device] !== op.seq ||
    canonical(op).length > 8 * 1024 * 1024 ||
    (await sha256(op)) !== raw.hash
  )
    throw Error("日志完整性校验失败 / Invalid operation");
  return { hash: raw.hash, op };
}
/** Order concurrent candidates deterministically; all candidates remain visible as conflicts. */
function rank(a: Register, b: Register): number {
  const sum = (v: Vector) => Object.values(v).reduce((n, x) => n + x, 0);
  return (
    sum(a.event.op.vector) - sum(b.event.op.vector) ||
    a.event.hash.localeCompare(b.event.hash)
  );
}
/** Materialize registers from immutable events; duplicate deliveries are harmless. */
export function materialize(events: Envelope[]): Doc[] {
  const docs = new Map<string, Doc>();
  const registers = new Map<string, Record<string, Register[]>>();
  for (const e of new Map(events.map((e) => [e.hash, e])).values()) {
    const { op } = e;
    const k = op.collection + ":" + op.entity;
    let doc = docs.get(k);
    if (!doc) {
      doc = {
        id: op.entity,
        collection: op.collection,
        fields: Object.create(null),
        conflicts: Object.create(null),
        history: [],
      };
      docs.set(k, doc);
      registers.set(k, Object.create(null));
    }
    doc.history.push(e);
    const fields = registers.get(k)!;
    for (const [field, value] of Object.entries(op.patch)) {
      const old = fields[field] ?? [];
      if (old.some((r) => dominates(r.event.op.vector, op.vector))) continue;
      fields[field] = [
        ...old.filter((r) => !dominates(op.vector, r.event.op.vector)),
        { value, event: e },
      ];
    }
  }
  for (const [k, doc] of docs) {
    for (const [f, values] of Object.entries(registers.get(k)!)) {
      values.sort(rank);
      doc.fields[f] = values[values.length - 1].value;
      if (
        values.length > 1 &&
        new Set(values.map((v) => canonical(v.value))).size > 1
      )
        doc.conflicts[f] = values;
    }
    doc.history.sort(
      (a, b) => a.op.at.localeCompare(b.op.at) || a.hash.localeCompare(b.hash),
    );
  }
  return [...docs.values()].sort((a, b) =>
    (a.collection + ":" + a.id).localeCompare(b.collection + ":" + b.id),
  );
}
/** Hash only logical state so independent SQLite file layouts can still be compared. */
export async function stateHash(events: Envelope[]): Promise<string> {
  return sha256(
    materialize(events).map((d) => ({
      id: d.id,
      collection: d.collection,
      fields: d.fields,
      conflicts: Object.fromEntries(
        Object.entries(d.conflicts).map(([k, v]) => [
          k,
          v.map((r) => r.event.hash).sort(),
        ]),
      ),
    })),
  );
}
