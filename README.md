<div align="center">
  <img src="public/app-icon.png" width="86" alt="ZhiNexus icon" />
  <h1>知枢 · ZhiNexus</h1>
  <p>让零散的知识，生长为自己的理解。</p>
  <p>A local-first workspace for understanding, connecting and remembering what you learn.</p>
  <p><a href="#快速开始">快速开始</a> · <a href="#功能">功能</a> · <a href="#数据与同步">数据与同步</a> · <a href="#构建原生应用">原生构建</a> · <a href=".ai/STATUS.md">完成情况</a></p>
</div>

> **0.3 系列开发版 / Early development.** 核心学习流程、数据库滚动备份/日志恢复、便携目录与三平台更新协议已实现。Linux 原生恢复测试和 Android 编译通过；Windows、Android 设备测试与正式安装升级尚需 CI/真机验证。真实 AI/WebDAV 与大库性能未完成验证。完整边界见 [已知问题](.ai/KNOWN_ISSUES.md)。

## 功能

- **知识库**：离线 SQLite、模糊检索、分类标签、标准解释模板、Markdown / LaTeX / Mermaid、本地图片、AI 配图提示词预览。
- **理解式复习**：FSRS 到期队列，AI 简答/选择题、评分、补教与遗漏点补充；题目、答案和评分阶段持久化，可重开继续。
- **学习助手**：全局与每词条独立话题及上下文、模型/深度选择、知识库检索与编辑工具；写操作和 MCP 外部工具调用先确认。
- **AI 配置**：OpenAI-compatible Chat Completions、CPA 扩展模型目录和有限回退；未知能力不猜测。每项功能独立模型、思考偏好、可编辑提示词。
- **知识连接**：自动发现关联与前置知识，点击创建缺失前置条目；React Flow 可拖动、连线、删除关系、保存布局，Dagre 自动排版。
- **整理**：分类支持重命名、移动、删除并保留条目；AI 可提议子类；显示分类树与数量的前后对比，确认后才应用。
- **多设备数据**：HTTPS WebDAV 增量日志交换、版本向量、字段多值 CRDT、SHA-256 附件寻址、Merkle 和逻辑状态摘要、完整快照。
- **数据掌控**：数据库空间、深度完整性检查、远端坏块隔离修复、VACUUM、回收站、SQLite 滚动备份和耐久日志自动恢复、AES-256-GCM 加密文件备份及合并恢复。
- **舒适阅读**：简中/English 自动系统语言、日间/夜间/护眼、主题色、内置思源黑体/宋体、整体字体缩放、桌面和手机布局预设。
- **原生入口**：Tauri 2 + Rust、桌面快捷键选区捕获、Android 系统复习排程、Windows 便携模式、统一 Release JSON 和平台更新、可选目标的缓存构建。

新建条目会先保存原始材料；配置相应 AI 任务后自动解释、建立关联和归入已有分类。某步失败时原始数据仍保留。相同名称会打开已有条目，模糊匹配可手动选择相近概念。

## 快速开始

需要 **Node.js 24 LTS**、npm。浏览器模式不需要 Rust。

```bash
npm ci
npm run dev
```

开发服务器端口是 `1420`。使用桌面 Chromium / Chrome / Edge 等支持 WASM、IndexedDB、Web Crypto 的浏览器。浏览器模式的数据库存在当前浏览器配置文件中；请勿清除站点数据，并定期导出备份。该模式用于开发与体验，Android 目标为原生安装包，不依赖把浏览器页面作为后台运行应用。

```bash
npm test                    # CRDT / 加密 / FSRS / CPA / 更新元数据
npm run test:release         # 编译目标、发布配置、清单与版本约定
npm run build               # TypeScript + Vite 生产构建
npx playwright test         # 真实 Chromium + SQLite 集成测试
npm run format              # 统一代码格式
```

Playwright 默认使用本机 Chromium；没有 `/usr/bin/chromium` 时先 `npx playwright install chromium`，然后设置 `CHROMIUM_PATH` 为其可执行文件，或在配置中指定本机 Chrome 路径。集成测试使用模拟 HTTPS AI/WebDAV，而不消耗用户密钥。

## AI 与复习设置

1. 设置 → AI 与模型：填写以 HTTPS 开头的 **API Base URL（通常含 `/v1`）** 和普通 API Key。
2. 点击“读取模型与能力”，保存配置。
3. 设置 → 任务与提示词：逐项选择解释、出题、评分、分类、关联、助手和生图模型；深度默认按任务预设，只有目录显式声明支持时才发送。
4. 在复习队列中开始。没有 AI 配置时不会假造题目或自动给及格分。

模型发现首先读取 `/models?client_version=cpa`；只有 `400/404/405/422/501` 才回退一次到 `/models`。兼容 `models/slug` 和 `data/id`。401/403 不重试，不访问管理接口，不按模型名推断能力。预算型 thinking 元数据不会被擅自映射成 reasoning_effort。暂不支持 Responses-only 提供商或 Anthropic 原生协议。

