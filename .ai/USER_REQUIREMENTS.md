# 用户约定（需求来源：2026-10-26 的项目委托）

品牌：知枢 / ZhiNexus。目标：帮助用户持续理解、记忆和关联新知识，支持电脑与 Android 离线使用、多设备同步。

技术：Tauri 2 + React + TypeScript + SQLite + Rust。优先 TS，原生边界与必要性能部分用 Rust。面向对象、模块化，每个源码文件有概述，函数/结构有注释。使用成熟开源库和稳定 API、兼容性版本范围。快速迭代期不要求兼容旧数据库结构，不能以此为借口静默删除用户数据。

完整功能清单以 STATUS.md 为索引：快速模糊查找；CPA/OpenAI 模型发现及显式能力；各任务模型与思考深度和提示词；FSRS 复习、AI 出题评分补教、上下文恢复、分设备通知；大类与确认式自动子分类；词条/全局独立 Agent 与话题、工具、手动 MCP；TLS WebDAV 的 Local-first 日志、版本向量、CRDT、内容寻址、Merkle 校验与快照；对象存储/专属服务端接口；加密文件备份恢复；快捷捕获、来源进程、编辑审计；标准双语词条、关联和前置条目；可编辑图、Markdown/LaTeX/Mermaid、附件和 AI 配图；GitHub 更新和手动编译发布；多布局/主题/色彩/字体缩放、简中/英语。

上传的 sync_cpa_to_copilot.py 只作为实现参考，未复制其中凭证、个人路径、固定模型映射或执行任何脚本。遵循其读取普通 /models?client_version=cpa、有限回退和不猜测能力的原则。

用户已授权直接实施，不为常规技术选择反复提问。遇到外部凭证、签名或平台权限不足时记录具体限制，完成其余工作。不得声称未验证功能已经可用。

## 后续交付约定（本次用户第 1–11 项）

- 透明 1024×1024 图标；请求 image-2.5。当前生成工具没有模型选择/模型身份字段，必须如实注明无法确认指定模型。
- 本机 Git 提交用户名 codex；已授权推送代码。修复用户实际失败的 Action，不能仅凭本地构建宣称 Windows 通过。
- Release 使用 GitHub 自动 GITHUB_TOKEN，不能将上传 Release 与可选软件签名密钥混淆。
- 手动勾选 Windows_latest_x64、Android_15+_arm64-v8a、Ubuntu_24.04+_x64，默认仅 Windows；不编译 macOS。后续第 9 项允许手动启用 Ubuntu，取代第 4 项暂时全部注释 Ubuntu 的要求。
- Windows 输出 *_protable.exe、*_setup.exe（保留用户拼写），Android .apk，Ubuntu .deb；发布内容不含测试数据库。
- 可执行文件同目录有普通文件 portable 时，所有应用持久数据及配置放同目录 _data；否则放系统用户应用数据目录。切换标记前退出程序，不自动合并两套配置。
- 使用官方 Action 缓存 npm、Rust、Gradle 与 SDK/打包工具；不缓存私有签名密钥。
- 各平台读取同一个最新 Release/latest.json，含平台版本、下载地址、摘要及更新内容，提供一键下载校验和系统安装流程。
- 所有平台 major.minor 相同、patch 独立。共享实现修改提升 shared 并重置各 patch；只改某平台则仅 bump 对应 patch。未来 AI 每次实现迭代必须更新版本，并更新本目录记录。

实现约定：push 执行 Validate，打包仅手动/API dispatch，避免平台专属补丁重复打包未选择平台。Ubuntu Artifact 仅含 .deb/.sig，不上传打包中间目录。
