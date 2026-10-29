# 需求完成情况

当前正式版本：**Windows/Ubuntu/Android 0.19.0**；开发中：**三平台0.22.0**，累计新增107–114项布局、捕获、无Token更新、开源交互与Android缩放回归。下面记录实际功能和验证范围；历史迭代见 CHANGELOG，限制见 KNOWN_ISSUES。

| 需求 | 当前实现 |
|---|---|
| 技术/模块 | Tauri 2、React/TS、SQLite/Rust，按领域、设置面板和原生边界拆分 |
| 捕获/查询 | 模糊查询、重复复用、快捷捕获与进程来源、桌面截图框选/OCR，原始材料先保存再 AI 整理 |
| AI | 文本功能统一真实 SSE、持久任务队列/结果审阅、可自动保存并发限制；可空 tool_calls、本机去敏请求/拼接完整输出/错误日志；原始模型 ID、全局默认/覆盖；Tools 未知允许尝试 |
| 块编辑/多标签 | Tiptap、左大纲/顶部信息、持久块 ID、聚焦/表格/公式/Mermaid、右键/柔和背景色/位置导航；划词 AI/黄色高亮/加粗/复制；本机标签草稿恢复、后台配图审阅后插入最新草稿 |
| 知识列表 | 分类树四列表、递归计数/折叠、标题/一句话解释/紧凑创建/粗体下次复习天数；负数表示逾期，FSRS遗忘色黑→黄→红 |
| 词条/图 | 标准双语 IPA/定义/公式/边界/例子/自测/前置；Markdown/KaTeX/Mermaid、可编辑关系图、附件与 AI 图片 |
| 复习 | FSRS、已学习初始化、真实复习次数、可配置90%目标、遗忘曲线；AI简答/选择/评分补教，实际回忆四档自评；取消/换题/停止/迟到保护 |
| 通知（23） | 独立页；按设备控制复习、失焦 AI/OCR 完成、同步失败、预览与间隔；Android OS 排程 |
| Agent/MCP（19–20） | 全局独立聊天与词条右侧栏/话题抽屉、划词/未保存草稿上下文、23个软件工具（图工具CRUD/布局/取消/回执/并发专项已通过）、草稿编辑审阅、响应隔离回执；HTTP/SSE/桌面 stdio，配置页位于提示词下方 |
| 分类 | 分类树拖拽/直接删除、共用小树选择器、递归计数/循环保护；Enter默认保留子类/条目移上级，另可整树删除或取消；删除等待应用内确认，取消/关闭/失败不改数据；AI 分类前后树和逐条分配确认 |
| 同步 | HTTPS WebDAV、gzip 批次/原子检查点、SFTPGo 锁发布、版本向量/CRDT、Merkle/逻辑校验、自动压缩回收与审计修复 |
| API Key（16/21） | API/WebDAV/MCP 统一可选同步密钥；留空默认 AES-GCM 自动落库/同步，无手动封存/解锁；API 绑定接口地址 |
| 代理（17–18） | 系统/HTTP/SOCKS5；覆盖所有应用内网络客户端，TLS 系统信任；stdio 程序依其环境 |
| 桌面（12/14/15） | 托盘后台、Windows Startup 快捷方式/Ubuntu XDG、全局三快捷键、DPI 观察/窗口适配、16px 默认正文 |
| 数据管理（13） | 占用/VACUUM/云端与本地双向校验修复/安全恢复冗余清理/备份恢复/回收站/冲突；应用内迁移两种目录，退出后校验复制、保留源与旧目标 |
| 发布（新 8，覆盖旧 22） | 一个 Build and release 手动入口，全平台编译、前端一次构建与校验复用；可选发布/草稿，保留自动校验与缓存 |
| 更新/portable | 启动后台检查/下载/缓存重验，Windows正常退出静默更新；latest.json独立平台版本/URL/说明、摘要/可选签名、Windows单文件直接替换、Android/Ubuntu系统安装授权；portable 标记统一 _data |
| 配置 | 所有设置自动保存、独立校验、待保存状态/失败重试、并发变更保留 |
| 外观/语言 | 多布局、日/夜/护眼、普通文本与说明/占位纯黑（夜间白色）、主题色、离线字体/字号、系统语言/简中/English |
| 预留 | 对象存储/专属服务端 SyncTransport，按要求尚不完整实现 |
| 大库 | 有界压缩日志块、已知批次跳过下载；仍有批次/附件全名字发现和全日志投影，增量 Merkle 子树与超大库验证待完成 |

