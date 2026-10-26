<div align="center">
  <img src="public/app-icon.png" width="86" alt="ZhiNexus icon" />
  <h1>知枢 · ZhiNexus</h1>
  <p>让零散的知识，生长为自己的理解。</p>
  <p>A local-first workspace for understanding, connecting and remembering what you learn.</p>
  <p><a href="#快速开始">快速开始</a> · <a href="#功能">功能</a> · <a href="#数据与同步">数据与同步</a> · <a href="#构建原生应用">原生构建</a> · <a href=".ai/STATUS.md">完成情况</a></p>
</div>

> **0.7 开发版 / Early development.** 桌面后台/快捷键/OCR、数据目录迁移、全局代理、API Key 加密同步与独立通知设置已实现。0.6 的平台验证作为历史记录；本轮验证进展见 [验证记录](.ai/STATUS.md)。真实提供商、实体手机、正式升级与大型库仍需后续验证。

## 功能

- **知识库**：分类树表格、递归数量与折叠、模糊查询、标题/一句话解释/创建/上次复习时间；FSRS 遗忘估计用黑→红→紫显示，首次复习单独标记。
- **块编辑与多标签**：所见即所得与 Markdown 源码、大纲定位、块/章节聚焦、块移动、表格/任务/公式/Mermaid、本地图片与 AI 配图；按设备恢复标签和未保存草稿，后台配图保留后续输入。
- **理解式复习**：FSRS 到期队列，AI 简答/选择题、评分、补教与遗漏点补充；题目、答案和评分阶段持久化，可重开继续。
- **学习助手**：全局与每词条独立话题及上下文、模型/深度选择、知识库检索与编辑工具；写操作和 MCP 外部工具调用先确认。
- **AI 配置**：OpenAI-compatible Chat Completions、CPA 扩展模型目录和有限回退；未知能力不猜测。每项功能独立模型、思考偏好、可编辑提示词。
- **知识连接**：自动发现关联与前置知识，点击创建缺失前置条目；React Flow 可拖动、连线、删除关系、保存布局，Dagre 自动排版。
- **整理**：分类支持重命名、移动、删除并保留条目；AI 可提议子类；显示分类树与数量的前后对比，确认后才应用。
- **多设备数据**：HTTPS WebDAV 增量日志交换、版本向量、字段多值 CRDT、SHA-256 附件寻址、Merkle 和逻辑状态摘要、完整快照。
- **数据掌控**：数据库空间、深度完整性检查、远端坏块隔离修复、VACUUM、回收站、SQLite 滚动备份和耐久日志自动恢复、AES-256-GCM 加密文件备份及合并恢复。
- **舒适阅读**：简中/English 自动系统语言、日间/夜间/护眼、主题色、内置思源黑体/宋体、整体字体缩放、桌面和手机布局预设。
- **原生入口**：Tauri 2 + Rust、桌面快捷键选区捕获、Android 系统复习排程、Windows 便携模式、统一 Release JSON 和平台更新、全平台统一缓存构建。

新建条目会先保存原始材料；配置相应 AI 任务后自动解释、建立关联和归入已有分类。某步失败时原始数据仍保留。相同名称会打开已有条目，模糊匹配可手动选择相近概念。

块聚焦只编辑当前区域，完整文档仍保留；返回完整文档可继续浏览。遇到脚注或原始 HTML 时使用源码模式，避免有损转换。未保存草稿保存在本机，保存词条后才参与多设备同步与知识快照备份。编辑期间其他设备修改了正文，保存前会显示两版比较。

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

MCP 使用官方 SDK，支持 **Streamable HTTP、SSE、桌面 stdio**。配置协议、URL/令牌，或程序、JSON 参数数组、环境变量与工作目录。新服务默认关闭；从保险箱导入另一设备的 stdio 命令也默认关闭，需本机手动启用。每次 Agent 执行外部工具均确认。

## 桌面与通知

- “后台与快捷键”控制关闭窗口后常驻托盘、登录自启与三个全局快捷键。点击快捷键按钮后直接按组合键，Esc 取消，可分别禁用；录制时临时释放已有全局快捷键。Windows 自启为当前用户 Startup 文件夹中的 `ZhiNexus.lnk`；Ubuntu 使用 XDG autostart。
- 默认 `Ctrl+Shift+N` 捕获选中文本，`Ctrl+Shift+O` 框选截图 OCR，`Ctrl+Shift+Space` 显示主窗口。可修改，留空禁用；冲突时保留原有配置。
- OCR 默认使用 Windows 系统已安装语言或 Ubuntu Tesseract，结果可编辑；点击“AI 识别（上传截图）”才发送到所选视觉模型，OCR 模板可在任务设置修改。
- “通知设置”独立配置复习、失焦后的 AI/OCR 完成、同步失败、预览和最小间隔；各设备独立。Android 提醒由系统排程。
- “网络与代理”选择系统、HTTP(S)、SOCKS5，统一应用于 AI、MCP 网络协议、同步、图片与更新；stdio 子程序的网络由其自身环境变量配置。
- 启动读取系统 DPI 并跟随显示器变化；WebView 已处理缩放，不重复乘 DPI。默认文字增大，外观页可另调字体和系数。
- “数据库与备份”可迁移到程序旁 `_data` 或系统目录。预览确认后退出、逐文件 SHA-256 验证、SQLite 完整性检查，再切换 `portable` 标记并重启。保留源和旧目标备份；目录不可写时明确报错。

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

