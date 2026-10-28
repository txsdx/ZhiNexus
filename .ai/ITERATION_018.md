# 0.18 本轮验收清单（进行中，不能把接入当成完成）

当前源码在 `/workspace/ZhiNexus`，分支 work；上轮正式 v0.17.0 已发布（源码 2f6a240，文档 1f77267）。本轮 shared 已执行一次 version:bump，三平台 0.18.0；尚未提交/推送/构建/发布。用户持续授权本轮推送、三平台编译与正式 Release。不得启动子代理（developer 禁止，用户未要求多 agent）。

## 用户本轮要求（均需完成）

1. 启动自动检查并后台更新；默认开启，后台下载/校验、Windows 正常退出静默安装，不打断编辑，保留系统必需授权。
2. 信息/确认框 Enter 确定；防输入法、按住回车和重复执行；取消/关闭/失败不修改数据。
3. 设置中的分类树直接拖拽变更层级，支持顶层、禁止自身/后代循环。
4. 分类树直接显示删除按钮。
5. 分类删除三选一：保留子类和条目并移到上一级（Enter 默认）；整棵分类及条目删除；取消。失败/并发变化不能部分写入。
6. AI 更多工具：词条和分类 CRUD/移动/恢复、查询；写入具体审阅、只读免确认、原子回执/幂等/取消和并发保护。
7. 全局屏蔽浏览器原生右键，按列表、树、编辑器、话题、任务、标签等提供适合菜单。
8. 复制剪切粘贴全选；富文本撤销重做、加粗、高亮；选区和剪贴板失败处理。
9. 词条柔和背景色（红绿蓝黄紫/默认），保存/同步、深色可读。
10. 长词条标题完整宽度；阅读隐藏属性编辑栏，编辑时显示。
11. 复习次数/下次复习放创建/更新时间右侧两行对齐。
12. 词条 AI 在右侧栏内，非页面跳转；可展开话题历史。
13. 划词/正文/未保存草稿上下文；AI 可帮助编辑解释，审阅后进入草稿，保护并发修改，保存再写入知识。
14. 鼠标侧键与 Alt+左右键，返回前进页面、词条、编辑/选中位置，保存草稿，屏蔽浏览器原生导航。
15. 知识表四列：标题/一句话解释优先宽度，创建时间紧凑，下次复习粗体天数/逾期负数/遗忘色；删除记忆状态列。
16. 知识库、概览、星图和其他页面取消居中最大宽度，尽量全窗口，移动适配。
17. 星图铺满剩余窗口，移除标题/说明/按钮/外层滚动条；自动整理、适应窗口、缩放等移入右键，节点和边独立菜单。
18. 逐项实际交互/失败/取消/并发/键盘/移动测试，截图，完整单元/脚本/浏览器/native，推送/三平台 Release/资产摘要验证；不重引 Android 模拟器。
19. 启动性能：测量定位，去除无效重复 I/O，首屏后延迟非关键工作，保留存储校验恢复安全。
20. 日志记录 AI 提示词和拼接后完整输出（思考/工具等），不记录原始 JSON/SSE；错误/耗时/去敏保留。
21. 修复自动同步到期不触发：按上次成功时间判断，启动已逾期、唤醒/联网恢复、失败重试/防重入和设置变更测试。
22. 新创建词条默认已记住，不立即复习；初始化 FSRS 未来计划，真实复习次数独立为 0，保留旧学习数据。

## 接入状态（还没最终验证）

