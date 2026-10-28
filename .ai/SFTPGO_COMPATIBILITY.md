# SFTPGo WebDAV publication compatibility (0.17)

The user confirmed self-hosted SFTPGo. Its WebDAV implementation does not enforce HTTP conditional PUT: `handlePut` contains a TODO for `If-Match` / `If-None-Match`. Treating a strong-looking ETag as a CAS guarantee would lose concurrent writes and make GC unsafe.

Source inspected on 2026-10-28:
- https://github.com/drakkan/sftpgo/blob/main/internal/webdavd/server.go
- https://github.com/drakkan/sftpgo/blob/main/go.mod (drakkan/webdav d8645b1f41af)
- https://github.com/drakkan/webdav/blob/main/webdav.go (`handlePut`, `confirmLocks`, `handleLock`)

The transport probes disposable private objects. It uses reliable ETag CAS when enforced, otherwise verifies exclusive ancestor locks, child-write fencing and rejection of a released token. SFTPGo numeric opaque `Lock-Token` values are supported. Only the tiny head read/compare/write is serialized under a 60-second ancestor lock; all immutable transfers happen outside it. A delayed write carries its original token, so an expired lock cannot authorize a later stale publication. Reads use the same lock to avoid partial head writes. Failure of both primitives stops synchronization and cleanup before authoritative data changes.

Proxy requirements: preserve LOCK/UNLOCK, Depth, Timeout, If and Lock-Token. The account needs create/read/write/list/delete access in its dedicated sync directory. HTTPS remains mandatory in the app. Locks must be coherent across all backend instances; this local single-server test does not certify a clustered filesystem or reverse-proxy deployment.

Real local validation used official SFTPGo 2.7.6 with a fresh synthetic account and a disposable nonce directory. `node scripts/sftpgo-smoke.mjs` bridges a fake HTTPS browser route to local HTTP; production TLS checks are unchanged. Three clients converged under concurrent publication, retained offline edits after GC, bootstrapped a fresh client and verified attachment bytes. 1007 operations occupied 7 gzip packs and 1 checkpoint; 368829 canonical JSON bytes compressed to about 56 KB (nonce-dependent gzip size). A repeated unchanged exchange fetched no known pack bodies. No user server or user credentials were accessed. Fixture data is removed by the test; it is not a default CI dependency.
