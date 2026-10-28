/** Packed checkpoint exchange, atomic publication and clock-independent garbage collection. */
import { z } from "zod";
import type { Envelope } from "../core/types";
import { canonical, sha256, unbase64 } from "../core/crypto";
import { validateEnvelope } from "../core/crdt";
import { materialize } from "../core/crdt";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import {
  indexEvents,
  knownPack,
  makeCheckpoint,
  newPackedPath,
  orderedEvents,
  packedPath,
  parseCheckpoint,
  parseHead,
  preparePacks,
  readPack,
  verifyCheckpoint,
  type AssetRef,
  type Checkpoint,
  type PackRef,
  type SyncHead,
} from "../core/sync-packs";
import {
  RemoteMissing,
  type SyncTransport,
  type VersionedHead,
} from "./sync-transport";
/** Existing attachment payload format remains content addressed and independent from event packing. */
export interface AssetValue {
  hash: string;
  mime: string;
  data: string;
}
/** A local view may include missing/damaged rows only when an explicit audit supplies alternate sources. */
export interface ReplicaView {
  events: Envelope[];
  assets: AssetRef[];
  damaged?: string[];
}
/** Application durability is separate from the cloud's publication and reclamation protocol. */
export interface PackedReplica {
  read(): Promise<ReplicaView>;
  asset(hash: string): Promise<AssetValue>;
  apply(
    events: Envelope[],
    assets: AssetValue[],
    repair: boolean,
  ): Promise<void>;
  authorizeRetirement?(
    path: string,
    events: Envelope[],
    assets: AssetRef[],
  ): Promise<boolean>;
  cachedCheckpoint?(hash: string): Promise<Checkpoint | null>;
  rememberCheckpoint?(hash: string, checkpoint: Checkpoint): Promise<void>;
  bootstrap?(): Promise<{
    events: Envelope[];
    assets: AssetValue[];
    retire: string[];
    looseEvents: boolean;
  }>;
}
/** Synchronization diagnostics describe verified data separately from deferred garbage removal. */
export interface PackedReport {
  received: number;
  sent: number;
  root: string;
  state: string;
  events: number;
  blobs: number;
  packs: number;
  compacted: boolean;
  repaired: number;
  checked: number;
  cleanup: {
    files: number;
    pending: number;
    deferred: boolean;
    errors: string[];
  };
}
/** Explicit deep verification reads every wire object; force-compaction replaces accumulated delta packs. */
export interface PackedOptions {
  audit?: boolean;
  compact?: boolean;
  progress?: (message: string) => void;
}
interface Published {
  version: VersionedHead;
  head: SyncHead;
  checkpoint: Checkpoint;
  events: Envelope[];
}
const assetSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    mime: z.string().min(1).max(300),
    data: z.string(),
  })
  .strict();
