# 需求完成情况

当前阶段：**0.3.0 开发版**。核心流程可运行，持续完善；未称为已满足所有故障、所有平台的正式版。实现、模拟服务、真实原生运行和生产集成分别记录。

| 需求 | 当前实现与验证边界 |
|---|---|
| 技术与模块 | Tauri 2、React/TypeScript、SQLite/Rust；core/services/pages/settings 与独立原生路径、恢复、捕获、更新模块 |
| 查询和便捷记录 | Fuse 模糊查询、重复复用、原始摘录保存、按任务自动解释/关系/归类；界面测试通过 |
| CPA/OpenAI 模型能力 | CPA 扩展与普通目录、有限回退、不猜能力；6 项契约测试；无真实账号验证 |
| 模型/深度/模板 | 每项 AI 任务独立模型和默认深度、能力约束、可修改模板及替换变量；配置同步 |
| 标准词条/渲染 | 双语/IPA、定义公式、适用边界、例/反例、误区、自测、前置；Markdown/GFM/KaTeX/strict Mermaid，手动编辑 |
| 图像 | 本地图片、工具栏 AI 配图模板确认和结果入库；真实图片提供商待验证 |
| FSRS/复习 | 到期队列、AI 简答/选择、评分补教、确认后补充遗漏；答案/题目/阶段持久化，界面重启验证 |
| 通知 | 各设备独立开关；Android 原生系统排程最多 48 个按分钟合并提醒，重启重建；桌面运行时提醒；桌面完全退出后台未实现 |
| 分类 | 大类/子类增删改移、循环防护、删除不删词条、递归计数；AI 前后树/数量/分配预览并确认；集成验证 |
| Agent/话题/MCP | 全局与词条独立话题、模型/深度、检索/编辑工具、写入确认、持久工具回执防重复、本地陈旧写防护；官方 HTTPS MCP、手动配置和开关，无真实 MCP 验证 |
| 本地同步架构 | SQLite、不可变操作、版本向量、多值字段 CRDT、因果闭包、SHA-256、Merkle/逻辑摘要；双离线浏览器、并行标签页、冲突恢复验证 |
| WebDAV | 强制 HTTPS、增量 payload、设备独立清单、定时同步；模拟服务并发收敛通过，无真实远端验证 |
| 完整性/修复 | SQLite 检查、三代验证快照、原生耐久日志、坏库隔离自动恢复；浏览器原子检查点；真实 Linux 损坏恢复通过。深度远端审计隔离修复、可信云快照合并恢复通过模拟测试 |
| 大数据 | 仍一事件一文件、全量名字发现和本地投影；有界日志块/增量子树/索引和规模性能未完成 |
| 数据库管理/备份 | 占用、VACUUM、检查点、完整云快照、AES-GCM 加密文件备份和合并恢复、回收站、通用冲突选择 |
| 配置同步 | 非敏感设置同步；密钥/MCP 可用独立密码加密 vault 显式分发；通知、周期为设备设置；本机密钥未接系统钥匙串 |
| 对象存储/专属服务端 | SyncTransport 接口预留，按用户要求不完整实现连接器 |
| 来源/审计 | Windows 快捷键普通 Ctrl+C 与前台进程文件名；X11 PRIMARY/可用 PID；回退明确未知。每项编辑记录、内容行差异、图片引用变化；截图未实现，Windows 捕获待实际 CI/交互验证 |
| 关系/前置 | AI 关联、点击创建或复用前置词条、React Flow 编辑/拖动/连线/删除、Dagre 自动排版 |
| 主题/布局/语言 | 桌面侧栏/紧凑布局、手机底部/顶部导航；日/夜/护眼、主题色、离线字体和字号；简中/English/系统；部分错误待双语化 |
| 图标 | 透明 RGBA 1024×1024 源图、Tauri 各尺寸；生成工具无法声明或选择 image-2.5，不能证明指定模型 |
| portable | 仅 exe 旁有 portable 普通文件时使用 _data（SQL、配置、恢复、WebView、更新）；否则系统 app-data；真实 Linux 隔离和恢复通过 |
| 编译目标/格式 | 手动 Windows 默认开，Android/Ubuntu 默认关，不构建 macOS；Windows *_protable.exe/*_setup.exe，Android .apk，Ubuntu .deb |
| Release/缓存 | 自动 GITHUB_TOKEN、可选发布/草稿；npm/Rust/Gradle/NDK/打包工具官方缓存；无用户密钥仍可发布，Android 开发证书不保障后续覆盖更新 |
| 更新/平台版本 | 统一 schema-2 latest.json；各平台 URL/版本/说明/摘要与可选签名；原生验证下载，系统安装器/Android授权/便携助手；共用 major.minor 独立 patch，版本脚本与 AGENTS 约定；尚无正式发布升级实测 |
| 用户失败 Action | 已查 Windows LGHT0311 中文 WiX 码页和 Ubuntu 中文包名错误；productName 改 ASCII、Windows 仅 NSIS、Ubuntu 仅 Deb；新推送后的 CI 需继续跟踪 |
| 协作/维护 | Git 本机 user.name=codex；文件/导出流程注释、Prettier/Rustfmt、版本规则、用户约定/状态/问题/日志/提示词、README/.gitignore |

## 验证记录（2026-10-26）

- `npm test`：**23/23**（核心、CPA、分类/通知、平台更新）。
- `node --test scripts/*.test.mjs`：**16/16**（目标选择、发布配置、Android、清单、独立版本）。
- TypeScript + Vite：通过；依赖仍有 chunk 大小提示。
- Playwright：**13/13**，包括复习、分类/Agent 确认、图片备份、并发同步、加密凭证、浏览器坏库恢复、分类改移删、远端坏块修复/云快照恢复、工具幂等回执。
- Rust Linux `cargo build --locked` 和 portable 路径单元测试：通过。
- 真实 Linux Tauri/WebKit WebDriver：SQLite 创建编辑、普通/portable 数据隔离、重启、主动破坏 SQLite 文件头、验证检查点+耐久日志恢复最新编辑并保留坏库：**通过**。使用已验证 Debian 库、Xvfb、proot 映射 WebKit 固定安装路径；未关闭 TLS 或 WebKit sandbox。
- Android API 35+ x86_64 debug APK（最新自定义安装器桥接、Rust/Kotlin）：**编译通过**。arm64 Release APK 也已编译通过，正在验证 0.3.0 缓存重建、开发签名和清单生成。
- 本机无 KVM，API 35 软件模拟器启动后不能稳定执行外部 shell/安装；未标记设备运行通过。已加入 GitHub 托管 KVM Android 测试和 Windows 原生 WebDriver 测试，仍需观察实际结果。
- Ubuntu 0.2.0 GitHub Deb 构建通过（run 40258520419，artifact ZhiNexus-ubuntu-24.04-x64）；Windows 仍在编译。正式发布与升级、真实 AI/WebDAV/MCP 未验证，不将模拟结果算作通过。

- 依赖安全迭代 0.3.0：Vitest 4.1.12、KaTeX 0.18.2（所有渲染链通过统一 override 去除旧版）；23 核心、13 浏览器复验及生产构建通过，npm audit 0 漏洞。CI 发现浏览器测试在异步保存完成前立即刷新，已增加保存确认再验证重载的断言，仍需新 CI 运行确认。Android setup Action 旧 tools 包不存在，已显式 packages: platform-tools，并扩大 SDK 缓存。

- 0.3.0：23 核心、16 发布脚本、13 浏览器测试及 TypeScript/Vite、Linux cargo check 通过。追加从实际 Deb 解包后在 Ubuntu/Xvfb 上运行恢复测试的 CI；该新增步骤尚需运行。

- Ubuntu 0.3.1（仅 CI/产物补丁）：实际下载并检查 0.2 Deb，包名 zhi-nexus、架构 amd64、依赖正常；发现 artifact 同时包含中间打包树，已收窄为仅 .deb/.sig，减少冗余上传。打包改为仅手动/API dispatch，push 保留 Validate。Windows/Android 仍为 0.3.0，不产生无意义平台更新。
- Android 0.3.0 arm64 Release APK、开发签名验证、aapt minSdk35/唯一 arm64-v8a/versionName0.3.0、最新 JSON 生成：全部通过；APK 约 38 MiB。
