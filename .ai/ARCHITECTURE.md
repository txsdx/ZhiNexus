# Architecture and storage decisions

## Boundaries

- `core/types`, `validation`: serialized domain contracts and validation.
- `core/database`: native Tauri SQLite; browser fallback uses sql.js/WASM + IndexedDB.
- `core/crdt`, `crypto`: field multi-value registers, causal vectors, canonical SHA-256, binary Merkle root, authenticated backup encryption.
- `core/store`: repository, command serialization, auditable operations and React external-store projections.
- `core/review`: maintained `ts-fsrs` scheduler, structured question and grade contracts.
- `services`: HTTP(S) AI/MCP providers, strict HTTPS WebDAV, CPA catalog, templates, bounded agent tool loop, official MCP SDK, WebDAV transport, OS capture/notifications/updates.
- `pages`, `components`: React presentation. Rust owns app-root selection, verified SQLite checkpoints/journal replay, explicit OS selection capture and verified update/install boundaries in separate modules. Native SQL does not expose an arbitrary shell.

## Replica protocol v2 (packed WebDAV)

Each mutation is `{schema, device, seq, vector, collection, entity, patch, at, source}`. A writer gets a fresh UUID per app runtime to prevent restored backups or multiple tabs from reusing counters. Local SQL retains immutable envelopes; remote transport groups them into gzip packs at `packs/<epoch>_<nonce>_<SHA256(canonical pack)>.json.gz`. Vectors order causality, timestamps are audit metadata only. An observed later field supersedes earlier values; concurrent distinct values are retained. A deterministic causal-weight/hash winner is displayed, and the entry history dialog and generic database conflict panel can resolve observed alternatives by writing a new operation. Deletion is a retained register with a recycle-bin recovery path; concurrent delete/edit preserves both histories.

All remote records are validated before event import. A complete import must have contiguous writer counters and every observed causal predecessor. Same writer/counter with different hashes is rejected. SQLite batch append uses a single INSERT SELECT json_each statement. The browser writes its SQLite image into IndexedDB under a cross-tab lock and rolls back memory on durability failure. BroadcastChannel refreshes other tabs. IDs and user names are data, never paths.

Attachments are `blobs/<SHA256(bytes)>.json` containing MIME + Base64 bytes. Reference syntax is `asset:<hash>` in Markdown. Bytes are verified before storage, rendering and import. 20 MiB per attachment. Base64 adds 33% overhead; a later transport revision should use raw blobs with a separately hashed metadata record. No automatic history/blob garbage collection: offline devices must not lose required data.

WebDAV root must use HTTPS without embedded credentials. `state/HEAD.json` atomically selects a SHA-verified checkpoint under `checkpoints/`; its full pack inventory, causal vector, Merkle/logical digests and attachment inventory cover all published history. New packs/checkpoints are uploaded and read back before conditional publication. Strong ETag preconditions are probed on disposable objects. SFTPGo ignores conditional PUT, so a verified exclusive ancestor lock on `state/`, exact-byte head fingerprint and fenced `If` token provide compare-and-swap instead. A stale token cannot publish. Neither verified primitive means no sync-data mutation or GC. See SYNC_PACKS_V2 and SFTPGO_COMPATIBILITY.

Packs target 256 operations / 1 MiB, bounded to 32 MiB for one large valid operation. Writer ranges reconstruct known packs locally to skip repeated payload downloads. Eight accumulated delta packs trigger compaction, preserving unchanged live pack paths. Published epochs fence stale plans: GC removes only unreferenced older-epoch packs/checkpoints. A metadata-only head advance fences abandoned current-epoch plans. Readers retry the current head if concurrent GC removes an old reference. A complete retained causal history supports offline devices after GC without expiring or waiting for every device.

Existing loose cloud data is verified and merged once before publishing v2. Covered events, snapshots and advisory manifests are then retired; no steady-state v1 engine or cloud rollback UI remains. Ordinary sync performs at most 256 GC deletions, with manifest-persisted retirement progress; manual compact/deep audit completes the pending work. Failures remain retryable and are logged. All clients must upgrade before using the converted root.

Merkle leaves are operation hashes and blob hashes. Logical-state digest is derived from canonical documents and concurrent candidates, not SQLite bytes. SQLite layouts can differ despite identical state. Snapshots contain all operations and blobs plus both digests; encrypted backups additionally contain device settings. Restore verifies every record and digest before merging; credentials restore is an explicit second confirmation.

