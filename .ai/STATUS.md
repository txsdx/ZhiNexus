# 需求完成情况

当前开发版本：**Windows/Ubuntu/Android 0.12.0**。下面记录实际功能和验证范围；历史迭代见 CHANGELOG，限制见 KNOWN_ISSUES。

| 需求 | 当前实现 |
|---|---|
| 技术/模块 | Tauri 2、React/TS、SQLite/Rust，按领域、设置面板和原生边界拆分 |
| 捕获/查询 | 模糊查询、重复复用、快捷捕获与进程来源、桌面截图框选/OCR，原始材料先保存再 AI 整理 |
| AI | 可空 tool_calls 兼容、本机请求/响应/错误日志、CPA/普通模型目录、原始模型 ID、全局默认与动态任务继承/单项覆盖；Tools 未知允许尝试、明确否定才禁用；深度/可编辑模板、地址规范化与去敏错误 |
| 块编辑/多标签 | Tiptap 所见即所得、大纲定位、持久块 ID、边界保护聚焦、表格/待办/公式/Mermaid；本机标签与草稿恢复、后台配图不覆盖后续编辑 |
| 知识列表 | 分类树表格、递归计数/折叠、标题/一句话解释/创建/上次复习时间；FSRS 估计黑→黄→红，未知记忆状态单列 |
| 词条/图 | 标准双语 IPA/定义/公式/边界/例子/自测/前置；Markdown/KaTeX/Mermaid、可编辑关系图、附件与 AI 图片 |
| 复习 | FSRS、AI 简答/选择、评分补教、上下文恢复；确认取消/重新出题、所有分数可重新作答、停止请求和迟到响应保护 |
| 通知（23） | 独立页；按设备控制复习、失焦 AI/OCR 完成、同步失败、预览与间隔；Android OS 排程 |
| Agent/MCP（19–20） | 全局/条目独立话题上下文、确认式知识工具/外部工具、回执；HTTP/SSE/桌面 stdio，配置页位于提示词下方 |
| 分类 | 大类/子类编辑、递归计数、循环保护；删除等待应用内确认，取消/关闭/失败不改数据；AI 分类前后树和逐条分配确认 |
| 同步 | HTTPS WebDAV、不可变日志、版本向量、多值字段 CRDT、SHA-256 内容寻址、Merkle/逻辑摘要、增量 payload、审计修复和快照 |
| API Key（16/21） | API/WebDAV/MCP 统一可选同步密钥；留空默认 AES-GCM 自动落库/同步，无手动封存/解锁；API 绑定接口地址 |
| 代理（17–18） | 系统/HTTP/SOCKS5；覆盖所有应用内网络客户端，TLS 系统信任；stdio 程序依其环境 |
| 桌面（12/14/15） | 托盘后台、Windows Startup 快捷方式/Ubuntu XDG、全局三快捷键、DPI 观察/窗口适配、16px 默认正文 |
| 数据管理（13） | 占用/VACUUM/云端与本地双向校验修复/安全恢复冗余清理/备份恢复/回收站/冲突；应用内迁移两种目录，退出后校验复制、保留源与旧目标 |
| 发布（新 8，覆盖旧 22） | 一个 Build and release 手动入口，全平台编译、前端一次构建与校验复用；可选发布/草稿，保留自动校验与缓存 |
| 更新/portable | latest.json 独立平台版本/URL/说明、摘要/可选签名、平台安装器与便携替换；portable 标记统一 _data |
| 配置 | 所有设置自动保存、独立校验、待保存状态/失败重试、并发变更保留 |
| 外观/语言 | 多布局、日/夜/护眼、普通文本与说明/占位纯黑（夜间白色）、主题色、离线字体/字号、系统语言/简中/English |
| 预留 | 对象存储/专属服务端 SyncTransport，按要求尚不完整实现 |
| 大库 | 一事件一文件、全名字发现和全日志投影；日志块/增量 Merkle 子树与规模测试尚未完成 |

