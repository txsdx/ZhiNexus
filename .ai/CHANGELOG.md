# 更新日志

## 0.4.0 · 2026-10-26

- 独立通知设置页：复习、失焦后的 AI/OCR 完成、同步失败、可选预览和间隔；Agent 每轮仅提醒一次。
- API Key 默认无密码 AES-GCM 加密落库/同步，支持自定义密钥、接口绑定与跨设备自动应用；修复异步密钥同步覆盖设备通知偏好的竞态。
- 原生网络改用系统证书根，支持规范化兼容 API 地址和 Key；系统/HTTP/SOCKS5 全局代理，保留去敏诊断。
- MCP 移至任务提示词下方，扩展 HTTP、SSE、桌面 stdio 与连接测试；导入程序配置默认关闭，进程/帧大小有界并清理。
- 桌面托盘常驻、Startup 快捷方式/XDG 自启、三项可配全局快捷键；截图框选、本地 OCR、显式视觉 AI 识别与可编辑摘录。
- 数据目录迁移预览、关闭后复制校验、保留源和旧目标、切换 portable 标记并重启。读取系统 DPI，默认字体从 14 增至 16px。
- 工作流拆分平台独立入口、默认 Windows 的纯编译测试入口、全平台 Release 入口；保留缓存和原生/Android 设备测试。

验证状态以 STATUS.md 为准；不将模拟提供商测试视为真实账号验证。


## Windows 0.3.3 · 2026-10-26

- 确认 GUI/渲染进程正常启动，但 WebView2 忽略继承的调试参数；通过 Tauri 公开 builder API 显式设置调试端口。
- 只在 TAURI_WEBVIEW_AUTOMATION=true 且额外指定有效端口时启用，绑定127.0.0.1；普通用户启动无调试服务，数据目录规则不变。


## Windows 0.3.2 · 2026-10-26

- GUI 原生启动失败没有控制台时，将 panic/回溯写入实际数据根的 recovery/native-startup.log；不进入同步内容，便携模式仍在 _data。
- CI 收集独立进程退出状态和 native startup 日志，用于定位 release exe 尚不能建立调试连接的问题，不将编译成功视为运行通过。


## Android 0.3.1 · 2026-10-26

- GitHub 已完成 arm64 发布 APK/签名及 x86_64 调试 APK 编译；设备测试首次因 runner 磁盘不足、无法解压 API35 镜像中止，尚未进入应用。
- 在 Android 专用临时 runner 删除无关 .NET/Haskell/Swift/CodeQL 预装工具，保留 SDK/NDK/JDK/Rust，预留镜像空间；缓存原厂测试系统镜像。
- 无论测试结果如何保留已生成安装包为 Artifact；失败测试仍阻止 Release 发布，不隐藏失败。


## Windows 0.3.1 · 2026-10-26

- 禁用更新插件可选 ZIP 解压依赖，保留 Rustls TLS/系统代理；项目仅处理直接 exe/apk/deb 更新，不启用 zip 格式。
- 修正 Windows 原生测试驱动生命周期和独立 WAL 损坏注入；纯测试修正不改变 Android/Ubuntu 二进制版本。


## Ubuntu 0.3.1 · 2026-10-26

- 仅上传 .deb/.sig，去除打包中间目录；实际检查 Deb 为 amd64、ASCII 包名、正确版本及系统依赖。
- 打包仅手动/API dispatch，push 保留 Validate，减少未选平台的重复构建。Windows/Android 维持 0.3.0。


## 0.3.0 · 2026-10-26

- 更新 Vitest 至 4.1.12、KaTeX 至 0.18.2 并统一传递渲染依赖，修复已报告的测试/公式依赖漏洞；npm audit 0 漏洞。
- 修复 Android SDK Action 默认安装已移除 tools 包的问题，显式安装 platform-tools；扩大 SDK/Rust/浏览器缓存。
- 浏览器 CI 在保存完成前刷新导致竞态：新增持久保存确认再重载断言。
- 清理旧 updater 调用路径与 Android 专属编译警告，保留统一 latest.json 平台更新入口。
- Ubuntu GitHub Deb 构建通过，并补充实际 Deb 解包后的原生恢复测试 CI。
- 0.2 arm64 发布 APK 编译通过；0.3 最终缓存构建/原生 CI 结果见 STATUS。

