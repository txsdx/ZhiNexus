# 需求完成情况

当前开发版本：**Windows/Ubuntu 0.8.0、Android 0.8.1**。下面记录实际功能和验证范围；历史迭代见 CHANGELOG，限制见 KNOWN_ISSUES。

| 需求 | 当前实现 |
|---|---|
| 技术/模块 | Tauri 2、React/TS、SQLite/Rust，按领域、设置面板和原生边界拆分 |
| 捕获/查询 | 模糊查询、重复复用、快捷捕获与进程来源、桌面截图框选/OCR，原始材料先保存再 AI 整理 |
| AI | CPA/普通模型目录、显式能力、每任务模型/深度/可编辑模板；兼容地址规范化与去敏错误 |
| 块编辑/多标签 | Tiptap 所见即所得、大纲定位、持久块 ID、边界保护聚焦、表格/待办/公式/Mermaid；本机标签与草稿恢复、后台配图不覆盖后续编辑 |
| 知识列表 | 分类树表格、递归计数/折叠、标题/一句话解释/创建/上次复习时间；FSRS 估计黑→红→紫，未知记忆状态单列 |
| 词条/图 | 标准双语 IPA/定义/公式/边界/例子/自测/前置；Markdown/KaTeX/Mermaid、可编辑关系图、附件与 AI 图片 |
| 复习 | FSRS、AI 简答/选择、评分补教与遗漏补充确认、阶段/答案/上下文恢复 |
| 通知（23） | 独立页；按设备控制复习、失焦 AI/OCR 完成、同步失败、预览与间隔；Android OS 排程 |
| Agent/MCP（19–20） | 全局/条目独立话题上下文、确认式知识工具/外部工具、回执；HTTP/SSE/桌面 stdio，配置页位于提示词下方 |
| 分类 | 大类/子类编辑、递归计数、循环保护；AI 分类前后树和逐条分配确认 |
| 同步 | HTTPS WebDAV、不可变日志、版本向量、多值字段 CRDT、SHA-256 内容寻址、Merkle/逻辑摘要、增量 payload、审计修复和快照 |
| API Key（16/21） | 默认内置密钥 AES-GCM 自动落库/同步；可选自定义密钥，绑定 API 地址；WebDAV/MCP 整包密码保险箱另保留 |
| 代理（17–18） | 系统/HTTP/SOCKS5；覆盖所有应用内网络客户端，TLS 系统信任；stdio 程序依其环境 |
| 桌面（12/14/15） | 托盘后台、Windows Startup 快捷方式/Ubuntu XDG、全局三快捷键、DPI 观察/窗口适配、16px 默认正文 |
| 数据管理（13） | 占用/VACUUM/云端与本地双向校验修复/安全恢复冗余清理/备份恢复/回收站/冲突；应用内迁移两种目录，退出后校验复制、保留源与旧目标 |
| 发布（新 8，覆盖旧 22） | 一个 Build and release 手动入口，全平台编译、前端一次构建与校验复用；可选发布/草稿，保留自动校验与缓存 |
| 更新/portable | latest.json 独立平台版本/URL/说明、摘要/可选签名、平台安装器与便携替换；portable 标记统一 _data |
| 外观/语言 | 多布局、日/夜/护眼、主题色、离线字体/字号、系统语言/简中/English |
| 预留 | 对象存储/专属服务端 SyncTransport，按要求尚不完整实现 |
| 大库 | 一事件一文件、全名字发现和全日志投影；日志块/增量 Merkle 子树与规模测试尚未完成 |

## 0.8 本轮验证（包含 0.7 新功能）

- 本地 0.8 的 48 单元、23 发布/工作流脚本、25 Chromium 浏览器集成、TypeScript/前端构建与 locked Rust check 通过。新增真实移动视口回归先复现 83px 溢出与底栏点击失败，再验证修复后的触控导航、保存和重启。0.8.0 三平台最终构建与测试已通过，见下；Android 0.8.1 安全区域补丁仍待设备 CI 验证。
- **0.8.0 三平台全部成功**：[run 40326093484](https://github.com/txsdx/ZhiNexus/actions/runs/40326093484)，源码 commit `49de962`。Windows job `121583565081`、Ubuntu job `121583565305`、Android job `121583565083`，含缓存收尾完成。Validate [40326077599](https://github.com/txsdx/ZhiNexus/actions/runs/40326077599) 也全部通过。
- Android 0.8.0 已在 API35 KVM 模拟器通过富文本编辑、恢复标签/内容、移动页面宽度与导航、设备通知和 OS 排程；0.8.1 新增系统栏/刘海原生留白，Kotlin 本地离线编译通过，脚本用例增加到 25 项。仅 Android patch 更新，其他平台保持原版本。
- Rust 核心 8 单元和 0.7 本地原生全流程此前已通过；0.8 没有改变 Rust 核心逻辑，最终原生产物仍由三平台 CI 再验证。
- 新增浏览器场景覆盖树表格/FSRS 着色、聚焦后重复替换保护外部章节、标签/重启恢复、公式/图/图片保真、保存前外部修改比较、脚注/HTML 源码保留、后台配图与继续输入并发。
- 按用户要求统一历史作者/提交者名称为 `codex`，保留各次邮箱、时间、消息与文件树，已使用显式远端预期 SHA 的 force-with-lease 推送；GitHub API 复核包含首次提交。后续提交继续使用 codex。
- 原生测试使用实际键盘选择和 Return 换行，并核对输入结果；标题按钮作为表格导航目标，兼容 WebKit WebDriver。重复测试识别自己的旧草稿和多个模糊匹配。云端 rootless PRoot 驱动使用 `PROOT_NO_SECCOMP=1` 避免子进程启动的 EFAULT；GitHub 原生 runner 无此 PRoot 层。

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