MCP 支持官方 SDK 的 **HTTPS Streamable HTTP**；手动添加、默认关闭，Token 仅本设备保存。不运行本地 stdio 命令。启用的服务在对话时进行协议初始化及列出工具，每次实际执行均确认。

## 数据与同步

每台设备在设置中指定同一个 WebDAV HTTPS 根目录、用户名和应用密码。父目录需要已存在，账号需有 `MKCOL / PROPFIND / GET / PUT` 权限。同步周期可设为 0（手动）。原生使用受限 Tauri HTTP 插件；浏览器需要服务器允许 CORS 和相应方法/Authorization 头。

```text
<root>/
  events/<operation-sha256>.json    # 不可变操作；不覆盖其他设备的数据库
  blobs/<content-sha256>.json      # 图片等附件，按真实内容摘要命名
  devices/<device-id>.json         # 独立设备诊断清单，不是共享权威索引
  snapshots/<snapshot-sha256>.json # 手动完整快照
  quarantine/                     # 深度审计发现坏文件时保留副本
```

离线编辑后交换新增日志；同字段并发修改保留所有版本，可在词条历史中选择并合并。删除保留日志，数据库管理可恢复词条。同步不删除历史或远端附件。每次同步检查收到的数据及附件，并计算本地全库摘要；这不是一个跨所有设备的原子云端事务，设备需完成后续交换以收敛。

**同步的是学习数据与非敏感配置。** API Key、WebDAV 密码、MCP Token 默认留在本机；如需跨设备同步，可在“同步与通知”中设置独立保险箱密码，将已保存的全部凭证和 MCP 配置封装为 AES-GCM 密文，再执行同步。另一台设备同步后输入同一密码解锁；密码不会保存，忘记无法恢复。通知和同步周期仍是设备偏好。完整文件备份也会将凭证一起加密，可选择是否恢复。本机凭证目前保存在 SQLite，尚未接入系统钥匙串。WebDAV 上的知识正文和普通日志不做端到端加密，TLS 只保护传输；存储服务管理员仍可能读取内容。需要保密的用户应选择可信存储，并等待 E2EE vault 里程碑。

当前只有 WebDAV 连接器；对象存储和专属服务端预留 `SyncTransport`。采用这套日志架构而非直接同步 SQLite 文件，能保留并发编辑。Merkle 校验、快照和备份是可靠性机制的一部分，**不能承诺任何故障下绝不丢失**；仍需多副本备份、故障注入和规模验证。

详见 [架构与协议](.ai/ARCHITECTURE.md)。

## 构建原生应用

需要 Rust stable（建议当前 stable）、平台编译工具；执行：

```bash
npm ci
npm run tauri -- dev
npm run tauri -- build
```