## What the cloud stores

WebDAV is a user-controlled replication target, not the live database. Never PUT a working SQLite file over another device. Object-storage and dedicated-server adapters are reserved through SyncTransport but not implemented. No schema compatibility layer is maintained during early development.

Knowledge, categories, reviews, topics, graph positions, prompts, model configuration and appearance replicate. AI, WebDAV and MCP credentials now synchronize automatically using the same optional custom synchronization key (empty selects the built-in convenience key). The existing `ai-key-vault` document address and `sync-api-key` domain remain readable; connection credentials use a separate `connectionsCipher` / `sync-connections` domain and independent key-mode metadata in the same CRDT document. A first-time WebDAV connection never writes an empty API key. Changing or clearing the one custom key re-encrypts both groups automatically. `core/secrets` uses domain-separated SHA-256 keys, AES-GCM and random 96-bit IVs; the built-in key is public by user request. Local API/custom keys, WebDAV fields and complete MCP configurations are separately wrapped before SQL/journal writes; existing API-only wrappers retain older saved connection fields when loaded. The old standalone PBKDF2 credential-vault service/UI is removed; historical encrypted records are retained without deletion, and current saved device credentials enter automatic encryption. File backups still use their independent PBKDF2 passphrase.

`store.updateDevice` records durable credential-outbox flags in the same local device write for actual API/connection edits. Encryption deduplication markers and outbox acknowledgments advance only after a successful event commit; reload retries pending saved edits rather than replacing them with older ciphertext. Imported credential updates preserve local pending edits and device-specific notification, proxy and scheduling settings. All decrypted groups are validated before application. Imported stdio configurations never become enabled unless identical to an already locally enabled program. Settings/actions/normal native shutdown and manual sync wait for encryption before capturing outbound events. Old custom ciphertext cannot be opened with a missing/wrong key; existing credentials remain in place and the setting reports the error.

Native networking retains system certificate roots. AI endpoints accept pasted standard paths and HTTP(S); WebDAV remains HTTPS-only. `services/network` preserves Request bodies/headers/abort, blocks cross-origin credential redirects, redacts diagnostic secrets and shares per-device proxy options with SDK HTTP/SSE, assets and update discovery. `network.rs` applies the same proxy to native installer downloads. Stdio programs are user-configured child processes, use bounded newline JSON-RPC and are closed/killed with their owned sessions. Their own networking follows their environment.

Desktop callbacks and tray actions run in Rust and queue payloads before focusing the webview. The OCR overlay skips database initialization, captures once before appearing, maps logical pointer bounds to physical image pixels, and discards its frame on cancel/finish. Local OCR is the default; vision uploads require the explicit result-dialog action. DPI is observed but not multiplied onto already-scaled WebView CSS.

Storage relocation is constrained to the current executable's two app roots. Frontend freezes commands, drains SQLite writes and checkpoints/closes it; a post-exit helper waits for the source-root lease, holds a transition lock, verifies streamed copies and SQLite, preserves the existing target, then switches the marker and restarts. Failure never clears the source. Filesystem locks and helper plans are not replicated. File backups remain AES-GCM/PBKDF2 (310000 iterations, minimum 12-character passphrase).

## Scalability and recovery limits

Packed payload transfer, automatic compaction and epoch GC are implemented and exercised on real local SFTPGo 2.7.6 with three clients. Discovery still lists pack/blob names and local projection replays complete SQL history; browser fallback persists its whole SQLite image. This is not a claim of million-operation library performance. Raw blob transport, local projection indexes, incremental Merkle subtrees and streaming file backups remain future work.

Explicit deep audit holds the sync gate and store maintenance guard, validates SQL/native-journal sources, re-reads every cloud wire object, and repairs only from matching trusted content or a hash-matching cached checkpoint. Damaged originals are quarantined before replacement. Missing damaged addresses must be covered before any SQL repair transaction; no source means originals remain and the operation fails. Actual local and published Merkle/logical roots must match before native recovery redundancy cleanup. Offline/unpublished edits and simultaneous future writes are outside the captured certificate.

Native persistence mirrors events, blobs and metadata into an fsynced app-owned durable journal before acknowledging SQLite commits. Verified rolling VACUUM INTO checkpoints provide three fallback generations; boot checks integrity, quarantines a damaged primary and replays all valid journal records on a restored checkpoint. Browser IndexedDB commits primary/checkpoint/digest atomically and preserves the damaged primary before fallback. This covers the exercised damage cases, not every filesystem, power-loss or external-tampering scenario. If no trustworthy recovery copy exists the app reports the error rather than silently resetting.