“数据库与云同步”统一管理连接、完整性校验、备份和恢复。点击“校验、修复并清理”会读取云端日志、附件及完整快照，与本地日志/恢复日志合并，保留离线修改，双向修复后重新读回并比较 Merkle 根与逻辑数据摘要。无可信副本或云端持续变更时保留原件、停止清理并提示重试。校验范围是当前已上传的数据，离线设备尚未上传的修改需之后同步。

校验成功后强制生成恢复点，仅清理三份已验证恢复点均覆盖的恢复日志副本，以及超过 24 小时的临时写入文件，并报告实际释放空间。历史日志、历史附件、冲突、回收站及损坏原件保留。portable / 系统目录迁移位于页内“存储位置与便携模式迁移”折叠区。API 与 WebDAV 支持 HTTPS 非默认端口；更新到新原生安装包后权限修复才生效。

**API Key 默认自动加密并同步，无需设置密码。** 默认 AES-GCM 使用程序内置的固定便捷密钥（随程序分发，不是保密密钥）；也可在“AI 与模型”填写自定义同步密钥，各设备使用相同值。API Key 与接口地址绑定，本地 SQLite 和恢复日志也保存密文。WebDAV 密码、MCP 配置可通过“数据库与云同步”的独立密码保险箱封存分发。通知、代理和同步周期按设备保存；备份可包含全部本机配置。知识正文仍是普通同步数据；未接入 OS Keychain。

当前只有 WebDAV 连接器；对象存储和专属服务端预留 `SyncTransport`。采用这套日志架构而非直接同步 SQLite 文件，能保留并发编辑。Merkle 校验、快照和备份是可靠性机制的一部分，**不能承诺任何故障下绝不丢失**；仍需多副本备份、故障注入和规模验证。

详见 [架构与协议](.ai/ARCHITECTURE.md)。

## 构建原生应用

需要 Rust stable（最低 1.88，建议当前 stable）、平台编译工具；执行：

```bash
npm ci
npm run tauri -- dev
npm run tauri -- build
```

Linux（Debian/Ubuntu）先安装 Tauri 2 依赖：

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf libpipewire-0.3-dev libgbm-dev libxcb-randr0-dev libclang-dev tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim
```

目前发布目标为 Windows x64、Android 15+ arm64-v8a 与 Ubuntu 24.04+ x64。Windows 需要 Visual Studio C++ Build Tools 与 WebView2。macOS 不在本次构建目标中。详见 [Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/)。

桌面快捷键：`Ctrl/Cmd + K` 搜索；`Ctrl/Cmd + Shift + N` 打开捕获。Windows 在用户按下快捷键并释放修饰键后向仍处于前台的窗口发送普通 Ctrl+C，记录进程文件名；受保护窗口可能阻止复制。X11 优先读取 PRIMARY 选区及可获取的进程信息。其他情况回退剪贴板并标记来源未知。应用内使用当前选中文字。截图支持框选、系统本地 OCR 与显式 AI 识别。

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

在 Actions 的 **Build and release → Run workflow** 运行一次，统一构建 Windows x64、Ubuntu 24.04+ x64 和 Android 15+ arm64-v8a：

| 平台 | 输出 |
|---|---|
| Windows | `*_protable.exe`、`*_setup.exe` |
| Android | `.apk` |
| Ubuntu | `.deb` |

入口只有 **Publish Release**（默认关闭）和 **Save Release as draft**（默认开启，发布时生效）两个选项。旧平台选择入口及转发 workflow 已删除；push/PR 保留自动 Validate。

前端在共享任务中只编译一次，以提交版本和 SHA-256 清单校验后交给三个原生目标。Windows、Linux、Android 的 Rust/系统工具链按各自 ABI 并行构建，不能共用原生二进制。npm、Rust、Gradle、SDK/NDK 和打包工具继续缓存；实际加速幅度取决于链接、下载和设备测试时间。

Release 使用 GitHub 自动 `GITHUB_TOKEN`，无需自行配置上传密钥；只有全部原生任务成功后才按所选发布/草稿参数上传。Android 会额外构建测试 APK，在 API35 模拟器测试原生块编辑、重启、SQLite 与通知；桌面测试验证真实 exe/DEB、块编辑、快捷键、OCR、便携隔离、清理及数据库/快照损坏恢复。

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
npm run version:bump -- shared   # 如所有平台 0.3.x → 0.4.0
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
