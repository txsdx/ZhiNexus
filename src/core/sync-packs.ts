/** Bounded operation packs and complete checkpoint proofs for the packed WebDAV protocol. */
import { z } from "zod";
import type { Envelope, Vector } from "./types";
import { canonical, merkle, sha256 } from "./crypto";
import { joinVectors, materialize, stateHash, validateEnvelope } from "./crdt";
import { assertCausalClosure, validateDocuments } from "./validation";
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  counter = z.number().int().nonnegative().safe();
const epoch = counter.min(1),
  uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const objectPath = new RegExp(
  `^(packs|checkpoints)/([1-9][0-9]*)_(${uuid})_([a-f0-9]{64})\\.(json\\.gz|json)$`,
);
/** Target a small number of bounded compressed objects rather than one request per operation. */
export const PACK_LIMITS = {
  events: 256,
  targetBytes: 1024 * 1024,
  // An existing 8 Mi-character operation may occupy up to 24 MiB as UTF-8.
  hardBytes: 32 * 1024 * 1024,
  manifestBytes: 16 * 1024 * 1024,
} as const;
const rangeSchema = z
  .object({
    device: z.string().uuid(),
    from: counter.min(1),
    to: counter.min(1),
  })
  .strict();
const packSchema = z
  .object({
    path: z.string(),
    hash,
    count: counter.min(1).max(PACK_LIMITS.events),
    bytes: counter.min(1).max(PACK_LIMITS.hardBytes),
    ranges: z.array(rangeSchema).min(1).max(PACK_LIMITS.events),
  })
  .strict();
const assetSchema = z
  .object({
    hash,
    mime: z.string().min(1).max(300),
    bytes: counter.max(20 * 1024 * 1024),
  })
  .strict();
const checkpointSchema = z
  .object({
    schema: z.literal(2),
    epoch,
    packs: z.array(packSchema).max(100000),
    basePacks: counter,
    retire: z.array(z.string()).max(10000),
    looseEvents: z.boolean(),
    blobs: z.array(assetSchema).max(1000000),
    vector: z.record(z.string().uuid(), counter),
    count: counter,
    root: hash,
    state: hash,
  })
  .strict();
const headSchema = z
  .object({
    schema: z.literal(2),
    epoch,
    checkpoint: z.object({ path: z.string(), hash }).strict(),
  })
  .strict();