## 0.2.0 · 2026-10-26

- 透明 1024 图标和平台资源；工具无指定 image-2.5 选择字段，来源记录见 ICON.md。
- Windows/Android/Ubuntu 可选目标、默认仅 Windows、NSIS/portable EXE、APK、Deb；使用 GITHUB_TOKEN 发布，npm/Rust/Gradle/NDK/打包工具缓存。
- 修复实际 Action 的中文 WiX 码页和 Debian 包名错误，停用 macOS。
- portable 标记统一 _data 根，涵盖 SQL、配置、WebView、恢复与更新文件。
- SQLite 三代验证检查点、原生耐久日志、损坏隔离和自动恢复；浏览器原子检查点。
- WebDAV 深度审计、隔离坏块并从可信副本修复、云快照合并恢复。
- 分类重命名/移动/删除、递归计数、内容行差异、Dagre 自动图排版。
- Android 系统复习通知排程与重启重建；Windows 选区/进程、X11 PRIMARY 捕获。
- Agent 工具调用逐步持久化、原子本地回执与陈旧编辑保护，避免重试重复写入。
- 统一 latest.json 平台更新、独立补丁版本、SHA-256/可选发布者签名、Android FileProvider 安装授权、Windows 便携更新助手。
- 修正设置面板全部同时显示的条件渲染缺陷，补齐原生/设备 CI 测试。Git 本机作者 codex。

验证：23 核心、16 发布脚本、13 浏览器测试通过，TypeScript/Vite、Linux Rust 编译及真实 WebKit 便携隔离/坏库恢复通过，Android x86_64 debug（含安装器）编译通过。最终 arm64/CI 状态见 STATUS；真实服务和正式升级未验证。

## 0.1.0 · 2026-10-26

从仅含 README 的仓库建立首个可运行知枢工程。

- React/TypeScript/Vite 工作空间、Tauri 2 Rust 原生边界与受限插件权限。
- SQLite/WASM 浏览器降级、本地数据仓储、不可变日志、多值 CRDT、因果校验和哈希/Merkle 摘要。
- 知识库、模糊检索、可编辑 Markdown/公式/图、附件、前置/关联、图编辑、审计与回收站。
- CPA 模型读取、明确能力、按任务模型/思考和可编辑模板；捕获后按已配置任务整理；原始材料保留。
- FSRS、AI 出题/评分/补教、评分确认后追加知识、复习恢复。
- 全局/词条 Agent 与独立话题、知识工具、写入确认、官方 MCP Streamable HTTP。
- TLS WebDAV 增量同步与快照、加密文件备份/合并恢复、数据库管理和全集合通用冲突选择。
- 密码加密凭证保险箱，可选同步 AI/WebDAV/MCP 配置，跨设备显式解锁，保留设备通知偏好。
- 多布局/主题/字体/缩放/语言、原生剪贴板快捷键和运行期间提醒入口。
- GitHub 检查/签名更新入口、手动多平台编译和可选草稿发布 CI。
- 模块化设置页、AGENTS/.ai 用户要求/架构/状态/问题文档与 README。

验证：16 项单元测试、9 项浏览器集成测试通过（最终隔离服务运行30.1秒），覆盖同配置文件并行读写和加密凭证跨设备恢复。TypeScript/Vite 生产构建、Linux Rust check/debug build 通过。Linux 原生窗口启动受云机缺少固定位置的 WebKit helper 阻塞，未标为原生功能通过。真实服务、其他平台、后台提醒、物理损坏自修复和大库性能尚未验证/完成，见 STATUS 与 KNOWN_ISSUES。