## Platform data roots and updates

`paths::StorageLocation` is chosen once before constructing webviews. Desktop executable-adjacent regular file `portable` selects `<exe-dir>/_data`, including SQL, journal/checkpoints, device settings and webview storage; otherwise Tauri app_data_dir is used. HTTP cookie persistence is disabled. Old normal-mode config data can be copied without overwriting existing user data; portable and normal roots are never silently merged.

`versions.json` keeps common major.minor and independent patches. CI builds all supported platforms through one manual entry and generates schema-2 Release/latest.json; unbuilt platform metadata survives within the same common line. Each client compares its own binary version and selects the correct installer/portable payload. Native download checks the fixed GitHub repository, bounded HTTPS redirects, size and SHA-256; configured Minisign keys also bind the signed application version. Platform installers retain ordinary OS consent. Android's small private FileProvider bridge exposes only the verified APK; Windows portable replacement runs the verified new binary as a short-lived helper. No published upgrade round-trip has been validated yet.


## Verified cleanup and shortcut recording

After successful reconciliation, force a fresh verified SQLite checkpoint. Native cleanup prunes an events/blobs journal record only when all three retained SHA-verified, SQLite-verified checkpoints contain the same record. Startup replays only journal operations missing from SQL and verifies existing assets without re-mirroring them, so pruned redundancy stays pruned. New mutations still journal before SQL. This preserves recovery if the newest checkpoint is damaged; native tests also create a newer journal-only entry and recover both it and the pruned baseline after damaging primary/WAL/newest checkpoint. Pending journal writes older than 24 hours can be removed; metadata, damaged originals, SQL event history, historical assets and remote authoritative files are retained. Cleanup reports exact file count/bytes. Snapshot overlap determines how much can be reclaimed; this is not cloud log garbage collection and does not cap total history size. Browser fallback keeps its atomic IndexedDB generations and has no filesystem cleanup.

Shortcut recording uses physical KeyboardEvent codes, requires a modifier or function key, and supports Escape/blur/unmount cancellation. Rust temporarily unregisters only app-owned shortcuts under a unique lease. Matching cancellation restores them; a 35-second native timeout also restores them after a webview failure. Settings cannot be applied during capture, and registration restoration failures are shown explicitly. Network capabilities use explicit HTTP(S) wildcard ports, covered by URLPattern-engine and real native HTTP-proxy tests; TLS remains verified.


## Block editor and learning table (0.7)

Tiptap 3 / ProseMirror provides rich blocks, Markdown serialization, lists, tasks, tables and mathematics. Mermaid reuses strict rendering; images still resolve only verified `asset:` content. `entry.content` remains authoritative Markdown. The optional `editorDocument` stores `{schema, markdown, json}` and stable structural block IDs; reuse is permitted only if the bound Markdown matches and the JSON passes the editor schema. External AI/source edits invalidate a stale cache. Footnotes and raw HTML stay in source mode to avoid destructive conversion. Untouched source is not rewritten merely by opening an entry.

A focused section records its outside sibling IDs once. Replacements update only that region, including after deleting its original heading or creating new blocks. Missing boundaries fail closed. A separate outline navigates headings and exposes top-level content-block focus. Node-view decorations retain DOM anchors for formulas and other custom blocks.

`core/workspace` persists per-device tab IDs, active entry and local drafts in SQLite metadata. Saved notes and block structure synchronize; uncommitted drafts remain local and are not knowledge snapshots until saved. Tab switching retains draft state and in-flight page tasks while mounting only the visible document UI. Async image results append to the latest draft. Saving commits the note and durably clears its older draft before acknowledging success; a restart does not revive an already-committed or unchanged old buffer. Remote edits are compared before a draft overwrites changed saved fields. Editor undo history is scoped to its current mounted view.

`core/knowledge-view` derives recursive taxonomy rows without hiding orphan/cyclic imported nodes, extracts one-line summaries and uses the same maintained FSRS recall API as scheduling. Unknown first-review probabilities remain explicitly unknown. Estimated forgetting colors titles and memory status from black to yellow to red (white at the low-forgetting end in dark mode), with readable dark-theme variants. The table is sortable within branches and horizontally scrollable on phones.

## Streaming AI workspace