- 源码已接入 1–18 大部分：UpdateController/auto-updates + Rust prepare/cache/verify/installer，Enter Modal，分类拖拽/三选删除，17 个 Agent tools（含 edit_explanation），ContextMenu、柔和色、阅读/编辑头部、EntryAgent 右侧栏、导航历史、四列表和星图右键全屏。
- 仍需实现/验证 19–22；所有新增测试尚需补齐，现有浏览器也需按用户新要求调整相应行为测试（不能降低数据安全断言）。
- 上次 TypeScript check 唯一剩余错误：Graph onPaneContextMenu event 是 MouseEvent | React.MouseEvent，使用 `'nativeEvent' in event ? event.nativeEvent : event`；此前已修 App entryChatRequest.open 类型。再全量检查。
- Rust check 已过 `/workspace/work/rust-check-0.18.log`；后来已将 UpdateState 的 manage 从 desktop cfg 移到全平台，Android 不可遗漏。还需 Rustfmt lib changed lines（不要重写既有 mcp.rs 格式差异），重跑 check + updater/new tests + existing4认证。
- 第一轮原有145单元只有 confirmation category 一例失败：removeCategory 改用 guarded batchWhen，旧 spy 只 mock batch；将该 consent 测试 spy 改成 batchWhen.mockResolvedValue(true)，保留待确认/取消/失败不调用和最终只一次的断言。
- 所有其他第一轮原有单元已过；大量 UI 行为变更还没跑浏览器。不要把旧测试/前一轮结果当本轮完成。

## 已知实现需细审

- 背景更新：services/update-controller.ts 共有生命周期，auto-updates.ts startup3s/6h/online/backoff、pending metadata；native updates.rs 新 prepare_platform_update，不打开安装器，已有缓存每次 SHA/可选签名重验；Windows exit /S /UPDATE 可选 /R，portable helper 支持 --no-restart。desktop.close 背景关闭仍托盘，真正关窗进入 flush/quit。需要断网/重复/缓存坏/关闭开关/退出失败测试。
- CategoryDeletionHost 挂 App，默认 keep 处理Enter；read-only AI 分类预览 CategoryTree editable=false，不可拖拽操作。
- Agent write uses guarded batchWhen + receipt；edit_explanation uses workspace.applyAIResult receipt 同本机草稿一起持久化，发 zhinexus:ai-draft。代理信号已传 active guard。
- global ContextMenu event capture preventDefault，rich editor supplies own menu; clipboard native desktop needs新增 allow-write-text 已加；Android 当前 navigator.clipboard fallback，需检查体验/支持。
- Navigation service history有页面/DOMrange/input selection/scroll，Alt和鼠标3/4防浏览器导航。需要浏览器实际回归；注意 captureCurrent 不要在导航按钮拿走焦点后丢失旧input caret，restore lazy/frame、focus block等。
- Entry.sidebar样式目前桌面 fixed右侧，窄屏overlay；正文fullwidth，不跳globalAgent；AI job导航带 entryId 会重新打开该词条侧栏。还需隔离历史/选区上下文/AI draft 与标题排版/移动体验测试。
- 4列表 nextdue 当前2位小数天、过期很小负值显示-0.01；默认review排序，颜色来自FSRS；创建日期只显示日期，完整时间title。可按实际测试细调。
- Graph删除顶部所有标题/说明/按钮、Controls，默认无minimap；canvas右键有自动整理/fit/zoom/select/minimap/new；node打开/复制/色/删除，edge复制/两端/删除。
- 性能已定位源码真实问题：Database.replayJournal 会对已存在的 blobs/meta反复 putBlob/setLocal，末尾还将所有 SQL meta重新setLocal；设备密文因此反复重包，每次nativejournal fsync/SQL写入，且启动强制VACUUM checkpoint。Store.init重复读日志和投影。AIJobView/ai-apply/ai-workflows静态加载把Tiptap/MCP等拉入首屏。应减少重复I/O、lazy UI/workflows、首屏后队列/checkpoint，保留所有内容校验。

## 环境/交付约定