## 0.12 本轮验证（2026-10-27）

- **正式 Release [v0.12.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.12.0) 已发布**（非草稿/非预发布），北京时间 2026-10-27 16:01，应用源码 `5da76dd`。Windows protable/setup、Ubuntu DEB、Android arm64 开发签名 APK 及 latest.json 共 5 项资产均已上传；已读回清单并校验版本/下载 URL、清单自身及四个安装包的 GitHub SHA-256 摘要全部一致。
- 最终 [Build and release 40469043087](https://github.com/txsdx/ZhiNexus/actions/runs/40469043087) 全组成功：共享前端 `122071390331`、Windows `122071719107`、Ubuntu `122071719041`、Android `122071719025`、发布 `122076894262`，含上传与缓存收尾。Windows/Ubuntu 实包通过快捷键、OCR、代理/模型/MCP、SQLite 编辑、portable/系统隔离、清理/重启/损坏恢复；Android15 模拟器通过安装、编辑/重启、移动界面、通知与 OS 排程。
- 最终自动 [Validate 40469440783](https://github.com/txsdx/ZhiNexus/actions/runs/40469440783) 全部成功：80 单元、26 脚本、50 浏览器回归、前端构建与 locked Rust check。测试源码 `dca9ec7` 相比应用源码只补充公式焦点等待，应用内容不变。最终本地 80/26/50 也全部通过；复习 8 项专项及富文本焦点专项连续 3 次通过，格式/差异检查通过。Release 说明已写明统一密钥与复习操作，以及 Android 开发证书无法保证覆盖旧开发包的限制。


- 新增确认取消复习/重新出题、全部分数重新作答、停止 AI 请求；失败保留上下文，取消/换题/重答不更新 FSRS 或词条，只有明确记录结果才提交。
- 添加网络 AbortSignal、迟到响应与原题/答案校验、队列内提交条件和重复提交防护；取消状态随数据同步且历史保留。
- 本地 80 单元、26 脚本、49 Playwright 全量回归、前端构建、locked Rust check 和格式/差异检查通过；云端 Validate 40468100738 全部成功。补查换题请求中的取消确认锁后追加第 8 项专项通过。50 项回归首跑 49 通过，旧富文本测试触发 Tiptap 应用公式后 rAF 恢复焦点抢走摘要 fill 的竞态（快照证实文字进入正文）；改为等待编辑器焦点后填写摘要，保留严格草稿/保存断言，专项连续 3 次通过。构建 40468115096 的 Ubuntu 实包测试成功，主动取消其余步骤以纳入换题取消修复；最终应用源码 `5da76dd` 的全平台构建和正式发布已完成，最终结果见本节开头。

## 0.11 本轮验证（2026-10-27）

- 移除跨设备凭证保险箱；只保留“数据库与云同步”中的“自定义同步密钥（可选）”，空值自动使用默认密钥。AI Key、WebDAV、MCP 均自动加密保存和同步，密钥清空会自动重新加密；旧本机凭证/API 密文保留可读，历史密文不删除。
- 新增全部凭证统一默认/自定义/切回默认、错误密钥保护、新设备连接不清空 API Key、本地 stdio 需许可、独立设备偏好保留及待加密落盘失败重启重试回归。云端 Validate 40466555676 首轮捕获旧自动保存测试比较了加密前后的瞬时 outbox 标记（凭证一致）；已补充等待加密完成后再严格比较重启前后完整配置，应用实现不变。
- 本地 78 单元、26 脚本、42 Playwright 全量回归、前端构建和 locked Rust check 均通过；格式/差异检查完成。追加直接查询已落盘 SQLite meta，确认 API/WebDAV/MCP/env 凭证均不含明文；专项回归通过。Validate [40467070573](https://github.com/txsdx/ZhiNexus/actions/runs/40467070573) 全部通过。原三平台构建 [40466569858](https://github.com/txsdx/ZhiNexus/actions/runs/40466569858) 的 Ubuntu 实际程序测试成功；因用户追加复习控制，主动取消尚未完成的 Windows/Android/发布步骤，没有发布 0.11.0，改为合入 0.12 一起发布。

## 0.10 本轮验证（2026-10-27）

- **正式 Release [v0.10.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.10.0) 已发布**（非草稿、非预发布），源码 `fb2b626`，北京时间 2026-10-27 02:26。Windows protable/setup、Ubuntu DEB、Android arm64 APK 和 latest.json 共 5 项资产均上传完成。已认证读回 latest.json，校验三个平台版本/URL，并将 4 个安装包 SHA-256 与 GitHub 资产 digest 独立比对一致。
- **Release 构建全部成功**：[40375405443](https://github.com/txsdx/ZhiNexus/actions/runs/40375405443)：共享前端 `121757000844`、Windows `121757565617`、Ubuntu `121757565655`、Android `121757565523`、发布 `121765144940` 均成功，含缓存收尾。自动 Validate [40375381171](https://github.com/txsdx/ZhiNexus/actions/runs/40375381171) 的浏览器与 Rust 任务也全部成功。
- Windows/Ubuntu 实际打包程序通过无 Apply 按钮的快捷键/代理/模型配置自动保存、MCP/OCR/编辑、重启及损坏恢复；Android15/API35 模拟器通过编辑、重启恢复、移动界面、通知配置自动保存和 OS 排程。Android 本轮为 `_development.apk`，使用每次 CI 生成的开发证书，不保证覆盖旧开发包；正式连续升级仍需持久签名。已在 Release 说明中写明。没有 Android 实体手机或真实 AI 账号验证。

- 已实现 nullable tool_calls/图片可选字段兼容、本机 AI/错误日志页、统一自动保存和失败重试。浏览器覆盖真实请求/原始响应与密钥去除、刷新持久化、日志导出/取消清空、跨页自动保存、密钥清空、保存失败重试、无效代理不阻断有效 AI；原生测试同步移除手动 Apply。
- 本地 `npm test` **74 项**、脚本 **26 项**、完整 Playwright **40 项**、前端构建、Prettier/差异检查和 locked Rust check 均通过。旧富文本回归保存前增加草稿采集等待，提交后仍严格核对已存摘要。已按用户授权推送、完成三平台构建并发布正式 Release，证据见上。

## 0.9 本轮验证（2026-10-27）

- **0.9.0 三平台最终构建与测试全部成功**：[Build and release 40364552600](https://github.com/txsdx/ZhiNexus/actions/runs/40364552600)，源码/测试 commit `9bea908`（应用实现 `42ed542`）。Windows job `121719104584`、Ubuntu job `121719104455`、Android job `121719104540` 和共享前端 job `121718610847` 均成功，含上传和缓存收尾；publish 按输入跳过，没有创建 Release。
- **最终自动 Validate 全部成功**：[40364520371](https://github.com/txsdx/ZhiNexus/actions/runs/40364520371)：60 单元、26 脚本、36 Chromium 回归、前端构建及 locked Rust check。
- Windows/Ubuntu 实际打包程序通过模型目录的精确原始 ID（拒绝 display_name）和代理请求、MCP stdio、快捷键、OCR、编辑、系统/portable 隔离、重启及损坏恢复测试。Android 编译 arm64 发布 APK 与测试用 x86_64 调试 APK，Android15/API35 模拟器安装后通过编辑、标签/内容重启恢复、移动导航、安全区域、通知和 OS 排程；没有 Android 实体手机验证。
- 安装包在本轮 Artifacts：[Windows x64](https://github.com/txsdx/ZhiNexus/actions/runs/40364552600/artifacts/12670451172)（`*_protable.exe` / `*_setup.exe`）、[Ubuntu24+ x64](https://github.com/txsdx/ZhiNexus/actions/runs/40364552600/artifacts/12669498243)（`.deb`）、[Android15+ arm64](https://github.com/txsdx/ZhiNexus/actions/runs/40364552600/artifacts/12670582490)（`.apk`）。通过 CI 打包日志与上传元数据核对；当前云端 CLI 跟随产物存储重定向下载返回 HTTP403，未把本地 ZIP 读回描述为已验证。

- 已推送应用实现 `42ed542`；自动 Validate [40363335936](https://github.com/txsdx/ZhiNexus/actions/runs/40363335936) 全部通过。首轮编译 [40363350765](https://github.com/txsdx/ZhiNexus/actions/runs/40363350765) 的 Ubuntu 编译/DEB 打包成功，但原生网络测试仍等待旧 display_name，和本轮“原始 ID”要求冲突；已修正为检查精确原始 ID 并断言不展示 display_name。该次仅修改测试，不改变 0.9.0 应用实现；三平台重新验证全部成功，结果见上。

- `npm test` **60 项通过**，`npm run test:release` **26 项通过**；`npm run build`、Prettier 检查及 `git diff --check` 通过。构建仍有已有的大 chunk/混合静态动态 import 提示。
- `npx playwright test` **36 项全量通过**。新增原始模型 ID/全局默认动态继承、任务及助手显式覆盖、同步到另一副本与重启恢复；大类/子类/条目删除在等待、取消、关闭、Esc、遮罩及存储失败时核对完整文档和日志均不变，再验证明确确认后的原子迁移/删除与重启持久化。
- Tools true/null/false/目录缺失均检查实际请求参数；聊天、图片、OCR 的全局继承与思考等级经过单元回归。FSRS 黑→黄→红验证图例、实际词条渲染色、插值端点/中点和夜间配色，未复习保持未知。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过。当前云环境最初缺 PipeWire/SPA 与 Clang 开发包，已从环境配置的 Debian HTTPS snapshot 下载并解包到原有 sysroot；检查使用 `zhinexus-env.sh`、`LIBCLANG_PATH`、sysroot `LD_LIBRARY_PATH` 与 Clang resource-dir。仅补齐当前环境，未更改仓库依赖或假设环境草稿已发布。
- 确认根因：Tauri dialog 插件将 `window.confirm` 改为 async，DOM 类型仍为 boolean，旧 if 将 Promise 当作真。7 处旧调用全部改为统一应用内异步确认；图关系改在 React Flow 删除前拦截并等待提交，MCP 移除也增加确认。
- 追加全局/词条对话、图连线、草稿、MCP、云快照、设备设置取消回归；浏览器通过初始化脚本模拟原生 async confirm。源码扫描测试禁止再调用 window/globalThis.confirm。详细结果见 DELETION_AUDIT.md。
- 代码按用户授权推送到 main，提交署名 codex。没有真实 AI 账号兼容、Android 实体机或正式 Release 安装升级验证。删除专项由模拟原生 async confirm 的浏览器回归覆盖，实际打包程序的其他原生流程按上方 CI 记录验证。

## 0.8 最终验证（2026-10-26）

- **最终三平台构建与原生测试全部成功**：[run 40351587726](https://github.com/txsdx/ZhiNexus/actions/runs/40351587726)，源码/工作流 commit `3e0a655`。Windows `0.8.0` job `121673241120`、Ubuntu `0.8.0` job `121673241150`、Android `0.8.1` job `121673241234`，含缓存收尾全部完成；前端共享 job `121672794573` 成功。发布按本次输入跳过，未创建公开 Release。
- **自动 Validate 全部成功**：[run 40351498612](https://github.com/txsdx/ZhiNexus/actions/runs/40351498612)：48 单元、7 个脚本测试文件（25 个用例）、25 Chromium 浏览器集成、TypeScript/前端构建和 locked Rust check。此前本地 Rust 核心 8 单元通过；0.8 系列未改变这些核心逻辑。
- Windows/Ubuntu 真实打包程序覆盖快捷键实体按键录制、截图/本地 OCR 识别、非默认端口代理/模型请求、MCP stdio、富文本与源码编辑、系统/portable 隔离、清理后重启不重建恢复日志；再写入新条目并损坏主库/WAL/最新快照，从旧快照与新日志恢复全部新旧知识。
- Android 编译 arm64 发布 APK 与 x86_64 调试 APK，在 Android15/API35 KVM 模拟器实际安装并验证 SQLite 创建、富文本编辑、标签和内容强停重启恢复、页面宽度/底部导航、通知设置与 OS 排程。安全区域视口为 `412×842 CSS px @ 2.625`，系统栏/刘海留白由原生 WindowInsets 管理，截图通过 ADB 物理屏幕核对。没有 Android 实体机测试。
- 移动浏览器回归先复现长章节大纲造成的 83px 页面溢出和底栏点击失败，再验证修复后的触控导航、保存和重启。其余新增场景覆盖分类树/FSRS 着色、聚焦重复替换不删除外部章节、标签/草稿恢复、公式/图/本地图片保真、外部修改比较、脚注/HTML 源码保留、后台配图不覆盖后续输入。
- 手动入口只有 Build and release，全平台构建、可选发布/草稿。生产前端仅编译一次，各原生任务验证并复用相同提交的 344 个文件；npm/Rust/Gradle/NDK/镜像/打包器缓存启用。Android 不再恢复整套 root 所有权 SDK，最终日志权限警告为 0；模拟器启动前清理重复分区配置与不再需要的项目静态副本，保留 APK/SO 和依赖缓存。
- Ubuntu 源修复同时处理直接 URL 和 runner 的 mirror+file 清单引用。最终日志实际 URI 为 `https://archive.ubuntu.com/ubuntu`，Azure 下载为 0；本轮 103 MB 依赖下载用时 11 秒。下载和链接耗时仍受 runner 与网络影响。
- 按用户授权统一 main 历史的作者/提交者名称为 `codex`，保留原有邮箱、日期、消息与文件树，并使用显式远端预期 SHA 的 force-with-lease 推送；GitHub API 复核包含首次提交。后续提交也继续使用 codex。
- 本地 Kotlin Universal Debug 编译通过。原生自动化使用真实键盘选择/Return 换行并核对结果，点击标题按钮；重复运行识别自己的旧草稿与多个模糊匹配。云端 rootless PRoot 驱动使用 `PROOT_NO_SECCOMP=1` 避免子进程 EFAULT；GitHub 原生 runner 无该层。
- 安装包在本轮 Actions Artifacts：Windows `*_protable.exe` / `*_setup.exe`、Ubuntu `.deb`、Android arm64 `.apk`。未发布公开 Release；没有用户真实 AI/WebDAV/MCP 账号、正式安装升级或大型库验证。详细边界见 KNOWN_ISSUES。
- 0.8.0 完整通过记录保留于 [40326093484](https://github.com/txsdx/ZhiNexus/actions/runs/40326093484)，Android 安全区域补丁首次全组通过记录为 [40347026314](https://github.com/txsdx/ZhiNexus/actions/runs/40347026314)。最终以上方最新运行作为交付证据。

## 0.6 最终验证（2026-10-26）

- 新增 1–6 项已实现：统一“数据库与云同步”、云/本地可信并集与双向修复、实际读回比较摘要、安全恢复冗余清理、快捷键按键捕获、HTTP(S) 非默认端口权限。
- **最终三平台构建与测试全部成功**：[run 40293675525](https://github.com/txsdx/ZhiNexus/actions/runs/40293675525)，应用 commit `4e62a3d`。Windows job `121474479760`、Ubuntu job `121474479672`、Android job `121474479450`，包括缓存收尾全部完成。Artifacts 包含 `*_protable.exe` / `*_setup.exe`、`.deb`、arm64 `.apk`。
- Windows/Ubuntu 的真实打包程序均验证：物理按键录制与 Esc 取消、非默认目标端口原生模型请求、MCP stdio、截图/本地 OCR 识别文字、图片入库、SQLite 编辑、系统/portable 隔离、清理后重启不重建恢复日志；再写入新条目，损坏主库/WAL/最新快照后，由旧快照与新恢复日志共同恢复全部新旧条目。
- Android 编译 arm64 发布 APK 与 x86_64 调试 APK；Android15/API35 KVM 模拟器安装、原生 WebView/SQLite 创建、强停重启恢复、设备通知配置和 OS 排程通过。没有 Android 实体手机测试。
- 最终 Validate [run 40293497818](https://github.com/txsdx/ZhiNexus/actions/runs/40293497818) 全部成功：39 单元、22 发布脚本、19 Chromium 集成、前端构建和 Linux locked Rust check。本地额外 8 Rust 测试通过，包含自定义端口 URLPattern、三份快照覆盖条件和拒绝 symlink 清理。
- 校验只针对当前发布到云端的稳定集合；无法感知离线设备未上传的变更。无可信副本或持续并发时保留原件报错、不清理。清理保留历史、回收站、冲突、损坏原件和远端权威文件。
- 用户给定端点只做未认证只读探测：WebDAV HTTP 401；API 根路径 `/models` HTTP404，`/v1/models` HTTP401。未使用真实用户凭证，没有证明生产账号或全部接口兼容。原生权限修复必须安装本轮新包；AI 根地址通常应包含 `/v1`。
- 未发布公开 Release；安装包可从本轮 Actions Artifacts 下载。此前 0.5 记录仅作历史，见下。

## 0.5 历史验证（2026-10-26）

- **0.5.0 三平台全组成功**：[run 40277188343](https://github.com/txsdx/ZhiNexus/actions/runs/40277188343)，应用实现 commit `a5fe2856`。Windows job 121422345765、Ubuntu job 121422345746、Android job 121422345633 均成功；全部缓存收尾也已完成。
- Windows：真实 `*_protable.exe` / `*_setup.exe` 编译打包；短窗口设置可达、原生代理模型目录、官方 MCP SDK stdio、截图叠层/框选、系统 OCR（确实识别出文本）和图片入库、SQLite 编辑、普通/portable 隔离、重启、主库+WAL 损坏恢复全部成功。
- Ubuntu：真实 `.deb` 解包运行，同组原生代理/stdio/截图/Tesseract OCR/入库/恢复测试成功。
- Android：arm64 发布 `.apk` 与 x86_64 调试 APK 编译；Android15/API35 KVM 模拟器实际安装、原生 WebView/SQLite 创建、强停重启恢复、设备通知设置与 OS 排程成功。没有 Android 实体手机测试。
- 最新 Validate [run 40278495229](https://github.com/txsdx/ZhiNexus/actions/runs/40278495229) 全部成功：**37 单元、22 发布脚本、16 浏览器测试**及前端构建、Linux Rust check。该 commit `00c03271` 的额外改动仅为发布脚本/文档，应用实现与全平台测试版本相同。

- 本地 Rust 5 项测试覆盖双向目录迁移、保留源与旧目标、坏库不切换、嵌套路径拒绝和 stdio 帧限制；实际 UI/进程交接迁到 `_data`、原生辅助进程迁回系统目录成功，并验证占用源目录时拒绝切换。
- npm 运行时依赖 audit 0；cargo-audit 只剩未启用 rsa 的 RUSTSEC-2023-0071 与既有 GTK 上游 notices，没有忽略条目。具体范围见 KNOWN_ISSUES。
- 没有用户真实 AI/WebDAV/MCP 账号；模拟服务/本地 MCP/代理测试不等于生产账号、正式 Release 安装升级或大型库验证。**没有创建公开 Release。**

## 环境复用

install_script/start_skill 已更新并保存为云环境草稿；完整刷新脚本（npm ci、测试、构建、Rust check）成功，截图编译依赖与中/英文 OCR 数据可用。当前机器已验证；草稿保存不等于环境快照已发布，后续任务复用前需用户在环境设置中发布。