`core/ai-stream` uses eventsource-parser and incremental UTF-8 decoding for real Chat Completions SSE, including reasoning and indexed function-argument fragments. Only fully validated calls can reach Agent execution. Truncation, malformed data and provider stream errors retain partial output as failures. `services/ai` requests streaming for every text feature; only explicit unsupported-stream HTTP responses permit one non-streaming replay. Images retain their provider's full-response semantics. Diagnostic records retain the assembled complete content, reasoning and tool calls with credential redaction, never raw SSE frames.

`core/ai-queue` owns requests independently of mounted pages; `core/concurrency` applies a live device limit (default 2, range 1–16) to HTTP generations, releasing slots during human/tool approvals. Topic lanes serialize dependent chat turns. Captured prompts, partial outputs, proposals and edited OCR results are encrypted in device-only SQLite metadata; active snapshots checkpoint every 350 ms. Interrupted work never replays on reload. A Web Lock selects one browser-window owner; followers mirror durable output through BroadcastChannel and cannot mutate tasks. Native quit/migration cancels active work and flushes metadata.

`services/ai-workflows` reconstructs serializable jobs and validates proposals; `ai-apply` applies only after explicit review. Knowledge edits and an application receipt share one conditional batch; image draft insertion and its receipt share one local workspace commit. Failed task cleanup can retry without duplicate writes. Changed source and dirty drafts are protected. Review generation prepares sessions but changes FSRS only on the existing explicit save action; completed/cancelled/superseded reviews retire corresponding tasks. Agent tool approval and durable tool receipts remain in force.

`components/AIJobView` presents live output, tool approvals and destination-linked reviews. Entry metadata precedes a left-outline/main-document grid; no right panel is rendered. The selection BubbleMenu exposes contextual AI, yellow Highlight marks, bold and copy. Highlight marks round-trip through Markdown `==…==` and block JSON. The device sidebar override persists independently of appearance presets and has an accessible collapse/expand button.

## Unified build and release

`github_release` uses only anonymous public Release download URLs. It reads the exact project `/releases/latest/download/latest.json`, pins tagged files to this repository, validates each bounded HTTPS CDN redirect, and never creates Authorization/API-version headers or reads an updater token. The native update boundary retains device proxy, system TLS trust, byte limits, platform versions, SHA-256 and configured publisher signatures. Browser previews use the same public manifest. CI's automatic publication token remains scoped to uploading artifacts and never enters application code.

Android native update clients explicitly load system roots from the Conscrypt APEX and legacy system CA directories, since rustls-native-certs' Unix probe otherwise searches Termux paths. HTTPS chain and hostname verification remain enabled. Update errors persist on the About page in addition to the existing diagnostic/toast path.

`SyncStatus` renders a per-second elapsed clock from the existing durable `device.lastSync` without writing timer ticks or rerendering the document. Clicking flushes pending settings and enters the shared sync/audit lock, exposed through `syncActivity`; progress disables repeated requests. Only successful synchronization/audit updates the timestamp. Automatic success is silent, and errors remain visible. The compact status remains available on mobile.

`.github/workflows/build.yml` is the sole build/publication entry. One Ubuntu frontend job tests/builds/seals the complete `dist` file set with its source revision and SHA-256 hashes. Windows/Ubuntu matrix jobs and Android download that immutable artifact, verify it and disable only the duplicate Tauri frontend build hook. Rust, MSVC/Linux system libraries and Android/NDK outputs remain separately compiled and cached for their ABI; Windows native UI checks gate publication; Ubuntu UI diagnostics are on demand and reuse the exact DEB/source; Android builds only arm64 and verifies the package/signature by default. The publication job runs only after every native job succeeds and only when selected; draft selection is preserved. There is no push/PR test workflow: unit/script/browser regressions run once in the build frontend stage; native update regressions run before Ubuntu packaging. Old platform/release entry workflows and the obsolete target-selection planner are removed.

Android caches the pinned writable NDK, download metadata and arm64 compilation outputs. The default Action has no emulator, x86_64 test APK, KVM setup or system-image cache; optional `scripts/android-smoke.mjs` is retained for explicitly requested device tests. Ubuntu pins literal and mirror+file source forms to the official HTTPS archive, logs effective URIs, and installs required dependencies with bounded retries and no extra recommended packages.

Mobile block layouts use zero-minimum grid tracks and shrinkable outline items. A long heading must not expand the body beyond the device layout viewport: mobile Chromium otherwise moves fixed navigation outside the usable input coordinates. Regression coverage uses a real mobile browser context, rich editing and reload, not only desktop viewport resizing. Native Android screenshots use ADB display capture instead of full-page CDP emulation.

