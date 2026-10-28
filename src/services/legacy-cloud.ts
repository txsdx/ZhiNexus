/** One-time verification and retirement of existing loose cloud records; no steady-state v1 sync engine. */
import { z } from "zod";
import type { Envelope } from "../core/types";
import { canonical, sha256 } from "../core/crypto";
import { materialize, validateEnvelope } from "../core/crdt";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import { orderedEvents, type AssetRef } from "../core/sync-packs";
import { verifySnapshot } from "./archive";
import {
  verifiedAsset,
  mapTransfers,
  type AssetValue,
  type ReplicaView,
} from "./packed-replica";
import { RemoteMissing, type SyncTransport } from "./sync-transport";
/** Preserve all verified records in the existing root before the first atomic v2 publication. */
export async function convertLooseCloud(
  remote: SyncTransport,
  local: ReplicaView,
  progress: (message: string) => void = () => {},
) {
  const names = {
    events: await remote.list("events"),
    snapshots: await remote.list("snapshots"),
    devices: await remote.list("devices"),
  };
  const events = new Map(local.events.map((event) => [event.hash, event])),
    assets = new Map<string, AssetValue>(),
    retire: string[] = [];
  for (const name of names.snapshots) {
    const path = "snapshots/" + name,
      data = JSON.parse(await remote.read(path));
    if ((await sha256(data)) !== name.slice(0, -5))
      throw Error(
        "旧云端快照损坏，保留原文件 / Damaged legacy snapshot retained",
      );
    const snapshot = await verifySnapshot(data);
    for (const event of snapshot.events) events.set(event.hash, event);
    for (const asset of snapshot.blobs)
      assets.set(asset.hash, await verifiedAsset(asset));
    retire.push(path);
  }
  let checked = 0;
  await mapTransfers(names.events, async (name) => {
    progress(
      "验证现有日志 / Verifying existing records: " +
        ++checked +
        "/" +
        names.events.length,
    );
    const path = "events/" + name,
      hash = name.slice(0, -5);
    try {
      const event = await validateEnvelope(JSON.parse(await remote.read(path)));
      if (event.hash !== hash) throw Error("Legacy event address mismatch");
      events.set(hash, event);
    } catch (error) {
      const source = events.get(hash);
      if (!source)
        throw Error(
          "损坏记录没有同摘要可信副本，未清理文件 / No verified repair source: " +
            path,
        );
      await validateEnvelope(source);
      if (!(error instanceof RemoteMissing)) await remote.quarantine(path);
      await remote.write(path, canonical(source));
      const actual = await validateEnvelope(
        JSON.parse(await remote.read(path)),
      );
      if (actual.hash !== hash) throw Error("Legacy repair readback failed");
    }
  });
  const available = new Set([
    ...local.assets.map((asset) => asset.hash),
    ...assets.keys(),
  ]);
  for (const name of await remote.list("blobs")) {
    const hash = name.slice(0, -5);
    if (available.has(hash)) continue;
    const asset = await verifiedAsset(
      JSON.parse(await remote.read("blobs/" + name)),
    );
    if (asset.hash !== hash) throw Error("Legacy asset address mismatch");
    assets.set(hash, asset);
    available.add(hash);
  }
  const all = orderedEvents([...events.values()]);
  assertCausalClosure(all);
  validateDocuments(materialize(all));
  for (const event of all)
    for (const match of canonical(event.op.patch).matchAll(
      /asset:([a-f0-9]{64})/g,
    ))
      if (!available.has(match[1]))
        throw Error(
          "现有数据缺少附件，未清理旧日志 / Legacy data is missing an attachment; logs retained",
        );
  for (const name of names.devices) {
    const path = "devices/" + name;
    if (await authorizeLooseRetirement(remote, path, all, []))
      retire.push(path);
  }
  return {
    events: all,
    assets: [...assets.values()],
    retire,
    looseEvents: names.events.length > 0,
  };
}
/** A checkpoint cannot authorize deletion of a snapshot containing any as-yet-unmerged operation or attachment. */
export async function authorizeLooseRetirement(
  remote: SyncTransport,
  path: string,
  events: Envelope[],
  assets: AssetRef[],
): Promise<boolean> {
  let raw: string;
  try {
    raw = await remote.read(path);
  } catch (error) {
    if (error instanceof RemoteMissing) return true;
    throw error;
  }
  const data = JSON.parse(raw);
  if (path.startsWith("devices/")) {
    z.object({
      schema: z.literal(1),
      root: z.string().regex(/^[a-f0-9]{64}$/),
      state: z.string().regex(/^[a-f0-9]{64}$/),
      events: z.number().int().nonnegative(),
      at: z.iso.datetime(),
    })
      .strict()
      .parse(data);
    return true;
  }
  if (
    !path.startsWith("snapshots/") ||
    (await sha256(data)) !== path.slice(10, -5)
  )
    return false;
  const snapshot = await verifySnapshot(data),
    hashes = new Set(events.map((event) => event.hash)),
    blobs = new Set(assets.map((asset) => asset.hash));
  return (
    snapshot.events.every((event) => hashes.has(event.hash)) &&
    snapshot.blobs.every((asset) => blobs.has(asset.hash))
  );
}
