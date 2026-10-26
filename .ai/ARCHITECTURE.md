# Architecture and storage decisions

## Boundaries

- `core/types`, `validation`: serialized domain contracts and validation.
- `core/database`: native Tauri SQLite; browser fallback uses sql.js/WASM + IndexedDB.
- `core/crdt`, `crypto`: field multi-value registers, causal vectors, canonical SHA-256, binary Merkle root, authenticated backup encryption.
- `core/store`: repository, command serialization, auditable operations and React external-store projections.
- `core/review`: maintained `ts-fsrs` scheduler, structured question and grade contracts.
- `services`: strict HTTPS providers, CPA catalog, templates, bounded agent tool loop, official MCP SDK, WebDAV transport, OS capture/notifications/updates.
- `pages`, `components`: React presentation. Rust only initializes native plugins. Native SQL does not expose an arbitrary shell.

## Replica protocol v1

Each mutation is `{schema, device, seq, vector, collection, entity, patch, at, source}`. A writer gets a fresh UUID per app runtime to prevent restored backups or multiple tabs from reusing counters. Immutable envelope path is `events/<SHA256(canonical operation)>.json`. Vectors order causality, timestamps are audit metadata only. An observed later field supersedes earlier values; concurrent distinct values are retained. A deterministic causal-weight/hash winner is displayed, and the entry history dialog and generic database conflict panel can resolve observed alternatives by writing a new operation. Deletion is a retained register with a recycle-bin recovery path; concurrent delete/edit preserves both histories.

All remote records are validated before event import. A complete import must have contiguous writer counters and every observed causal predecessor. Same writer/counter with different hashes is rejected. SQLite batch append uses a single INSERT SELECT json_each statement. The browser writes its SQLite image into IndexedDB under a cross-tab lock and rolls back memory on durability failure. BroadcastChannel refreshes other tabs. IDs and user names are data, never paths.

Attachments are `blobs/<SHA256(bytes)>.json` containing MIME + Base64 bytes. Reference syntax is `asset:<hash>` in Markdown. Bytes are verified before storage, rendering and import. 20 MiB per attachment. Base64 adds 33% overhead; a later transport revision should use raw blobs with a separately hashed metadata record. No automatic history/blob garbage collection: offline devices must not lose required data.

WebDAV root must use HTTPS without embedded credentials. Create root (parent must exist), events/, blobs/, devices/, snapshots/. Depth-1 PROPFIND discovers immutable files. Fetch unknown events, validate and merge, PUT absent local events, fetch missing referenced attachments, upload absent local attachments, run SQLite check, calculate log+blob Merkle and logical-state digest, then write device-specific advisory manifest. A shared mutable index is never authoritative. Two devices can synchronize concurrently; their union converges on a subsequent exchange. A successful exchange is not a globally atomic server snapshot.

Merkle leaves are operation hashes and blob hashes. Logical-state digest is derived from canonical documents and concurrent candidates, not SQLite bytes. SQLite layouts can differ despite identical state. Snapshots contain all operations and blobs plus both digests; encrypted backups additionally contain device settings. Restore verifies every record and digest before merging; credentials restore is an explicit second confirmation.

## What the cloud stores

WebDAV is a user-controlled replication target, not the live database. Never PUT a working SQLite file over another device. Object-storage and dedicated-server adapters are reserved through SyncTransport but not implemented. No schema compatibility layer is maintained during early development.

Knowledge, categories, reviews, topics, graph positions, prompts, task/model configuration and appearance replicate. API keys, WebDAV credentials and MCP tokens/config default to device-local. An optional password-encrypted credential vault replicates the complete credential bundle as a CRDT setting containing only AES-GCM ciphertext; another device syncs and explicitly unlocks it. The passphrase is never persisted. Notification/sync scheduling preferences remain device-local. Automatic key distribution, revocation and key rotation UI remain future work. Local device credentials are currently stored in SQLite and protected by OS profile permissions, not an OS keychain. File backups use AES-256-GCM, 96-bit random IV, random 128-bit salt and PBKDF2-SHA256 (310000 iterations, minimum 12-character passphrase).

## Scalability and recovery limits

Incremental payload transfer is implemented, but discovery lists all immutable names and projection replays the log. Browser fallback persists the whole SQLite image per commit. This is an alpha protocol, not a claim of verified large-library performance. Next steps: local projection cache/indexes, immutable bounded log blocks, durable outbox, streaming blobs/backups, Merkle subtree exchange and authenticated snapshot bootstrap. Device manifests are diagnostics, not trusted consistency certificates.

Missing remote logs that exist locally are republished, and missing local referenced blobs are retrieved and hash-checked. Logical corruption with a valid local copy can be repaired through explicit restore/sync; a physically corrupted SQLite file cannot currently self-heal automatically. Never erase/reset on integrity failure. Current manual snapshots are verifiable exports; automatic startup from a remote snapshot remains to implement.