Android system-bar and cutout insets are applied to the native content root via AndroidX WindowInsetsCompat. Only those inset types are consumed; keyboard dispatch remains intact. The generated Activity keeps Tauri's edge-to-edge and WebView setup, then calls the copied SystemInsets helper. The generator rejects an unrecognized template rather than silently omitting the hook. This Android-only change uses its own patch version.

## Model inheritance and destructive confirmations (0.9)

`core/ai-config.resolveModel` resolves empty task/local model selections to the current shared `defaultModel` at each use, including image generation, OCR capability checks and automatic enrichment gates. Explicit task or local overrides keep their original raw IDs. Model display names are metadata only; the UI always shows IDs. Unknown tool support allows sending tool definitions; explicit false omits them. Reasoning effort still requires an explicit catalog declaration.

`useConfirmation` owns an asynchronous application modal. `core/confirmation.runConfirmed` waits for literal true before executing the mutation. Cancel, close, backdrop, Escape and component unmount resolve false. Rejections do not reach mutation callbacks; failed storage commits leave the committed projection unchanged. Category removal still uses one batch for its tombstone and direct child/entry reassignment.

All seven legacy native-confirm sites use this gate, including draft discard, snapshot/credential restore and updater launch. Tauri dialog overrides `window.confirm` with a Promise while DOM typings still say boolean; runtime source scans forbid calling that API again. React Flow uses `onBeforeDelete` and the committed store projection rather than optimistic edge removal. MCP configuration removal is confirmed before changing the local draft and then automatically saved. See DELETION_AUDIT.md.


## Diagnostics and autosave (0.10)

`core/diagnostics` keeps a capped, immutable diagnostic journal (100 records, 32 MiB UTF-8 total; individual text fields truncate above 4,000,000 characters with an explicit marker). `services/diagnostics` persists only to device-local SQL metadata, outside replicated events and knowledge snapshots. Request bodies retain final prompts/model/tool definitions; assembled complete provider output/reasoning/tool calls, status, latency, validation errors and application failures are recorded. Raw response envelopes and SSE frames are excluded. Partial assembled output survives provider/truncation errors. Authentication headers are never passed to logging. Known credentials, sensitive JSON fields, signed URL queries and image/b64 data are removed before memory publication and persistence. Each active request retains its redaction inputs until completion so a credential rotation cannot expose the original key. Interrupted pending records are shown as unknown-result errors on reload. Clear is confirmed and committed before changing the displayed history; logging-storage failures do not fail AI requests. Exports contain learning content and remain an explicit user action.

`core/auto-save` owns a serialized, debounced editor independent of React settings mounts. It rebases edited fields onto fresh committed settings, retains failed edits, and retries explicitly or after a new edit. `services/settings` validates/applies provider/key, appearance, WebDAV, proxy, desktop, MCP and notification groups independently, preserving unrelated successful groups. Native proxy/shortcut/permission changes run through their existing boundaries. Empty-key edits produce an encrypted empty-key record rather than rehydrating the prior credential. UI status distinguishes pending/saving/saved/error. Blur, navigation, settings actions and native exit/migration flush pending work; AI uses the latest valid provider settings without being blocked by an unrelated invalid group. Invalid drafts are held in memory and never silently stored as active settings. Shortcut capture releases its lease before scheduling new registrations.

Chat responses normalize absent/null tool_calls to an empty call list; malformed non-null calls still fail schema validation. Image responses accept null optional URL/base64 alternatives, requiring one usable image source. Structured-output errors retain the original provider response in diagnostics instead of silently fabricating a valid answer.


## Review controls (0.12)

Review sessions now retain an explicit `cancelled` terminal phase, excluded from unfinished-session selection but preserved in immutable history. Cancelling never changes the entry/card. New questions replace only their session question/answer/grade after successful validated generation; failed, identical or cancelled responses retain the original state. Existing answers/grades require an application confirmation before cancelling or replacing a question. Retry is available at every score.

Cancellation and question replacement use independent confirmation slots. Confirmation launches the cancellable generation task without holding its dialog lock for the duration of the network request, so replacement-in-progress can still be stopped or cancelled. The review page owns one AbortController with a synchronous active-task lock. `runTask`/`complete` pass its signal into the shared native/browser networking boundary; stopping or leaving the page invalidates pending requests and suppresses completion notifications. `KnowledgeStore.batchWhen`/`patchWhen` evaluate preconditions within the serialized command queue and again before appending: late responses must still reference the current uncompleted question and answer. Result commits additionally match the original grade, entry card and content, then update session/card/content in one batch. No FSRS increment occurs for cancellation, regeneration or retry; the local commit guard prevents duplicate result submission. Multi-device concurrent edits still use normal CRDT conflict retention.


