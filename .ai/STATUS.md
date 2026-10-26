# 需求完成情况

当前开发版本：**0.6.0（所有平台）**。下面记录实际功能和验证范围；历史迭代见 CHANGELOG，限制见 KNOWN_ISSUES。

| 需求 | 当前实现 |
|---|---|
| 技术/模块 | Tauri 2、React/TS、SQLite/Rust，按领域、设置面板和原生边界拆分 |
| 捕获/查询 | 模糊查询、重复复用、快捷捕获与进程来源、桌面截图框选/OCR，原始材料先保存再 AI 整理 |
| AI | CPA/普通模型目录、显式能力、每任务模型/深度/可编辑模板；兼容地址规范化与去敏错误 |
| 词条/图 | 标准双语 IPA/定义/公式/边界/例子/自测/前置；Markdown/KaTeX/Mermaid、可编辑关系图、附件与 AI 图片 |
| 复习 | FSRS、AI 简答/选择、评分补教与遗漏补充确认、阶段/答案/上下文恢复 |
| 通知（23） | 独立页；按设备控制复习、失焦 AI/OCR 完成、同步失败、预览与间隔；Android OS 排程 |
| Agent/MCP（19–20） | 全局/条目独立话题上下文、确认式知识工具/外部工具、回执；HTTP/SSE/桌面 stdio，配置页位于提示词下方 |
| 分类 | 大类/子类编辑、递归计数、循环保护；AI 分类前后树和逐条分配确认 |
| 同步 | HTTPS WebDAV、不可变日志、版本向量、多值字段 CRDT、SHA-256 内容寻址、Merkle/逻辑摘要、增量 payload、审计修复和快照 |
| API Key（16/21） | 默认内置密钥 AES-GCM 自动落库/同步；可选自定义密钥，绑定 API 地址；WebDAV/MCP 整包密码保险箱另保留 |
| 代理（17–18） | 系统/HTTP/SOCKS5；覆盖所有应用内网络客户端，TLS 系统信任；stdio 程序依其环境 |
| 桌面（12/14/15） | 托盘后台、Windows Startup 快捷方式/Ubuntu XDG、全局三快捷键、DPI 观察/窗口适配、16px 默认正文 |
| 数据管理（13） | 占用/VACUUM/备份恢复/回收站/冲突；应用内迁移两种目录，退出后校验复制、保留源与旧目标 |
| 发布（22） | 平台独立 workflow、勾选纯编译测试（默认 Windows）、全平台 Release（是否发布/草稿），缓存保留；自动 GITHUB_TOKEN |
| 更新/portable | latest.json 独立平台版本/URL/说明、摘要/可选签名、平台安装器与便携替换；portable 标记统一 _data |
| 外观/语言 | 多布局、日/夜/护眼、主题色、离线字体/字号、系统语言/简中/English |
| 预留 | 对象存储/专属服务端 SyncTransport，按要求尚不完整实现 |
| 大库 | 一事件一文件、全名字发现和全日志投影；日志块/增量 Merkle 子树与规模测试尚未完成 |

## 0.6 本轮实现与验证

- 实现新增 1–6 项：统一数据库与云同步、云/本地双向深度修复与一致性读回、安全恢复冗余清理、按键捕获、HTTP(S) 非默认端口权限。
- 本地检查：39 单元、22 发布脚本、19 Chromium 集成、8 Rust 测试与 locked Rust check、前端构建通过。本地 WebKit/Tauri 原生全流程通过（自定义端口模型请求、真实键盘录制及取消、MCP stdio、截图/识别出文字、图片入库、普通/portable 隔离、重启、主库+WAL 损坏恢复）。三平台 CI 编译验证进行中，以后续记录为准。
- 清理不删除远端权威日志/历史附件/损坏原件，不等于离线设备未来变更的全局原子一致；浏览器没有原生 recovery 文件目录可清理。

## 最终验证（2026-10-26）

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