Linux（Debian/Ubuntu）先安装 Tauri 2 依赖：

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf
```

目前发布目标为 Windows x64、Android 15+ arm64-v8a 与 Ubuntu 24.04+ x64。Windows 需要 Visual Studio C++ Build Tools 与 WebView2。macOS 不在本次构建目标中。详见 [Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/)。

桌面快捷键：`Ctrl/Cmd + K` 搜索；`Ctrl/Cmd + Shift + N` 打开捕获。Windows 在用户按下快捷键并释放修饰键后向仍处于前台的窗口发送普通 Ctrl+C，记录进程文件名；受保护窗口可能阻止复制。X11 优先读取 PRIMARY 选区及可获取的进程信息。其他情况回退剪贴板并标记来源未知。应用内使用当前选中文字；截图捕获仍待实现。

### Android

需要 JDK 21、Android Studio/SDK、NDK、`ANDROID_HOME` 与 `NDK_HOME`，以及 Rust 目标：

```bash
rustup target add aarch64-linux-android
npm run tauri -- android init --ci
node scripts/configure-android.mjs  # 最低 Android 15，安装器桥接与生成目录配置
npm run tauri -- android dev
npm run tauri -- android build --apk --target aarch64
```

`src-tauri/gen/` 是平台生成目录，不纳入版本控制。Android x86_64 调试 APK（含安装器桥接）已经编译通过，arm64 发布 APK 也已编译通过；设备测试状态见 STATUS。使用官方通知插件排程最多 48 个合并后的复习提醒；系统强制停止、权限与省电策略会影响通知，重启应用会重建排程。桌面完全退出后的排程尚未实现。

### Windows 便携数据

Windows 输出 `ZhiNexus_windows_x64_<version>_protable.exe` 和 `*_setup.exe`。使用便携包前，在 exe 同目录创建名为 **`portable`** 的空文件（没有扩展名）；程序的 SQLite、配置、附件、恢复日志、备份、更新暂存和 WebView 数据都放到该目录的 **`_data/`**。没有这个文件时使用系统用户应用数据目录。两种模式数据独立，切换前退出应用；数据库设置页显示实际路径。请将便携目录放在可写位置。

### GitHub Actions 与更新

在 Actions 的 **Build selected platforms → Run workflow** 中勾选目标：

| 选项 | 默认 | 发布产物 |
|---|---|---|
| Windows_latest_x64 | 开 | `*_protable.exe`、`*_setup.exe` |
| Android_15+_arm64-v8a | 关 | `.apk` |
| Ubuntu_24.04+_x64 | 关 | `.deb` |

默认只编译、不发布；勾选 `publish_release` 可发布，`draft_release` 决定是否草稿。macOS 不参与编译。push 只运行 Validate；安装包编译通过手动选择或 API dispatch 触发，避免修改配置时重复编译未选择的平台。

Release 使用 GitHub 自动注入的 `GITHUB_TOKEN` 和 `contents: write`，**不需要自行配置上传密钥**。npm、Rust 编译产物、Gradle、NDK 和 Tauri 打包工具分别通过官方缓存 Action 复用。首次构建和依赖变更仍需要编译。Android 还会构建不发布的 x86_64 调试 APK，在 API 35 模拟器测试重启、SQLite 与通知；Windows 原生测试验证真实 exe 的普通/便携隔离及数据库损坏恢复。

发布时生成同一个 [`latest.json`](https://github.com/txsdx/ZhiNexus/releases/latest/download/latest.json)：

```json
{
  "schema": 2,
  "commonVersion": "0.2",
  "publishedAt": "2026-10-26T00:00:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "version": "0.2.1",
      "notes": "Windows 修复内容",
      "artifacts": {
        "setup": {
          "url": "https://github.com/txsdx/ZhiNexus/releases/download/v0.2.1/ZhiNexus_windows_x64_0.2.1_setup.exe",
          "sha256": "<64 位摘要>"
        }
      }
    }
  }
}
```

另外的平台键为 `android-arm64` 和 `linux-x86_64`；artifact 类型为 `portable`、`apk`、`deb`。每项可含 `signature`。仅构建某平台时保留同一 major.minor 下其余平台的原版本、URL 和说明，应用只比较自身平台版本。设置 → 关于 → 检查更新 → 下载并安装：原生边界验证固定仓库 HTTPS 地址、SHA-256 和可选发布者签名，再启动 Windows/Ubuntu 系统安装器、Android 安装授权界面或 Windows 便携替换助手。系统安装仍遵循 OS 授权，不绕过权限。尚未完成正式发布包的端到端升级验证。

**软件签名是另一项配置。** 可选 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` Secrets 与 `TAURI_SIGNING_PUBLIC_KEY` Variable 为所有最终文件增加 Minisign 签名；配置公钥的应用拒绝缺失、错误或版本不符的签名。无发布者密钥时仍可构建、上传及使用 HTTPS/SHA-256 更新。Android 无自定义证书时生成可安装的开发证书；跨次运行证书不同，不能保证覆盖安装。正式连续更新需稳定 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEY_ALIAS`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_PASSWORD` Secrets，私钥不进入公共缓存。Windows Authenticode 代码签名未配置。

版本以 [`versions.json`](versions.json) 为准。共享 UI/领域/同步代码变化提升共同 major.minor；平台专属修复只提升对应 patch，避免其他设备无效更新：

```bash
npm run version:bump -- shared   # 如所有平台 0.2.x → 0.3.0
npm run version:bump -- windows  # 仅 Windows 0.2.0 → 0.2.1
npm run version:bump -- android
npm run version:bump -- ubuntu
npm run version:bump -- major
```

CI 从版本文件准备每平台的实际二进制版本。仓库 Release tag 使用各平台中最大的版本，不能用它替换每台设备自身的平台版本。每次修改实现都需更新版本和 `.ai/` 记录。

## 项目结构与协作

```text
src/core/        数据模型、SQLite、CRDT、摘要、FSRS、默认模板
src/services/    AI、CPA、WebDAV、Agent/MCP、捕获、设备集成
src/components/  共享控件与富文本
src/pages/       工作空间页面
src-tauri/       Rust 原生边界、配置、权限和图标
.ai/            AI 开发指令、用户约定、架构、完成情况、问题、更新日志
tests/          Playwright 场景测试
.github/        验证与手动编译发布工作流
```

以 [AGENTS.md](AGENTS.md) 为 AI/开发者入口。当前为快速迭代阶段，不要求旧版 schema 兼容；任何重建/破坏性数据操作必须显式处理，不能静默清空。依赖使用兼容主版本范围，`package-lock.json` 和 `Cargo.lock` 固定可复现构建。

项目尚未指定开源许可证；在作者选择许可证前，不应将代码描述为已授予开源再分发许可。