## Agent conversation workspace (0.15)

The Agent route uses a bounded flex viewport below the global toolbar. Conversation navigation and message history have independent scroll containers; the composer remains anchored, with model/reasoning controls below its auto-sizing textarea. `useChatScroll` follows only while the reader is near the bottom, pauses on scrolling up/tool-detail expansion, and offers an explicit jump to the latest message. Mobile navigation uses an overlay and reserves the existing global navigation area. Message rendering is memoized, user content is plain text, assistant content retains the existing Markdown safety rules, and tool protocol output is collapsible. Each provider response has a random `responseId` shared by its queue stage and durable assistant message, avoiding duplicate live/final output during throttled snapshot transitions and across retries.

`services/topic-titles` generates metadata after a completed first exchange through the same live concurrency limiter. A short first-line title is available immediately; structured title output is conditionally committed only if the seed is still current, the topic exists, and no manual/generated title has superseded it. Manual title edits use compare-and-set and do not reorder the conversation list. A delayed AI title cannot overwrite a manual edit. Drafts are scoped by conversation in the mounted workspace; confirmed deletion changes the active draft only after durable success and only if navigation has not changed.

Completed chat/title jobs are automatically retired after their result is persisted; historical completed jobs are retired on queue initialization without replaying work. Failed storage cleanup preserves results and offers manual cleanup. Knowledge proposals, review scoring and writes retain their explicit application boundaries. Built-in queries run directly. MCP tools bypass confirmation only with `readOnlyHint: true` and no `destructiveHint: true`; unknown/conflicting annotations and pending uncertain action receipts require confirmation.

Interaction references and implementation scope are recorded in [CHAT_UX_REFERENCES.md](CHAT_UX_REFERENCES.md).


## Compact entry header (0.16)

`EntryPage` groups history/edit/chat actions in one toolbar and places the title and existing metadata controls in a wrapping flex row. Metadata uses a compact four-column grid, switching to two columns on phones; no knowledge fields or confirmation boundaries change. The direct AI button uses the existing `onChat(entryId)` route and clears any previous selection quote. `Agent.onOpenEntry` returns through the workspace controller, preserving the mounted entry draft. Existing per-entry topic filtering/provider context and global navigation scope remain authoritative.


## 0.18 interaction and scheduling boundaries

CategoryPicker is shared by capture and entry editing: searchable tree, collapsed branches, keyboard navigation and an explicit uncategorized choice. Capture is up to900px wide with ten-line material input. Category/entry moves use guarded commits; deleting a category has preserve/promote (default Enter), subtree-delete, or cancel. Tree and menu actions use the same deletion host. Existing data is untouched before consent, on cancellation, or when the atomic batch fails.

Entry metadata is editable only in edit mode; dates and actual review count/next due share aligned two-row facts beneath a full-width title. EntryAgent is a right sidebar with optional topic drawer. Context includes selected text and latest unsaved title/body. edit_explanation previews a full or unique-selection replacement and atomically records a local workspace receipt; explicit entry Save commits it. Later local/remote changes reject stale applications. New tool receipts include topic, response and call identity so a provider reusing call IDs cannot hide another response. Read-only tools execute directly; other software/MCP actions require a concrete preview.

The application owns context menus and clipboard operations, preserving original selections and rejecting changed rich documents. Soft entry colors are synchronized knowledge fields, with light/dark palettes. NavigationTrail stores routes, caret/ranges and scroll, retains forward branches, restores lazy pages instantly, and handles Alt arrows and mouse buttons3/4 without browser document navigation. Graph owns the remaining viewport; commands are in pane/node/edge context menus.

The review policy is synchronized desired retention (default90%, bounded50–99%). FSRS next and continuous forgetting_curve remain the authoritative model. New entries initialize an already-learned Good prior with a future due date and actual reviewCount0; existing cards remain intact. Queue, reminders, badges, next-due display and curves share review-policy. Learners explicitly rate Again/Hard/Good/Easy; AI scores only suggest a rating. Curve history uses recorded card states and leaves unrecorded time blank. See LEARNING_DESIGN.md for sources and limitations.

