/** SQLite and native recovery adapter for packed synchronization; cloud protocol code never owns application state. */
import { store } from "../core/store";
import { native } from "../core/database";
import { base64, unbase64 } from "../core/crypto";
import { materialize, validateEnvelope } from "../core/crdt";
import { assertCausalClosure, validateDocuments } from "../core/validation";
import {
  orderedEvents,
  type AssetRef,
  type Checkpoint,
} from "../core/sync-packs";
import type { Envelope } from "../core/types";
import {
  assetReference,
  verifiedAsset,
  type AssetValue,
  type PackedReplica,
} from "./packed-replica";
import { authorizeLooseRetirement, convertLooseCloud } from "./legacy-cloud";
import { flushKeySync } from "./key-sync";
import type { SyncTransport } from "./sync-transport";
interface CheckpointCache {
  hash: string;
  checkpoint: Checkpoint;
}
/** Build one exchange adapter; explicit audit can use verified journal sources to replace damaged SQL rows. */
export function sqliteReplica(
  remote: SyncTransport,
  audit = false,
  progress: (message: string) => void = () => {},
): PackedReplica {
  const journalEvents = new Map<string, Envelope>(),
    journalAssets = new Map<string, AssetValue>(),
    invalidJournal = new Set<string>();
  const remoteAssets = new Map<string, AssetValue>();
  let journalLoaded = false;
  const loadJournal = async () => {
    if (journalLoaded || !native || !audit) return;
    journalLoaded = true;
    const { invoke } = await import("@tauri-apps/api/core");
    for (const row of await invoke<{ id: string; data: string }[]>(
      "read_storage_journal",
      { kind: "events" },
    )) {
      try {
        const event = await validateEnvelope(JSON.parse(row.data));
        if (event.hash !== row.id)
          throw Error("Journal event address mismatch");
        journalEvents.set(event.hash, event);
      } catch {
        invalidJournal.add(row.id);
      }
    }
    for (const row of await invoke<{ id: string; data: string }[]>(
      "read_storage_journal",
      { kind: "blobs" },
    )) {
      try {
        const value = await verifiedAsset({
          hash: row.id,
          ...JSON.parse(row.data),
        });
        journalAssets.set(value.hash, value);
      } catch {
        invalidJournal.add(row.id);
      }
    }
  };
  const getAsset = async (hash: string): Promise<AssetValue> => {
    const incoming = remoteAssets.get(hash);
    if (incoming) return incoming;
    try {
      const value = await store.db.blob(hash);
      if (value)
        return verifiedAsset({
          hash,
          mime: value.mime,
          data: base64(value.bytes),
        });
    } catch (error) {
      if (!journalAssets.has(hash)) throw error;
    }
    const recovered = journalAssets.get(hash);
    if (recovered) return recovered;
    throw Error(
      "没有可信附件副本 / No verified asset source: " + hash.slice(0, 12),
    );
  };
  const adapter: PackedReplica = {
    read: async () => {
      await loadJournal();
      const events = new Map(journalEvents),
        damaged = new Set(invalidJournal);
      for (const row of await store.db.rawEvents()) {
        try {
          const value = await validateEnvelope(JSON.parse(row.json));
          if (value.hash !== row.hash)
            throw Error("Local event address mismatch");
          events.set(value.hash, value);
        } catch (error) {
          if (!audit) throw error;
          damaged.add(row.hash);
        }
      }
      const assets = new Map<string, AssetRef>(
        [...journalAssets.values()].map((asset) => [
          asset.hash,
          assetReference(asset),
        ]),
      );
      for (const ref of await store.db.blobInventory()) {
        if (audit) {
          try {
            const value = await getAsset(ref.hash);
            assets.set(ref.hash, assetReference(value));
          } catch {
            damaged.add(ref.hash);
          }
        } else assets.set(ref.hash, ref);
      }
      return {
        events: orderedEvents([...events.values()]),
        assets: [...assets.values()],
        damaged: [...damaged],
      };
    },
    asset: getAsset,
    apply: async (events, assets, repair) => {
      const all = orderedEvents(events);
      assertCausalClosure(all);
      validateDocuments(materialize(all));
      for (const asset of assets)
        remoteAssets.set(asset.hash, await verifiedAsset(asset));
      if (repair) {
        const view = await adapter.read(),
          sources = new Map<string, AssetValue>(remoteAssets);
        for (const ref of view.assets)
          if (!sources.has(ref.hash))
            sources.set(ref.hash, await getAsset(ref.hash));
        const available = new Set(sources.keys());
        for (const event of all)
          for (const match of JSON.stringify(event.op.patch).matchAll(
            /asset:([a-f0-9]{64})/g,
          ))
            if (!available.has(match[1]))
              throw Error(
                "修复缺少可信附件副本 / Repair has no verified asset source",
              );
        await store.db.repair(all, [...sources.values()]);
      } else {
        for (const asset of assets)
          await store.db.putBlob(unbase64(asset.data), asset.mime, asset.hash);
        const known = new Set(
            (await store.db.events()).map((event) => event.hash),
          ),
          incoming = all.filter((event) => !known.has(event.hash));
        if (incoming.length) await store.ingest(incoming);
        await flushKeySync();
      }
    },
    cachedCheckpoint: async (hash) => {
      const entries = await store.db.local<CheckpointCache[]>(
        "sync-checkpoints-v2",
        [],
      );
      return entries.find((entry) => entry.hash === hash)?.checkpoint ?? null;
    },
    rememberCheckpoint: async (hash, checkpoint) => {
      const entries = await store.db.local<CheckpointCache[]>(
        "sync-checkpoints-v2",
        [],
      );
      if (entries[0]?.hash === hash) return;
      await store.db.setLocal(
        "sync-checkpoints-v2",
        [
          { hash, checkpoint },
          ...entries.filter((entry) => entry.hash !== hash),
        ].slice(0, 2),
      );
    },
    bootstrap: async () =>
      convertLooseCloud(remote, await adapter.read(), progress),
    authorizeRetirement: (path, events, assets) =>
      authorizeLooseRetirement(remote, path, events, assets),
  };
  return adapter;
}
