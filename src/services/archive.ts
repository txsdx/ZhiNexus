/** Encrypted-file backup payloads; independent from packed cloud synchronization. */
import { z } from "zod";
import { store, json } from "../core/store";
import { base64, merkle, sha256, unbase64 } from "../core/crypto";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import { materialize, stateHash } from "../core/crdt";
import type { Envelope, Json } from "../core/types";
/** Build a complete, independently verifiable snapshot without deleting operation history. */
export async function snapshot(): Promise<Json> {
  const events = await store.db.events(),
    blobs = [];
  for (const hash of await store.db.blobHashes()) {
    const b = (await store.db.blob(hash))!;
    blobs.push({ hash, mime: b.mime, data: base64(b.bytes) });
  }
  return json({
    schema: 1,
    events,
    blobs,
    root: await merkle([
      ...events.map((e) => e.hash),
      ...blobs.map((b) => b.hash),
    ]),
    state: await stateHash(events),
  });
}
/** Restore by union, preserving local edits and refusing tampered archives before any writes. */
export async function verifySnapshot(input: unknown) {
  const s = z
    .object({
      schema: z.literal(1),
      events: z.array(z.unknown()),
      blobs: z.array(
        z.object({
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          mime: z.string(),
          data: z.string(),
        }),
      ),
      root: z.string(),
      state: z.string(),
    })
    .parse(input);
  const { validateEnvelope } = await import("../core/crdt");
  const events: Envelope[] = [];
  for (const e of s.events) events.push(await validateEnvelope(e));
  for (const b of s.blobs)
    if ((await sha256(unbase64(b.data))) !== b.hash)
      throw Error("备份附件摘要不匹配");
  if (
    (await merkle([
      ...events.map((e) => e.hash),
      ...s.blobs.map((b) => b.hash),
    ])) !== s.root ||
    (await stateHash(events)) !== s.state
  )
    throw Error("备份完整性校验失败");
  assertCausalClosure(events);
  validateDocuments(materialize(events));
  return { ...s, events };
}
/** Validate a complete archive before merging any records. */
export async function restoreSnapshot(input: unknown) {
  const s = await verifySnapshot(input);
  for (const b of s.blobs)
    await store.db.putBlob(unbase64(b.data), b.mime, b.hash);
  await store.ingest(s.events);
}