AutoSyncClock schedules from the actual last success, catches up on startup/focus/online/visibility, backs off after failure and shares activity/native transport locks with manual/audit work. Another window's fresh durable timestamp postpones duplicate automatic exchanges. Success stays silent. UpdateController coalesces checks and stages/reverifies platform-specific native files; auto-updates checks after first paint, retries offline errors, persists staging and honors opt-out. Windows normal quit drains settings/workspace/jobs/SQLite before silent install; explicit install may restart. Linux/Android retain OS authorization. Native caches are verified again before installing.

Startup validates recovery copies and event/blob integrity without replaying identical writes, re-encrypting unchanged local settings or materializing the same history twice. Heavy AI workflows/review/editor modules are loaded on demand. React mounts after storage validation; diagnostics/queue/updater/checkpoints continue after the first frame. Startup performance marks and native smoke reports measure phases; duplicate-I/O regressions assert no journal/SQL/checkpoint writes during an unchanged replay.

GTK overlay horizontal scrollbars can intercept the final table row. KnowledgeTable observes actual horizontal overflow and reserves16px only while needed; localized header labels wrap within their compact columns. Native smoke explicitly constrains the table to420px, checks top/center/bottom pointer targets and clicks the recovered entry. Default Ubuntu release builds omit GUI-driver setup; the opt-in native-ui workflow downloads a built DEB and checks out its exact source, without rebuilding or publishing.

Android整页缩放策略由mobile/android/PageGestures.kt负责，通过configure-android注入Tauri公开onWebViewCreate回调，在每次WebView创建时关闭supportZoom/builtInZoomControls/displayZoomControls；不使用touchmove阻断或全局touch-action:none，避免影响滚动、选区和ReactFlow内部缩放。

构建触发：移除独立push/PR Validate，Build frontend在生产编译前运行一次单元/发布脚本/浏览器回归，失败阻止三平台打包；Ubuntu release profile先运行原生更新边界测试。Android工程生成后configureLauncherIcons覆盖已提交各密度与adaptive normal/round引用，不依赖Tauri模板图标。

## 0.19单文件更新与知识星图

Windows构建以release-windows profile（opt-level=s、thin LTO、符号裁剪）输出一个_protable.exe，tauri.windows.conf.json禁用bundle，CI--no-bundle；Android/Ubuntu仍APK/DEB。旧安装器分支、缓存类型与未使用的updater插件依赖/权限删除；手工Minisign验证保持。原生update_identity如实返回数据模式；更新选择总是portable产物，不按存储位置选择安装器。executable_update模块在退出前同目录stage/fsync并缓存旧文件，helper在旧进程释放文件后校验/原子替换；无法启动时回退，失败持久反馈，一个previous.bin放在数据缓存，旧hash下载缓存有界回收。数据目录/portable标记不参与文件替换。0.18单文件helper协议保留一次升级交接，旧安装版需先完全退出后手动启动单文件一次。

knowledge-graph服务统一语义边、去重/引用/学习DAG校验、批量位置保存及布局。graph独立AI任务按模型上下文预算分组、比较全部组对，不静默漏掉跨组候选；每条使用摘要、解释摘录和显式截断标记。预览逐条选择后才原子提交，有幂等回执，源知识/星图改变即要求重新分析，保留已有关系。prerequisite A→B是理解B先需要A；progression是基础到进阶；related无向。6个图工具与原17个工具合用审阅/回执/取消/并发保护。节点左键框选后拖动，保存所有坐标；拖动开始的布局签名避免覆盖期间远端移动。

categoryPath统一完整层级；CategoryPicker保留共用树弹窗，但改为完整路径与独立修改按钮。色块指示使用独立高饱和调色，实际数据背景token/深色映射不变。AI结果预览关闭同步完成，持久化异步失败可见，旧关闭回调不会关掉新打开的预览。

0.19补充：普通关联可经全库分析提出有依据的有向升级，审阅标明并沿用edge ID；已有明确有向关系不被批量分析覆盖，仍经DAG检验。单节点内部批次不发无效请求，预计次数与实际批次一致。

0.20关于页：复用横向`.toggle`而非未定义`.check`，品牌/版本独立flex头部，更新控件用纵向容器统一间距和左对齐。只有available为真显示升级箭头，其余用版本说明；当前与无平台文件状态区分。更新控制器/原生校验与数据模式未变，原生UI读取版本说明的格式同步调整。

