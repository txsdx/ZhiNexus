# Packed WebDAV protocol — protocol and verification (0.17)

## Goal and scope

Replace one remote JSON file per operation with compressed batches and a verifiable checkpoint. Bootstrap from the checkpoint plus batched changes; automatically delete superseded packs and old loose events only after a verified replacement is published. Preserve offline changes, concurrent writers, causal closure, attachment checks and auditable failures. Do not retain a second steady-state legacy synchronization engine. Local immutable SQL history and native recovery remain intact; keeping them avoids weakening existing transaction and repair guarantees. The user does not require old database compatibility or cloud rollback.

## Atomic publication

Use a small `state/HEAD.json` with a verified atomic compare-and-swap primitive. Prefer strong ETag `If-Match` / initial `If-None-Match: *` where the server enforces them; otherwise use a fenced WebDAV exclusive ancestor lock on `state/`, compare the exact head bytes under lock, and PUT with its token in the `If` header. Probe mutual exclusion, guarded writes and rejection of stale tokens against disposable private objects. SFTPGo 2.7.6 ignores conditional PUT headers, so its verified lock primitive is required. Refuse publication/cleanup when neither primitive passes. No TLS/checksum bypass.

The head has a monotonic epoch and points to an immutable, SHA-addressed checkpoint manifest. The manifest lists compressed operation packs, their plain-content hashes, writer/sequence ranges, counts, complete causal vector, event/blob Merkle root, logical state hash and attachment inventory. Each pack is canonical JSON compressed with gzip in transport, with bounded compressed/decompressed reads. Build bounded packs by byte size and operation count, sorted by writer and sequence. Ranges allow reconstructing a pack from already-known local operations and verifying its digest without downloading it again. All envelopes, writer counters, causal dependencies, domain documents and blob references are verified before local projection/publication.

Prepare objects under unique paths containing publication epoch and a random nonce. Upload and read back new packs/checkpoint before CAS. On a competing head, re-read/merge/retry rather than overwriting. A losing upload never becomes authoritative. New publications may retain live objects from the observed head, or create fresh paths, but must never revive unreferenced old object paths.

## Garbage collection and readers

A successful head advance is an epoch barrier: stale writers cannot publish an earlier prepared plan because its ETag no longer matches. An object from an earlier epoch that is absent from the barrier head's live references cannot become referenced by any future valid writer. GC can delete those objects even if another writer advances the head afterwards. Objects prepared in the current/future epoch are left alone; a later metadata-only CAS barrier can make abandoned uploads collectable. Avoid wall-clock leases and assumptions about device clocks.

Delete only validated app-owned paths and preserve all live packs/checkpoints/blobs. Interruption during upload/CAS/readback never authorizes deletion of old committed data. Incomplete DELETE is retryable (404 accepted); it does not roll back a successful sync. A reader seeing an old referenced object disappear reloads the new head and retries; it must not acknowledge an incomplete replica. Full checkpoints preserve the causal history needed by a long-offline device, so GC does not depend on every device coming online or on expiring devices.

Initial conversion of an existing loose-event root must verify/merge its complete published data, snapshots and attachments before publishing v2 and deleting covered files. This is a one-time storage conversion, not a parallel legacy synchronization path. Old app versions are not supported against the new root. Existing local SQL history remains readable by the new app.

## Required validation

- Many-operation batches materially reduce remote files and HTTP operations; gzip actually reduces wire bytes.
- New device bootstrap after GC; offline edits uploaded after other devices compact.
- Concurrent head publishers and compaction; losing CAS never drops operations.
- Interrupted uploads / CAS / readback / partial DELETE, then retry and orphan cleanup.
- A stale writer cannot publish a path swept behind an epoch barrier; readers reload after a GC-induced 404.
- Bad hash, writer fork, causal gap, invalid document, missing/corrupt blob or damaged pack cannot certify sync or trigger unsafe GC.
- Repeated unchanged sync skips known pack bodies; explicit audit re-reads bytes and repairs only from matching verified local/cloud sources.
- Unsupported/misbehaving WebDAV conditionals fail safely without modifying authoritative data.

## Implementation and verification

`core/sync-packs` owns proof contracts and grouping; `core/compression` owns bounded gzip. `services/sync-transport` owns publication primitives and raw-byte quarantine. `services/packed-replica` owns merge/publication/epoch GC; `sync-replica` adapts SQL and native recovery. `legacy-cloud` verifies and retires existing loose roots once; `archive` owns file backup payloads. The old per-event audit engine and cloud rollback UI are removed.

Pack/checkpoint paths include epoch, random nonce and content hash. `basePacks` triggers compaction after 8 delta packs; unchanged live packs are reused. `looseEvents` is a boolean instead of one metadata path per old event; `retire` contains only old snapshot/device paths. Ordinary cleanup has a 256-delete budget; explicit audit/compact has no budget. Successful deletion progress is acknowledged in a new checkpoint. Garbage network operations and legacy event reads use at most four parallel requests. Cleanup errors are logged separately from intentionally queued work.

Unit and browser tests cover proofs, real gzip/bounds, conditional and fenced-lock primitives, expired tokens, interrupted publication/readback, lost acknowledgment, compaction races/read-404 retry, offline/new-device bootstrap, damaged/missing data, deleted HEAD recovery and partial legacy cleanup. A damaged address without a trusted copy is rejected before any local repair transaction can remove its original row.

Opt-in real-provider test: `scripts/sftpgo-smoke.mjs`; see SFTPGO_COMPATIBILITY for service/version and actual results. Final full-suite and release evidence is recorded in STATUS.