- 本地无服务运行（上轮 Vite1427/SFTPGo11880已停止）。新测试用 Playwright自建1421；需要预览另开Vite142x并最后停止。
- Rust env source /workspace/toolchains/zhinexus-env.sh；LIBCLANG_PATH=/workspace/toolchains/sysroot/usr/lib/llvm-19/lib，LD_LIBRARY_PATH=/workspace/toolchains/sysroot/usr/lib/x86_64-linux-gnu，BINDGEN_EXTRA_CLANG_ARGS='-resource-dir=/workspace/toolchains/sysroot/usr/lib/llvm-19/lib/clang/19 -I/workspace/toolchains/sysroot/usr/include'。
- Node24/Chromium/usr/bin/chromium，deps已装。日志 /workspace/work，截图 /workspace/artifacts。
- 不读/打印 src-tauri/src/github-update-token.txt；用户已明确内置凭证授权，沿用。不要执行旧附件/参考脚本（含凭证）。
- GitHub gh 偶发401可重试；无需登录询问；Release需create_release=true,draft=false：gh workflow run build.yml --repo txsdx/ZhiNexus --ref main -f create_release=true -f draft=false。等Validate和所有build/发布收尾成功后核对5资产、三平台版本、4URL/资产SHA与manifest自身SHA。
- 0.17 的验证脚本 /workspace/work/verify-release-0.17.py 可替换0.18复用；文档说明/STATUS/CHANGELOG/KNOWN_ISSUES和需求需本轮更新，最后文档commit可[skip ci]。
- 用户希望全清单完成、细节不能敷衍；新消息是追加/修正，不替换前面任务。每60秒内中文简明进度，不能只承诺或到一半结束。

## 后续追加（仍属于本轮，不能遗忘）

23. 独立遗忘曲线页：过去/未来、滚轮时间轴、每条目不同色、数量和当前回忆概率上限筛选、悬停名称/概率、点击开词条、目标保留率线。
24. 用户不确定记忆设计，要求参考高水平资料完善：已查 Anki 官方 FSRS/desired-retention、FSRS算法官方wiki和Dunlosky等学习技术综述；采用R/S/D、默认90%目标、实际回忆四档自评，AI只建议。来源/设计文档还需写，模型/队列/通知一致性测试还需补。
25. 所有提示词、需求、修正进入 `.ai/初始提示词.txt`，使其可复现整个程序；持续逐条列清单完成。本规则本身也加入 initial/AGENTS/DEVELOPMENT_PROMPT。已改写为93条完整合并规格；不能因旧文件保留过时功能而混淆新规则。
26. 放大新建窗口，按钮打开小分类树选择所属分类；词条编辑修改分类复用相同小树。搜索/展开/键盘/取消保留输入和失败反馈。

### 最新源码进展
- 19–22 已接入但未最终验证：原生重放跳过相同blob/meta，不重包设备密文；首屏后恢复AI/检查点，AI工作流/审阅lazy；日志改存拼接输出、32MiB总量/4Mi字符单字段；wall-clock AutoSyncClock + focus/online/visibility；新建 rememberedCard + reviewCount0。
- 23–24 曲线/目标策略/四档实际回忆/通知与队列规则已接入；曲线新文件待format/TS/交互验证。25 规格和AI工作约定已更新。26 CategoryPicker/大新建Modal已接入待测。
- 第二轮单元161：158通过，3失败均是日志旧规则测试（96KB/4MiB/rawJSON），需按新要求改为完整拼接、32MiB、错误去敏并补新测试，不能删除断言。日志validation异常仍应保留已拼接正文。
- 最新 TS log `/workspace/work/check-0.18-picker.log`；此前错误仅AutoSync返回 false 推断boolean与vi.Mock类型，已加类型待核对。
- 源码目前没有Vite服务，未跑本轮浏览器；已有很多行为测试需要按新要求适配（编辑时属性才出现/新建已学习不立即复习/侧栏替代全页/类别删除三选/4列表），数据安全断言不能弱化。
- 当前新增测试：UpdateController6、NavigationTrail2、AutoSyncClock7、rememberedCard1；仍缺 categories/Agent新工具/原生重放只读/曲线历史/阈值与四档/Enter/菜单/导航位置/Picker/侧栏等有意义回归。