0.20捕获增强：CaptureEditor复用表单，CaptureSession合并异步保存、保留未确认输入，主webview的CaptureRepository串行/CAS管理本机草稿。图片先存本机meta暂存，Save后按哈希校验转入blobs；稳定创建ID防清草稿失败/响应丢失重复创建，保存过的草稿新编辑可另开创建ID保留。QuickCapture不初始化数据库/同步/AI，通过有窗口来源检查、限量与超时的Rust队列RPC访问唯一主写入者；关闭和全局退出/迁移先flush。DOCX在动态Mammoth/Turndown转换中保留简单语义与图片，fflate限制ZIP展开，HTML只作惰性DOM转换不挂载。

## 0.22公开更新与交互

公开Release直链更新取代0.21可选私有认证，不使用GitHub REST API，避免匿名配额使公开更新失败；build.rs和CI均无更新Token注入。旧二进制须手动更新一次。

ActionPicker是共享的有界模糊命令/节点选择器；App拥有真实动作和导航保护，面板只记最近成功动作ID。按需加载，不启动额外AI请求。Modal只将实际tabIndex>=0的可见元素纳入焦点环。

ChatDrafts在主窗口持有本机meta、250ms合并和串行排空，单个snapshot最大8MiB，错误保留输入，不静默驱逐；键为JSON[entryId,topicId]。异步建话题迁移最新草稿，入队成功仅清除与发送快照一致的字段；退出/迁移freeze并flush，失败恢复编辑。导出仅可见人类消息及明确标记的部分回复；再次提问不改历史。

Capture源格式工具经纯文本变换/原生insertText形成一次可撤销编辑；预览复用安全Markdown，媒体经主写者preview RPC，子窗口不打开第二数据库。任务筛选不写队列；知识选择调用单一guarded batch；星图定位只改变视口/选择；复习间隔取实际FSRS schedule，无额外调度模型。

Android除onWebViewCreate外在attach/post/resume重新应用WebSettings，viewport与touch-action:pan-x pan-y禁止整页缩放但保留平移/文字选择；ReactFlow局部手势继续独立控制画布。

## 0.23 Knowledge navigation and actual practice

`core/knowledge-search` parses bounded query data and shares Unicode field/phrase/exclusion filtering plus Fuse ranking between Library, EntrySwitcher and the readonly AI search tool. No native SQLite FTS claim is made. Table search preserves per-branch result rank until a user explicitly chooses a column. Ctrl+P uses ActionPicker, stable entry IDs and local recent identities; shared Modal restores the focus captured before child autofocus, preserving editor selections.

`core/entry-links` derives actual Markdown link/image nodes with mdast-util-from-markdown. Standard `entry:` IDs survive renames and editor codec round-trips. A content-keyed cache builds outgoing/incoming references without additional synchronized entities or graph edges. Tiptap knows this protocol; article clicks and the safe Markdown renderer intercept internal links, verify targets and reuse existing position/draft navigation. Insertions modify only the latest local draft. Favorites add one optional `starred` field and use the existing patch/history/confirmation/receipt boundaries.

`services/self-review` hashes title, explanation, full FSRS card, actual count and retention policy at session creation. Reveal only updates the session phase; completion validates both source and current session inside the command queue, then commits the card, count and `completedAt` with the session in one durable batch. `scheduleRecall` uses the same maintained ts-fsrs scheduler as AI practice. `grade` stays null for self ratings. Optional non-due practice changes only visible candidates. `core/study-activity` derives local-calendar events from real creation and actual completion (including historical done operations), without generating activity entities or using initialization priors. Capture templates are explicit undoable local text insertions.

Android release identity is pinned by `mobile/android/release-certificate.der` and `.sha256`. `scripts/android-sign.sh --check` requires the four private Secrets, verifies the store/key password policy, certificate fingerprint and private-key availability, then cleans its private temporary directory on any exit. The Build signing job gates frontend and all packaging. Actual APK signatures are verified again. UpdateInstaller compares package identity and installed/incoming signing sets before granting FileProvider access. No legacy temporary-key bypass or automatic data removal exists. See ANDROID_SIGNING for the external Secrets permission blocker and one-time legacy migration boundary.

AIJobReview closes only after durable queue flush, keeps edited fields/error visible on failure, and invalidates asynchronous close callbacks when its identity/unmount generation changes. Field edits merge the queue's current reviewData rather than a stale rendered snapshot. Controlled delayed/failed storage coverage verifies this ordering before reload, not a timing sleep.