/** Bound remote work to four requests without changing the order of returned results. */
export async function mapTransfers<T, U>(
  values: T[],
  work: (value: T) => Promise<U>,
): Promise<U[]> {
  const result: U[] = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, values.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= values.length) return;
        result[index] = await work(values[index]);
      }
    }),
  );
  return result;
}
/** Verify address, size and MIME against the checkpoint before an attachment can enter local storage. */
export async function verifiedAsset(
  input: unknown,
  ref?: AssetRef,
): Promise<AssetValue> {
  const value = assetSchema.parse(input),
    bytes = unbase64(value.data);
  if (
    bytes.length > 20 * 1024 * 1024 ||
    (await sha256(bytes)) !== value.hash ||
    (ref &&
      (value.hash !== ref.hash ||
        bytes.length !== ref.bytes ||
        value.mime !== ref.mime))
  )
    throw Error("附件完整性校验失败 / Asset integrity check failed");
  return value;
}
/** Derive inventory from verified bytes, never from a server's untrusted length alone. */
export function assetReference(value: AssetValue): AssetRef {
  return {
    hash: value.hash,
    mime: value.mime,
    bytes: unbase64(value.data).length,
  };
}
/** Read and verify a complete published history, optionally repairing only exact matching local content. */
async function loadPublished(
  remote: SyncTransport,
  replica: PackedReplica,
  local: ReplicaView,
  options: PackedOptions,
  stats: { checked: number; repaired: number },
): Promise<Published | null> {
  const version = await remote.readHead();
  if (!version) return null;
  const head = parseHead(JSON.parse(version.body));
  let checkpoint: Checkpoint;
  try {
    const data = JSON.parse(await remote.read(head.checkpoint.path));
    if ((await sha256(data)) !== head.checkpoint.hash)
      throw Error("检查点地址摘要不一致 / Checkpoint address mismatch");
    checkpoint = parseCheckpoint(data);
  } catch (error) {
    const cached =
      options.audit && (await replica.cachedCheckpoint?.(head.checkpoint.hash));
    if (!cached || (await sha256(cached)) !== head.checkpoint.hash) throw error;
    if (!(error instanceof RemoteMissing))
      await remote.quarantine(head.checkpoint.path);
    await remote.write(head.checkpoint.path, canonical(cached));
    const actual = JSON.parse(await remote.read(head.checkpoint.path));
    if ((await sha256(actual)) !== head.checkpoint.hash)
      throw Error("检查点修复后校验失败 / Checkpoint repair readback failed");
    checkpoint = parseCheckpoint(actual);
    stats.repaired++;
  }
  if (checkpoint.epoch > head.epoch)
    throw Error("检查点版本超前 / Checkpoint epoch is ahead of its head");
  const index = indexEvents(local.events),
    present = new Set(
      (await remote.list("packs")).map((name) => "packs/" + name),
    );
  const batches = await mapTransfers(checkpoint.packs, async (ref) => {
    const known = await knownPack(ref, index);
    if (known && present.has(ref.path) && !options.audit) return known;
    stats.checked++;
    try {
      return await readPack(JSON.parse(await remote.read(ref.path)), ref);
    } catch (error) {
      if (!known || (!options.audit && !(error instanceof RemoteMissing)))
        throw error;
      // A compacting writer may have removed this old reference; reload rather than reviving its plan.
      const current = await remote.readHead();
      if (!current || current.etag !== version.etag)
        throw new RemoteMissing(ref.path);
      await readPack({ schema: 2, events: known }, ref);
      if (!(error instanceof RemoteMissing)) await remote.quarantine(ref.path);
      await remote.write(ref.path, canonical({ schema: 2, events: known }));
      const fixed = await readPack(
        JSON.parse(await remote.read(ref.path)),
        ref,
      );
      stats.repaired++;
      return fixed;
    }
  });
  const events = await verifyCheckpoint(checkpoint, batches.flat());
  await replica.rememberCheckpoint?.(head.checkpoint.hash, checkpoint);
  return { version, head, checkpoint, events };
}
/** An absent root with leftover preparations is not permission to erase another device's data. */
async function assertInitialObjectsCovered(
  remote: SyncTransport,
  local: Envelope[],
) {
  const known = new Set(local.map((event) => event.hash));
  let latestEpoch = 0;
  for (const name of await remote.list("packs")) {
    const path = "packs/" + name,
      parsed = packedPath(path);
    if (!parsed) continue;
    latestEpoch = Math.max(latestEpoch, parsed.epoch);
    const data = z
      .object({ schema: z.literal(2), events: z.array(z.unknown()) })
      .strict()
      .parse(JSON.parse(await remote.read(path)));
    if ((await sha256(data)) !== parsed.hash)
      throw Error(
        "无主日志批次损坏，保留原文件 / Damaged orphan pack retained",
      );
    for (const raw of data.events) {
      const event = await validateEnvelope(raw);
      if (!known.has(event.hash))
        throw Error(
          "云端缺少 HEAD 且存在未合并数据，请从原设备重试或校验修复 / Missing head with unpublished data; retry from the source device or audit",
        );
    }
  }
  const index = indexEvents(local);
  for (const name of await remote.list("checkpoints")) {
    const path = "checkpoints/" + name,
      object = packedPath(path);
    if (!object) continue;
    latestEpoch = Math.max(latestEpoch, object.epoch);
    const raw = JSON.parse(await remote.read(path));
    if ((await sha256(raw)) !== object.hash)
      throw Error(
        "缺少 HEAD 且检查点损坏，原文件已保留 / Missing head with damaged checkpoint retained",
      );
    const checkpoint = parseCheckpoint(raw),
      events: Envelope[] = [];
    for (const ref of checkpoint.packs) {
      const source = await knownPack(ref, index);
      if (!source)
        throw Error(
          "云端缺少 HEAD，本机无法重建检查点，未初始化空数据 / Missing head; local data cannot reconstruct checkpoint",
        );
      events.push(...source);
    }
    await verifyCheckpoint(checkpoint, events);
  }
  return latestEpoch;
}
/** Merge inventories deterministically; equal hashes identify the same bytes, while conflicting metadata is rejected. */
function inventory(...sources: AssetRef[][]) {
  const result = new Map<string, AssetRef>();
  for (const source of sources)
    for (const ref of source) {
      const prior = result.get(ref.hash);
      if (prior && canonical(prior) !== canonical(ref))
        throw Error("相同附件摘要的元数据不一致 / Conflicting asset metadata");
      result.set(ref.hash, ref);
    }
  return [...result.values()].sort((a, b) => a.hash.localeCompare(b.hash));
}
/** Check missing damaged addresses before any repair transaction can replace their original rows. */
function assertDamageCovered(
  local: ReplicaView,
  events: Envelope[],
  assets: AssetRef[],
) {
  const available = new Set([
    ...events.map((event) => event.hash),
    ...assets.map((asset) => asset.hash),
  ]);
  for (const hash of local.damaged ?? [])
    if (!available.has(hash))
      throw Error(
        "损坏记录没有同摘要可信副本 / No verified repair source: " + hash,
      );
}
/** Preserve published data during partial DELETE and competing GC; current-epoch uploads need a CAS barrier first. */
async function sweep(
  remote: SyncTransport,
  published: Published,
  replica: PackedReplica,
  limit: number,
) {
  const cleanup = {
      files: 0,
      pending: 0,
      deferred: false,
      errors: [] as string[],
    },
    pendingRetire: string[] = [];
  const retire = published.checkpoint.retire;
  let looseEvents = published.checkpoint.looseEvents;
  let version = await remote.readHead();
  if (
    !version ||
    canonical(parseHead(JSON.parse(version.body))) !== canonical(published.head)
  ) {
    cleanup.deferred = true;
    return { cleanup, pendingRetire: retire, looseEvents };
  }
  let head = published.head;
  const live = new Set([
    head.checkpoint.path,
    ...published.checkpoint.packs.map((ref) => ref.path),
  ]);
  const names = (
    await mapTransfers(["packs", "checkpoints"], async (folder) =>
      (await remote.list(folder)).map((name) => folder + "/" + name),
    )
  ).flat();
  const unused = names.flatMap((path) => {
    const object = packedPath(path);
    return object && !live.has(path) ? [{ path, epoch: object.epoch }] : [];
  });
  if (unused.some((object) => object.epoch === head.epoch)) {
    const next = { ...head, epoch: head.epoch + 1 };
    if (!(await remote.replaceHead(version.etag, canonical(next)))) {
      cleanup.deferred = true;
      cleanup.pending = unused.length + retire.length;
      return { cleanup, pendingRetire: retire, looseEvents };
    }
    version = await remote.readHead();
    if (
      !version ||
      canonical(parseHead(JSON.parse(version.body))) !== canonical(next)
    ) {
      cleanup.deferred = true;
      return { cleanup, pendingRetire: retire, looseEvents };
    }
    head = next;
  }
  const obsolete = unused
    .filter((object) => object.epoch < head.epoch)
    .map((object) => object.path);
  let budget = limit;
  const failed = (path: string, error: unknown) => {
    if (cleanup.errors.length < 20)
      cleanup.errors.push(
        path + ": " + (error instanceof Error ? error.message : String(error)),
      );
  };
  const obsoleteBatch = obsolete.slice(0, budget);
  budget -= obsoleteBatch.length;
  cleanup.pending += obsolete.length - obsoleteBatch.length;
  await mapTransfers(obsoleteBatch, async (path) => {
    try {
      await remote.remove(path);
      cleanup.files++;
    } catch (error) {
      cleanup.pending++;
      failed(path, error);
    }
  });
  const covered = new Set(published.events.map((event) => event.hash));
  if (looseEvents) {
    const names = await remote.list("events"),
      eligible = names.filter((name) => covered.has(name.slice(0, -5))),
      batch = eligible.slice(0, budget);
    budget -= batch.length;
    const unhandled = names.length - batch.length;
    looseEvents = unhandled > 0;
    cleanup.pending += unhandled;
    if (eligible.length !== names.length)
      failed(
        "events/",
        Error("旧日志尚未被检查点覆盖 / Legacy events are not covered"),
      );
    await mapTransfers(batch, async (name) => {
      try {
        await remote.remove("events/" + name);
        cleanup.files++;
      } catch (error) {
        looseEvents = true;
        cleanup.pending++;
        failed("events/" + name, error);
      }
    });
  }
  for (const path of retire) {
    if (budget-- <= 0) {
      pendingRetire.push(path);
      cleanup.pending++;
      continue;
    }
    try {
      if (
        !(await replica.authorizeRetirement?.(
          path,
          published.events,
          published.checkpoint.blobs,
        ))
      )
        throw Error("Legacy source is not covered");
      await remote.remove(path);
      cleanup.files++;
    } catch (error) {
      pendingRetire.push(path);
      cleanup.pending++;
      failed(path, error);
    }
  }
  return { cleanup, pendingRetire, looseEvents };
}
/** Persist successful one-time legacy deletion acknowledgments; a crash cannot strand thousands of old files forever. */
async function acknowledgeRetirement(
  remote: SyncTransport,
  replica: PackedReplica,
  published: Published,
  pending: string[],
  looseEvents: boolean,
): Promise<Published | null> {
  if (
    pending.length === published.checkpoint.retire.length &&
    looseEvents === published.checkpoint.looseEvents
  )
    return published;
  const version = await remote.readHead();
  if (!version) return null;
  const current = parseHead(JSON.parse(version.body));
  if (current.checkpoint.path !== published.head.checkpoint.path) return null;
  const checkpoint = parseCheckpoint({
    ...published.checkpoint,
    epoch: current.epoch + 1,
    retire: pending,
    looseEvents,
  });
  await verifyCheckpoint(checkpoint, published.events);
  const digest = await sha256(checkpoint),
    path = newPackedPath("checkpoints", checkpoint.epoch, digest);
  await remote.write(path, canonical(checkpoint));
  const readback = JSON.parse(await remote.read(path));
  if ((await sha256(readback)) !== digest)
    throw Error(
      "回收确认读回校验失败 / Cleanup acknowledgment readback failed",
    );
  const head: SyncHead = {
    schema: 2,
    epoch: checkpoint.epoch,
    checkpoint: { path, hash: digest },
  };
  if (!(await remote.replaceHead(version.etag, canonical(head)))) return null;
  const observed = await remote.readHead();
  if (
    !observed ||
    canonical(parseHead(JSON.parse(observed.body))) !== canonical(head)
  )
    return null;
  await replica.rememberCheckpoint?.(digest, checkpoint);
  // Old readers retry from HEAD; no valid future publisher can refer to the superseded manifest.
  await remote.remove(published.head.checkpoint.path).catch(() => {});
  return { version: observed, head, checkpoint, events: published.events };
}
/** Exchange complete checkpoints and local edits; a lost CAS re-merges instead of overwriting another writer. */
export async function synchronizePacked(
  remote: SyncTransport,
  replica: PackedReplica,
  options: PackedOptions = {},
): Promise<PackedReport> {
  await remote.init();
  const stats = { checked: 0, repaired: 0 };
  let received = 0,
    sent = 0;
  const legacyRetire = new Set<string>();
  let legacyEvents = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    options.progress?.("读取压缩检查点 / Reading packed checkpoint");
    let local = await replica.read(),
      published: Published | null;
    try {
      published = await loadPublished(remote, replica, local, options, stats);
    } catch (error) {
      if (error instanceof RemoteMissing && attempt < 4) continue;
      throw error;
    }
    let retire: string[] = [],
      initialEpoch = 0;
    if (!published) {
      const initial = await replica.bootstrap?.();
      if (initial) {
        assertDamageCovered(
          local,
          initial.events,
          inventory(local.assets, initial.assets.map(assetReference)),
        );
        await replica.apply(initial.events, initial.assets, !!options.audit);
        legacyEvents ||= initial.looseEvents;
        for (const path of initial.retire) legacyRetire.add(path);
        local = await replica.read();
      }
      initialEpoch = await assertInitialObjectsCovered(remote, local.events);
    }
    retire = [
      ...new Set([...(published?.checkpoint.retire ?? []), ...legacyRetire]),
    ].sort();
    const remoteEvents = published?.events ?? [],
      remoteAssets = published?.checkpoint.blobs ?? [],
      localHashes = new Set(local.events.map((event) => event.hash));
    const refs = inventory(remoteAssets, local.assets),
      localAssets = new Set(local.assets.map((asset) => asset.hash));
    const cloudAssets = new Set(
      (await remote.list("blobs")).map((name) => name.slice(0, -5)),
    );
    const incomingAssets: AssetValue[] = [];
    await mapTransfers(refs, async (ref) => {
      let localValue: AssetValue | undefined;
      if (localAssets.has(ref.hash) && options.audit) {
        try {
          localValue = await verifiedAsset(await replica.asset(ref.hash), ref);
        } catch {}
      }
      let remoteValue: AssetValue | undefined;
      const path = "blobs/" + ref.hash + ".json";
      if (!localAssets.has(ref.hash) || options.audit) {
        stats.checked++;
        try {
          remoteValue = await verifiedAsset(
            JSON.parse(await remote.read(path)),
            ref,
          );
        } catch (error) {
          if (!localValue && localAssets.has(ref.hash)) {
            try {
              localValue = await verifiedAsset(
                await replica.asset(ref.hash),
                ref,
              );
            } catch {}
          }
          if (!localValue) throw error;
          if (!(error instanceof RemoteMissing) && !options.audit) throw error;
          if (!(error instanceof RemoteMissing)) await remote.quarantine(path);
        }
      }
      if (!cloudAssets.has(ref.hash) || (options.audit && !remoteValue)) {
        const source =
          localValue ??
          (await verifiedAsset(await replica.asset(ref.hash), ref));
        await remote.write(path, canonical(source));
        await verifiedAsset(JSON.parse(await remote.read(path)), ref);
        stats.repaired++;
      }
      if (!localAssets.has(ref.hash) || (options.audit && !localValue)) {
        if (!remoteValue)
          throw Error("缺少可信附件副本 / No verified asset source");
        incomingAssets.push(remoteValue);
      }
    });
    const merged = orderedEvents([...local.events, ...remoteEvents]);
    assertCausalClosure(merged);
    validateDocuments(materialize(merged));
    received += remoteEvents.filter(
      (event) => !localHashes.has(event.hash),
    ).length;
    assertDamageCovered(local, merged, refs);
    await replica.apply(merged, incomingAssets, !!options.audit);
    local = await replica.read();
    const all = orderedEvents([...local.events, ...remoteEvents]),
      assets = inventory(local.assets, remoteAssets);
    assertDamageCovered(local, all, assets);
    const before = new Set(remoteEvents.map((event) => event.hash)),
      delta = all.filter((event) => !before.has(event.hash));
    const compacted =
      !published ||
      !!options.compact ||
      (published.checkpoint.packs.length - published.checkpoint.basePacks >=
        7 &&
        delta.length > 0);
    const generation = (published?.head.epoch ?? initialEpoch) + 1;
    const prepared = await preparePacks(compacted ? all : delta, generation);
    const reusable = new Map(
      (published?.checkpoint.packs ?? []).map((ref) => [ref.hash, ref]),
    );
    const uploads = compacted
      ? prepared.filter((pack) => !reusable.has(pack.ref.hash))
      : prepared;
    const packs: PackRef[] = compacted
      ? prepared.map((pack) => reusable.get(pack.ref.hash) ?? pack.ref)
      : [...published!.checkpoint.packs, ...prepared.map((pack) => pack.ref)];
    const checkpoint = await makeCheckpoint(
      all,
      packs,
      assets,
      generation,
      compacted ? packs.length : published!.checkpoint.basePacks,
      retire,
      legacyEvents || (published?.checkpoint.looseEvents ?? false),
    );
    const changed =
      !published ||
      delta.length > 0 ||
      canonical(assets) !== canonical(published.checkpoint.blobs) ||
      canonical(retire) !== canonical(published.checkpoint.retire) ||
      checkpoint.looseEvents !== published.checkpoint.looseEvents ||
      !!options.compact;
    if (changed) {
      options.progress?.("发布并校验检查点 / Publishing verified checkpoint");
      await mapTransfers(uploads, async (pack) => {
        await remote.write(pack.ref.path, pack.body);
        await readPack(JSON.parse(await remote.read(pack.ref.path)), pack.ref);
      });
      const digest = await sha256(checkpoint),
        path = newPackedPath("checkpoints", generation, digest);
      await remote.write(path, canonical(checkpoint));
      const actual = JSON.parse(await remote.read(path));
      if ((await sha256(actual)) !== digest)
        throw Error("检查点读回校验失败 / Checkpoint readback failed");
      await verifyCheckpoint(parseCheckpoint(actual), all);
      const head: SyncHead = {
        schema: 2,
        epoch: generation,
        checkpoint: { path, hash: digest },
      };
      if (
        !(await remote.replaceHead(
          published?.version.etag ?? null,
          canonical(head),
        ))
      )
        continue;
      sent += delta.length;
      const version = await remote.readHead();
      if (
        !version ||
        canonical(parseHead(JSON.parse(version.body))) !== canonical(head)
      )
        continue;
      published = { version, head, checkpoint, events: all };
      await replica.rememberCheckpoint?.(digest, checkpoint);
    }
    if (!published) throw Error("检查点未发布 / Checkpoint was not published");
    const { cleanup, pendingRetire, looseEvents } = await sweep(
      remote,
      published,
      replica,
      options.audit || options.compact ? Infinity : 256,
    );
    if (
      !cleanup.deferred &&
      (published.checkpoint.retire.length || published.checkpoint.looseEvents)
    ) {
      const acknowledged = await acknowledgeRetirement(
        remote,
        replica,
        published,
        pendingRetire,
        looseEvents,
      );
      if (acknowledged) published = acknowledged;
      else cleanup.deferred = true;
    }
    const latest = await remote.readHead();
    if (
      !latest ||
      parseHead(JSON.parse(latest.body)).checkpoint.hash !==
        published.head.checkpoint.hash
    )
      continue;
    return {
      received,
      sent,
      root: checkpoint.root,
      state: checkpoint.state,
      events: all.length,
      blobs: assets.length,
      packs: published.checkpoint.packs.length,
      compacted: changed && compacted,
      checked: stats.checked,
      repaired: stats.repaired,
      cleanup,
    };
  }
  throw Error(
    "云端持续并发更新，未覆盖其他设备的数据，请重试 / Cloud changed repeatedly; no updates overwritten, retry shortly",
  );
}