/** Contiguous writer counters represented by one immutable pack. */
export type PackRange = z.infer<typeof rangeSchema>;
/** Plain-content digest and ranges permit verification from an existing local replica. */
export type PackRef = z.infer<typeof packSchema>;
/** Content-addressed attachment inventory, independent from SQLite layout. */
export type AssetRef = z.infer<typeof assetSchema>;
/** A complete causal history, its immutable batches and two independent replica digests. */
export type Checkpoint = z.infer<typeof checkpointSchema>;
/** The sole mutable object, protected by a server ETag compare-and-swap. */
export type SyncHead = z.infer<typeof headSchema>;
/** Newly prepared content; paths are never reused after losing a publication race. */
export interface PreparedPack {
  ref: PackRef;
  body: string;
  events: Envelope[];
}
/** Recognize only app-owned immutable paths; unknown server objects are never garbage collected. */
export function packedPath(path: string) {
  const match = objectPath.exec(path);
  if (
    !match ||
    !Number.isSafeInteger(Number(match[2])) ||
    (match[1] === "packs") !== (match[5] === "json.gz")
  )
    return null;
  return {
    kind: match[1] as "packs" | "checkpoints",
    epoch: Number(match[2]),
    hash: match[4],
  };
}
/** Use unique paths even for identical content, so an abandoned plan cannot revive garbage. */
export function newPackedPath(
  kind: "packs" | "checkpoints",
  generation: number,
  digest: string,
) {
  epoch.parse(generation);
  hash.parse(digest);
  return `${kind}/${generation}_${crypto.randomUUID()}_${digest}.${kind === "packs" ? "json.gz" : "json"}`;
}
/** Sort and deduplicate without hiding a fork at the same writer counter. */
export function orderedEvents(events: Envelope[]) {
  const dots = new Map<string, string>(),
    unique = new Map<string, Envelope>();
  for (const event of events) {
    const dot = `${event.op.device}:${event.op.seq}`,
      prior = dots.get(dot);
    if (prior && prior !== event.hash)
      throw Error("设备计数器冲突 / Conflicting writer counter");
    dots.set(dot, event.hash);
    unique.set(event.hash, event);
  }
  return [...unique.values()].sort(
    (a, b) => a.op.device.localeCompare(b.op.device) || a.op.seq - b.op.seq,
  );
}
/** Describe consecutive ranges; a pack never conceals a missing counter inside a range. */
function rangesOf(events: Envelope[]): PackRange[] {
  const ranges: PackRange[] = [];
  for (const e of events) {
    const last = ranges.at(-1);
    if (last?.device === e.op.device && last.to + 1 === e.op.seq)
      last.to = e.op.seq;
    else ranges.push({ device: e.op.device, from: e.op.seq, to: e.op.seq });
  }
  return ranges;
}
/** Split canonical envelopes by both byte size and count; allow one individually bounded large operation. */
export async function preparePacks(
  input: Envelope[],
  generation: number,
): Promise<PreparedPack[]> {
  const groups: Envelope[][] = [];
  let group: Envelope[] = [],
    size = 24;
  for (const event of orderedEvents(input)) {
    const bytes = new TextEncoder().encode(canonical(event)).length + 1;
    if (
      group.length &&
      (group.length >= PACK_LIMITS.events ||
        group.at(-1)!.op.device[0].toLowerCase() !==
          event.op.device[0].toLowerCase() ||
        size + bytes > PACK_LIMITS.targetBytes)
    ) {
      groups.push(group);
      group = [];
      size = 24;
    }
    group.push(event);
    size += bytes;
  }
  if (group.length) groups.push(group);
  const packs: PreparedPack[] = [];
  for (const events of groups) {
    const data = { schema: 2, events },
      body = canonical(data),
      bytes = new TextEncoder().encode(body).length;
    if (bytes > PACK_LIMITS.hardBytes)
      throw Error("日志批次超过大小限制 / Operation pack exceeds size limit");
    const digest = await sha256(data);
    packs.push({
      ref: {
        path: newPackedPath("packs", generation, digest),
        hash: digest,
        count: events.length,
        bytes,
        ranges: rangesOf(events),
      },
      body,
      events,
    });
  }
  return packs;
}
/** Validate the small authoritative pointer before following any path from the server. */
export function parseHead(input: unknown): SyncHead {
  const head = headSchema.parse(input),
    path = packedPath(head.checkpoint.path);
  if (
    !path ||
    path.kind !== "checkpoints" ||
    path.hash !== head.checkpoint.hash ||
    path.epoch > head.epoch
  )
    throw Error("云端检查点地址错误 / Invalid checkpoint address");
  return head;
}
/** Reject gaps, overlap, forged counts and path traversal before downloading checkpoint data. */
export function parseCheckpoint(input: unknown): Checkpoint {
  const value = checkpointSchema.parse(input);
  if (value.basePacks > value.packs.length)
    throw Error("检查点基线批次数无效 / Invalid checkpoint base pack count");
  if (
    value.retire.some(
      (path) =>
        !/^snapshots\/[a-f0-9]{64}\.json$/.test(path) &&
        !new RegExp(`^devices/${uuid}\\.json$`).test(path),
    )
  )
    throw Error("拒绝回收未知旧路径 / Unknown legacy retirement path");
  if (
    new TextEncoder().encode(canonical(value)).length >
    PACK_LIMITS.manifestBytes
  )
    throw Error("云端检查点过大 / Checkpoint exceeds size limit");
  const paths = new Set<string>(),
    byWriter = new Map<string, PackRange[]>();
  let count = 0;
  for (const pack of value.packs) {
    const path = packedPath(pack.path);
    if (
      !path ||
      path.kind !== "packs" ||
      path.hash !== pack.hash ||
      path.epoch > value.epoch ||
      paths.has(pack.path)
    )
      throw Error("云端日志批次地址错误 / Invalid pack address");
    paths.add(pack.path);
    let represented = 0;
    for (const range of pack.ranges) {
      if (range.to < range.from)
        throw Error("日志序号范围无效 / Invalid pack range");
      represented += range.to - range.from + 1;
      const intervals = byWriter.get(range.device) ?? [];
      intervals.push(range);
      byWriter.set(range.device, intervals);
    }
    if (represented !== pack.count)
      throw Error("日志批次计数不一致 / Pack count mismatch");
    count += pack.count;
  }
  if (count !== value.count)
    throw Error("云端日志计数不一致 / Checkpoint count mismatch");
  const frontier: Vector = {};
  for (const [device, ranges] of byWriter) {
    ranges.sort((a, b) => a.from - b.from);
    let next = 1;
    for (const range of ranges) {
      if (range.from !== next)
        throw Error(
          "日志范围存在缺口或重叠 / Pack ranges have a gap or overlap",
        );
      next = range.to + 1;
    }
    frontier[device] = next - 1;
  }
  const compactVector = Object.fromEntries(
    Object.entries(value.vector).filter(([, n]) => n > 0),
  );
  if (canonical(frontier) !== canonical(compactVector))
    throw Error("检查点因果向量不一致 / Checkpoint causal vector mismatch");
  if (new Set(value.blobs.map((b) => b.hash)).size !== value.blobs.length)
    throw Error("检查点附件地址重复 / Duplicate checkpoint asset");
  return value;
}
/** Verify exact pack bytes, envelope hashes and the advertised sequence ranges. */
export async function readPack(
  input: unknown,
  ref: PackRef,
): Promise<Envelope[]> {
  const value = z
    .object({
      schema: z.literal(2),
      events: z.array(z.unknown()).min(1).max(PACK_LIMITS.events),
    })
    .strict()
    .parse(input);
  if (
    (await sha256(value)) !== ref.hash ||
    new TextEncoder().encode(canonical(value)).length !== ref.bytes
  )
    throw Error("日志批次摘要不匹配 / Pack hash mismatch");
  const events: Envelope[] = [];
  for (const event of value.events) events.push(await validateEnvelope(event));
  const ordered = orderedEvents(events);
  if (
    events.length !== ref.count ||
    ordered.length !== events.length ||
    canonical(rangesOf(ordered)) !== canonical(ref.ranges) ||
    canonical(ordered) !== canonical(events)
  )
    throw Error("日志批次范围不一致 / Pack ranges mismatch");
  return events;
}
/** Index local dots once, rather than scanning all events for every remote pack. */
export function indexEvents(events: Envelope[]) {
  const index = new Map<string, Map<number, Envelope>>();
  for (const event of orderedEvents(events)) {
    let writer = index.get(event.op.device);
    if (!writer) {
      writer = new Map();
      index.set(event.op.device, writer);
    }
    writer.set(event.op.seq, event);
  }
  return index;
}
/** Reconstruct and hash a known pack; a missing or divergent dot forces a genuine remote read. */
export async function knownPack(
  ref: PackRef,
  index: ReturnType<typeof indexEvents>,
): Promise<Envelope[] | null> {
  const events: Envelope[] = [];
  for (const range of ref.ranges)
    for (let n = range.from; n <= range.to; n++) {
      const event = index.get(range.device)?.get(n);
      if (!event) return null;
      events.push(event);
    }
  const ordered = orderedEvents(events);
  return ordered.length === ref.count &&
    canonical(rangesOf(ordered)) === canonical(ref.ranges) &&
    new TextEncoder().encode(canonical({ schema: 2, events: ordered }))
      .length === ref.bytes &&
    (await sha256({ schema: 2, events: ordered })) === ref.hash
    ? ordered
    : null;
}
/** Validate domain state and all historical attachment references before certifying a complete replica. */
export async function verifyCheckpoint(
  checkpoint: Checkpoint,
  input: Envelope[],
) {
  const events = orderedEvents(input);
  for (const event of events) await validateEnvelope(event);
  assertCausalClosure(events);
  validateDocuments(materialize(events));
  const assets = new Set(checkpoint.blobs.map((b) => b.hash));
  for (const event of events)
    for (const match of canonical(event.op.patch).matchAll(
      /asset:([a-f0-9]{64})/g,
    ))
      if (!assets.has(match[1]))
        throw Error(
          "检查点缺少引用附件 / Checkpoint is missing a referenced asset",
        );
  if (
    events.length !== checkpoint.count ||
    canonical(joinVectors(events)) !== canonical(checkpoint.vector) ||
    (await merkle([...events.map((e) => e.hash), ...assets])) !==
      checkpoint.root ||
    (await stateHash(events)) !== checkpoint.state
  )
    throw Error("检查点完整性校验失败 / Checkpoint integrity check failed");
  return events;
}
/** Build a self-contained manifest only after the complete union passes validation. */
export async function makeCheckpoint(
  events: Envelope[],
  packs: PackRef[],
  blobs: AssetRef[],
  generation: number,
  basePacks = packs.length,
  retire: string[] = [],
  looseEvents = false,
): Promise<Checkpoint> {
  const all = orderedEvents(events),
    checkpoint = parseCheckpoint({
      schema: 2,
      epoch: generation,
      packs,
      basePacks,
      retire: [...new Set(retire)].sort(),
      looseEvents,
      blobs: [...blobs].sort((a, b) => a.hash.localeCompare(b.hash)),
      vector: joinVectors(all),
      count: all.length,
      root: await merkle([
        ...all.map((e) => e.hash),
        ...blobs.map((b) => b.hash),
      ]),
      state: await stateHash(all),
    });
  await verifyCheckpoint(checkpoint, all);
  return checkpoint;
}