## 0.22 当前迭代（尚未发布）

逐项以[ACCEPTANCE_022](ACCEPTANCE_022.md)为准。完全匿名公开Release直链、移除所有更新Token/构建注入；Android viewport与生命周期重复禁用整页缩放；命令面板与快捷键帮助、捕获Markdown工具/预览、持久逐话题聊天草稿/导出/再次提问、任务筛选、知识批量移动/原子删除、星图查找和复习间隔已接入。开源参考见OSS_UX_RESEARCH。本地227单元/39脚本/生产构建/locked Rust check/3匿名更新边界通过；浏览器与截图证据见ACCEPTANCE_022。正式交付待三平台构建、Windows完整实包及Release资产读回。0.21以下记录为历史，不再作为当前设计（可选私有认证已删除）。

## 0.21本轮进度（待Windows关闭/恢复完整复验及发布）

应用/标签源码`d96b75926788060ddbe99275ee9106ca4d29b588`，三平台0.21.0。用户选择先按公开仓库发布；ReleaseClient公开匿名优先、可选私有构建凭证、TLS/仓库/CDN/摘要/签名边界保留。已失效源码凭证已移除。recovery-020-native已按用户要求删除本地和远端，远端当前仅main。

[Build40915600674](https://github.com/txsdx/ZhiNexus/actions/runs/40915600674)：前端218单元/38发布脚本/93浏览器及生产构建成功；Ubuntu15原生/DEB、Android arm64编译/签名/包成功；Windows14原生和EXE编译成功。真实Windows公开更新读取已通过，快捷键/置顶/缩放/系统剪贴板图片也已执行通过；新增关闭测试用固定标题FindWindow未匹配到已显示的窗口，停止在WM_CLOSE之前，不能称完整实包通过。

只修测试封装：使用测试拥有的进程ID和唯一可见置顶窗口发真实WM_CLOSE；不依赖会被WebView改写的标题，保存断言不依赖中文提示，保留关闭/恢复/持久化/存储/损坏恢复/helper等全部断言。应用src/src-tauri/包/版本相对上述标签无变更。38脚本在标准Build配置下通过。

本轮仅从main进行原包复验/上传，不再创建临时分支或重新编译；固定原Build三平台源码/包的SHA-256，完整Windows验收成功才允许发布。临时原包完成配置结束后恢复标准三平台Build。当前v0.21.0仍为草稿，正式发布和Release资产读回待完成。窗口截图及关于页五宽度/自动保存重载已再次检查。

## 0.20 本轮进度（Actions账号额度阻塞，未正式发布）

107–109已实现，应用/标签源码`a3eb9ac5e097be1c122bba46cdcc804d0fe5a08c`，三平台0.20.0。关于页五宽度截图/无溢出/自动保存重载、媒体/MD/TXT/DOCX导入、完整本机草稿、默认置顶可缩放独立窗口与单写入者保护均已接入并通过本地专项。

[Build40907744178](https://github.com/txsdx/ZhiNexus/actions/runs/40907744178)前端218单元/36脚本/93浏览器全量及生产构建、Ubuntu13原生/DEB、Android arm64编译/签名/包验证成功。Windows8原生和单文件编译成功，但新增烟测在预期拒绝主窗口capture_request时，被通用驱动错误地将HTTP200脚本值的error字段当成WebDriver协议异常。该程序拒绝是正确行为；测试封装需按HTTP失败状态识别协议错误，新增两项回归后38发布脚本通过。

不重新编译或重复前端门禁：固定原Build三平台实际包及摘要，仅重跑Windows实包与发布。测试修复主分支`4fea15bf933379227f72e7f9ea4c3f3403f1fbc8`，与应用标签的src/src-tauri/包锁/版本文件完全一致，新增两项协议回归后38发布脚本通过。恢复分支`recovery-020-native`的`5d3322a3f03034b0d1d1c4db76d9e772d75ffff5`保留原包校验和复验入口，无编译/前端重跑，只有Windows完整验收成功才上传到现有草稿。

恢复Run [40911810320](https://github.com/txsdx/ZhiNexus/actions/runs/40911810320)与[40911901294](https://github.com/txsdx/ZhiNexus/actions/runs/40911901294)均在任何步骤启动前被GitHub账号计费检查拒绝，annotations原文：`The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings`。两次均未运行测试/编译，不是新的业务失败；后一次同时使用完整测试修复SHA固定检出。需账号恢复额度/付款或提供可用Windows执行环境后继续，不擅自降低门禁或将草稿转正式。

v0.20.0目前为现有空资产草稿（ID428089853），未正式发布；未完成Windows新增快捷键/置顶/缩放/OS关闭/系统图片剪贴板交互、后续存储/恢复与实包helper全套复验。本轮已实际下载三平台Build产物，WindowsPE0.20.0/x64，APK0.20.0/API35/arm64（普通/圆形/自适应和15图标像素通过），DEB0.20.0/amd64。首次Windows启动首帧854ms，进程+驱动4259ms，仅单次CI样本。

|原Build文件|实际字节|SHA-256|
|---|---:|---|
|Windows protable EXE|32,267,776|`5be8736692607898a378dff9cd6b8a4735307baf17fc3d2425a6dd25b04e7029`|
|Ubuntu DEB|25,488,152|`6bc406856db7180764cdada9b99e75d4c2714fc553badb23d4cf752e76ec1ba8`|
|Android development APK|41,016,115|`f5d2922a9996fbb08837cf5e93b06dc659bbefd09032a306edfc28c5eeb57430`|

历史恢复入口已废弃并按用户要求删除分支。后续Run40913753294揭示旧更新Token失效，见0.21：从main构建原生修复新包，不能继续发布上述0.20原包。

## 0.19 最终验收（2026-10-29，北京时间）

- **正式[v0.19.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.19.0)已发布**，北京时间21:19:24，非草稿/非预发布，三平台均0.19.0。打包应用源码与标签`e21ae1d835055ef4c38558700148309591698051`。后续主分支仅修复构建参数/加入实际CLI回归和文档，未更改应用负载。
- 新增101–106：Windows单文件直接替换更新及体积优化；完整分类路径+独立修改按钮；全库AI依赖/递进/关联提案、流式批次/逐条确认/普通关联升级/DAG与过期保护；6图工具（共23工具）；左键框选整组拖动与原子持久保存；菜单醒目色块和柔和实际背景。完整106项见ACCEPTANCE_019、初始提示词。
- 本地205单元、最终36脚本（含实际Tauri CLI参数解析）、87浏览器全量、生产构建、locked Rust check与12原生边界通过；浅/深色、分类路径及星图截图已检查。
- [原Build40874288806](https://github.com/txsdx/ZhiNexus/actions/runs/40874288806)：前端205/35/87及构建、Ubuntu11原生/DEB、Android arm64编译/包/签名成功；Windows6边界成功，但后续Tauri参数错误阻止打包。错误是将Cargo profile当成Tauri参数，已改为`--no-bundle -- --profile release-windows`，真实CLI解析回归补齐。
- [仅Windows恢复40878124395](https://github.com/txsdx/ZhiNexus/actions/runs/40878124395)：Windows Job123462141290与发布Job123470761838全部成功，含缓存收尾。固定同一应用源码、密封前端；DEB/APK按实际固定摘要复用，没有重编或再跑前端全量。正式前确认四资产后再发布，未将原失败Run称作全绿。
- Windows6边界、真实exe的系统/portable数据隔离、快捷键/代理/模型/SSE/MCP/OCR/SQLite、清理/重启/主库+WAL+最新快照损坏恢复、实际helper替换两种模式/保留数据与标记/拒绝坏摘要全部通过。下载文件名protable不再改变默认数据模式。
- Windows exe从0.18的39,344,640字节（37.52 MiB）降至31,886,336字节（30.41 MiB），整体减少18.96%；编译期opt-level=s/thin LTO/裁符号，无运行时解压器。本次CI首次首帧937ms，后续377/352/384ms；驱动+启动合计4326/1197/1006/1041ms。0.18首帧1194ms、后续479/355/352ms；CI样本未见明显退化，不作跨硬件固定速度保证。
- 实际APK读回：0.19.0、API35、arm64，普通/圆形/自适应绑定、21dp安全区与15张启动图标像素全部符合软件图标。无模拟器；Ubuntu本轮未重复按需GUI验收。真实服务、实体手机及旧安装版首启等边界见KNOWN_ISSUES。
- 三包+latest.json四资产均实际下载读回，字节/SHA-256/平台版本/最终URL/源码tag全部一致；更新清单不含Windows setup。普通提交不触发测试，仅Build前集中执行。

|资产|字节|SHA-256|
|---|---|---|
|ZhiNexus_0.19.0_amd64.deb|25,288,072|`ef4f444f95c924d51421f02863d5d61d90e2c00908f8e9d851e82c2bf5a126a5`|
|ZhiNexus_android_arm64_0.19.0_development.apk|40,901,427|`d07353cedcf08bac397312fcf442d39c734df602f4ba2b7c782619d2201b90f2`|
|ZhiNexus_windows_x64_0.19.0_protable.exe|31,886,336|`4173419495ee2a45818a4e35e8d014dfd931473dc84012653b95fce1da299e9c`|
|latest.json|83,515|`e2562eb72471581c5f13cb816c9b98f38d04acf8330c9dec3b6c4e2429106ca6`|

## 0.18 最终验收（2026-10-29，北京时间）

- **正式 [v0.18.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.18.0) 已发布**，北京时间2026-10-29 03:01，非草稿/非预发布。打包源码 `4dbce9e906888e6f3bdbad17ab8b8f9e60fb3566`；后续主分支补齐发布脚本/诊断路径修复与文档，未替换已验收的安装包。
- [Build 40745624446](https://github.com/txsdx/ZhiNexus/actions/runs/40745624446) 的前端、Windows、Ubuntu、Android四个构建任务全部成功。191单元、31脚本、84浏览器全量、生产构建、5项原生更新回归及Windows真实实包验收通过；Android arm64 Kotlin/原生编译和签名验证通过，无默认模拟器。
- [Ubuntu最终DEB按需验收40747896404](https://github.com/txsdx/ZhiNexus/actions/runs/40747896404) 全部通过：代理/模型/真实SSE、MCP stdio、快捷键/OCR、SQLite、portable隔离、清理/重启/三种损坏恢复，以及窄表格三个位置命中和真实点击。首轮GTK覆盖式水平滚动条问题已修复，并未以移出默认测试冒充修复。
- 原Build的发布Job403失败历史保留；修复“按tag接口404不返回草稿”的识别后，本地最终33脚本全部通过（含新增2项发布恢复回归），真实草稿识别也通过。[仅上传40750299527](https://github.com/txsdx/ZhiNexus/actions/runs/40750299527) 成功复用相同四个已验收产物，逐个复核固定SHA再上传，没有重跑测试/编译。当前云环境直接上传域名认证401，因此经Action上传；正式发布/读回成功，不把旧失败Job称作全绿。
- Windows protable/setup、Ubuntu DEB、Android APK、latest.json共5资产均实际下载读回。三平台0.18.0、4个最终URL、安装包实际字节/资产/清单SHA-256、清单自身摘要、Release标签源码全部一致。Android Manifest普通/圆形图标引用、adaptive安全区与15张图标像素均核对通过；旧双色圆环确认来自v0.17 APK内Tauri模板。
- 100条复现规格/证据映射见初始提示词与ACCEPTANCE_018；本轮交互清单见ITERATION_018。README从211行精简为65行。所有文档已更新到最新“仅Build前测试”规则，普通提交不触发测试。真实服务、实体手机手势、开发签名覆盖安装等限制见KNOWN_ISSUES。

## 0.17 本轮验证（2026-10-28）

- **正式 Release [v0.17.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.17.0) 已发布**（非草稿/非预发布），北京时间 2026-10-28 22:38，打包源码 `2f6a240`。Windows protable/setup、Ubuntu DEB、Android arm64 开发签名 APK 与 latest.json 共 5 项资产已上传；读回清单后，三平台版本、四个 URL/安装包 SHA-256 与清单自身摘要全部一致，Release tag 指向该源码。
- 最终 [Build and release 40706301585](https://github.com/txsdx/ZhiNexus/actions/runs/40706301585) 全组成功：前端 `122879253485`、Windows `122879703534`、Ubuntu `122879703839`、Android `122879703652`、发布 `122885147531`，含上传与缓存收尾。Windows/Ubuntu 真实打包程序的存储/恢复测试通过；Android 仅 arm64 编译与签名/包验证，无模拟器/x86_64 测试。
- 最终 [Validate 40706281174](https://github.com/txsdx/ZhiNexus/actions/runs/40706281174) 全部成功：145 单元、27 发布脚本、73 浏览器全量、4 原生认证回归、前端构建与 locked Rust check。正式发布说明已补全本轮变化、统一更新客户端要求和 Android 开发签名边界。

- 创建日期/更新时间改为两行小字；默认 Android Action 移除模拟器、x86_64 APK、KVM/镜像缓存，保留 arm64 编译与签名验证。压缩同步、SFTPGo 原子发布与旧文件回收已实现。
- 最终本地 145 单元、27 脚本、73 Playwright 全量、前端构建、locked Rust check、4 原生认证回归全部通过；修改文件格式/差异检查通过。资源密集测试与多个浏览器/原生构建同时运行时首轮触发 5 秒超时，隔离运行全量通过，并将两项千条规模测试单独设置 15 秒预算，保留全部断言。补查已修复“无可信副本前先替换损坏记录”的风险，回归保证修复事务前阻止。
- 真实本地 SFTPGo 2.7.6 复测通过：3 客户端并发、清理后离线合并、新设备重建、附件和真实 gzip；1007 操作、7 packs、1 checkpoint，368829 字节正文压至约 56 KB。没有访问用户自建服务器。三平台构建和正式发布均完成，证据见本节开头。

## 0.16 本轮验证（2026-10-28）

- 实现词条标题同行信息、历史/编辑旁直接 AI 入口和返回词条；复用已有独立会话与草稿机制。109 前端单元、26 脚本、前端构建、locked Rust check、4 原生认证测试、修改文件格式与差异检查通过；新增 2 项浏览器专项通过，覆盖 320–1920px、词条/全局会话与请求上下文隔离、返回草稿。首轮发现 768px 且侧栏展开时固定网格溢出 19px，改为按实际内容宽度自动排列后专项通过。本地 71 项浏览器全量全部通过；构建 40686599384 的 Windows/Ubuntu 完成，Android 与发布被取消；没有 v0.16.0 Release。用户追加云同步整理、Action 提速和时间排版要求，合入后续 0.17 交付。

## 0.15 本轮验证（2026-10-28）

- **正式 Release [v0.15.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.15.0) 已发布**（非草稿/非预发布），北京时间 2026-10-28 18:29，打包源码 `5a9ff7e`。Windows protable/setup、Ubuntu DEB、Android arm64 开发签名 APK 与 latest.json 共 5 项资产均已上传；三平台版本、四个 URL/安装包 SHA-256 与更新清单自身摘要全部一致。
- 最终 [Build and release 40670260740](https://github.com/txsdx/ZhiNexus/actions/runs/40670260740) 全组成功：共享前端 `122754930954`、Windows `122755419330`、Ubuntu `122755418985`、Android `122755418989`、发布 `122762558644`，含上传和缓存收尾。Windows/Ubuntu 实包及 Android15 模拟器均验证真实 SSE、自动标题和任务自动清理，三平台内置认证读取私有 Release/清单成功；已有存储/重启、桌面 OCR/stdio/恢复、Android 通知排程也通过。
- 最终 [Validate 40670241059](https://github.com/txsdx/ZhiNexus/actions/runs/40670241059) 全部成功：109 前端单元、26 脚本、69 浏览器全量、4 原生认证测试，前端构建与 locked Rust check。本地同组全部通过，聊天专项 8/8；未降低断言或关闭 TLS 校验。Release 说明保留 Android 开发签名与实体手机/安装升级边界。
- 已实现全窗口聊天、独立滚动/底部跟随、右对齐提问、下置模型框、自动标题/手动优先、独立草稿、查询免确认与聊天任务自动清理；移除开场和全局侧栏口号，增加“同步过时：”标题。开源交互参考见 CHAT_UX_REFERENCES。
- 最终本地 **109 前端单元、26 脚本、69 Playwright 全量回归、前端构建、locked Rust check、4 原生认证测试与修改文件格式/差异检查全部通过**。新增聊天 8 项覆盖布局、真实分块输出/历史位置、查询免确认、标题竞争/重载、输入法与草稿、移动导航、停止后的迟到响应。首轮 67/68 暴露正式回复与延迟快照短暂重复，使用共享响应标识修复后专项 7/7 和全量 68/68 通过；补查确认删除后的草稿切换也已通过。首轮云端 Validate 40668947078 也全部通过。构建 40668961231 的 Ubuntu DEB 编译成功，但原生点击测试发现模型成功提示浮窗挡住底部发送按钮；已把聊天提示移至消息区上部且文字不拦截点击，8 项聊天专项（含桌面/手机提示显示时发送）通过，主动取消其余构建以纳入修复。修复后最终本地全量 69/69、云端最终 Validate、三平台实包及正式发布均已通过，最终证据见本节开头。

## 0.14 本轮验证（2026-10-28）

- **正式 Release [v0.14.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.14.0) 已发布**（非草稿/非预发布），北京时间 2026-10-28 15:51，打包源码 `07f65b1`。Windows protable/setup、Ubuntu DEB、Android arm64 开发签名 APK 与 latest.json 共 5 项资产均已上传；读回清单并核对三平台版本、四个下载 URL/安装包 SHA-256 和清单自身摘要全部一致。
- 最终 [Build and release 40651251662](https://github.com/txsdx/ZhiNexus/actions/runs/40651251662) 全组成功：共享前端 `122691586825`、Windows `122691929257`、Ubuntu `122691929273`、Android `122691929449`、发布 `122696523167`，含上传/缓存收尾。三个平台实际安装程序都通过内置凭证读取私有 Release/下载 latest.json；Android15 模拟器补充系统 CA 后成功完成 HTTPS 更新检查，既有存储/重启/通知/SSE 等实包测试也通过。安装程序启动及连续签名升级边界仍见 KNOWN_ISSUES。
- 最终 [Validate 40651251426](https://github.com/txsdx/ZhiNexus/actions/runs/40651251426) 全部成功：102 前端单元、26 脚本、61 浏览器全量、4 原生认证回归，前端构建与 locked Rust check。本地同组通过，计时专项连续三轮 9/9；修复未降低断言或关闭 TLS 校验。
- 大纲标题和全部内容块共用的定位改为显式 `instant`，取消平滑滚动；保留退出聚焦后等待文档渲染再定位。
- 本地 99 单元、26 脚本、58 浏览器回归、前端构建、locked Rust check、格式/差异检查全部通过。实际浏览器长文档验证：即使根元素配置平滑滚动，标题和内容块定位也在第一帧直接到位，连续 6 帧位置不变。
- 已快进合并远端新增参考文件提交 `bb3392e`，保留其内容，未执行参考脚本。三平台构建与正式发布已完成，证据见本节开头。
- 用户追加内置 GitHub PAT：已验证私有 Release/清单读取，并完整下载当前 Ubuntu 安装包（25,966,356 字节）核对 SHA-256。原生 API 限定指定仓库、重定向到 CDN 不携带认证，Rust 4 项认证/跳转/资产路径回归通过，前端原生 IPC 3 项回归通过。CI 身份不具备 Actions Secrets 权限，按用户明确授权将该单一凭证内置原生源码文件；不进入网页、AI 请求、应用日志或 URL。
- 用户追加同步交互：移除自动同步完成浮窗，新增右上角成功同步间隔计时及点击立即同步；3 项浏览器专项通过，覆盖每秒计时、重载/移动端、防重入、成功重置、失败保留和自动完成无浮窗。此前大纲发布构建 40644481700 主动取消以纳入追加要求。
- 追加修改后的最终本地 102 前端单元、26 脚本、61 浏览器全量回归、4 原生认证单元、前端构建与 locked Rust check 全部通过；修改文件的 Prettier/Rustfmt、脚本语法和差异检查通过。原仓库 `mcp.rs` 有一处既有 Rustfmt 差异，未因本轮修改重写该文件。
- 首轮追加构建 40646799692 的 Windows/Ubuntu 实包都成功读取私有 Release/下载清单；原生 Validate 40646799314 通过 4 项认证回归。浏览器 60/61 通过，新增自动同步测试未暂停时钟、CI 启动耗时使精确秒数断言失败，改为暂停时钟后加载页面，连续三轮 9/9 通过。Android About 更新测试未返回清单；依赖检查确认 Unix CA 探测只识别 Termux 路径，补 Android Conscrypt/APEX 与系统 CA 目录读取，并保留更新错误到页面方便诊断后，最终 Android 实包和全平台发布均成功。

## 0.13 本轮验证（2026-10-27）

- **正式 Release [v0.13.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.13.0) 已发布**（非草稿/非预发布），北京时间 2026-10-27 18:44，打包源码 `af7cf79`。Windows protable/setup、Ubuntu DEB、Android arm64 开发签名 APK 及 latest.json 共 5 项资产均已上传；已读回清单并校验三平台版本、四个下载 URL/安装包 SHA-256 与清单自身摘要全部一致。
- 最终 [Build and release 40489154837](https://github.com/txsdx/ZhiNexus/actions/runs/40489154837) 全组成功：共享前端 `122138421219`、Windows `122138757148`、Ubuntu `122138757128`、Android `122138757035`、发布 `122143697751`，含缓存/上传收尾。Windows/Ubuntu 实包测试通过真实 SSE（结束前可见部分输出）、快捷键/OCR、代理/模型/MCP、SQLite、portable/系统隔离、清理/重启/损坏恢复；Android15 模拟器通过存储/编辑/重启/移动界面/通知与 OS 排程、真实 SSE 对话和任务确认清除。
- 最终自动 [Validate 40489155626](https://github.com/txsdx/ZhiNexus/actions/runs/40489155626) 全部成功：99 单元、26 脚本、58 浏览器、前端构建与 locked Rust check。发布说明已写明本轮功能和 Android 开发证书无法保证覆盖旧开发 APK 的限制；未宣称真实私有 AI 账号或 Android 实体手机兼容已验证。
- 真实流式 AI、可配置并发与持久任务审阅、词条左大纲/顶部信息、划词 AI/黄色高亮、侧栏收起/展开已经实现。
- 最终本地 **99 单元、26 脚本、58 Playwright 全量回归、前端构建、locked Rust check、格式/差异检查全部通过**。新任务专项 8 项覆盖真实分块 HTTP、选区上下文/失败保留输入、OCR 审阅持久化、分类先确认/清队列失败幂等、动态限流/排队取消、第二窗口保护、重载中断恢复及侧栏/高亮布局。复习控制 8 项与删除/同步/备份等既有回归保持通过。
- 首轮全量 56/57 通过，提示词独立保存用例在设置控制器热更新期间失败；该组独立重跑通过，冻结应用源码后最终 58/58 全量通过。三平台原生 SSE/正式 Release 已完成，最终证据见本节开头。
- 应用源码 `f80cae9` 的云端 Validate [40486897040](https://github.com/txsdx/ZhiNexus/actions/runs/40486897040) 全部通过；首次构建 [40486896426](https://github.com/txsdx/ZhiNexus/actions/runs/40486896426) 的 Windows/Ubuntu 实包含真实 SSE 测试全部通过。Android 编译成功，但新增测试使用 `.chat-model select` 同时匹配模型和思考框而严格定位失败，尚未发出流式请求；改为精确 Chat model 可访问名称，应用代码不变，最终重新构建及正式发布全部成功。

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
