# 0.20 完整109条需求逐项验收

编号与初始提示词一致。1–106沿用0.19证据并继续回归；107–109为本轮布局与捕获增强。实现、验证、发布分开记录，尚未运行项不标完成。

|编号|需求摘要|实现位置|实现|验证证据|发布|
|---|---|---|---|---|---|
|1|用户希望仅凭本文件能够复现整个程序的功能、关键交互、数据模型、算法与构建发布流程|AGENTS.md；.ai/DEVELOPMENT_PROMPT.md；初始提示词|已落实|0.18：编号规格/工作约定/提交与交付记录|v0.19.0已发布|
|2|“随时把我的要求全都一条一条列写出来，然后逐条完成，注意细节|AGENTS.md；.ai/DEVELOPMENT_PROMPT.md；初始提示词|已落实|0.18：编号规格/工作约定/提交与交付记录|v0.19.0已发布|
|3|同时维护 AGENTS.md、.ai/DEVELOPMENT_PROMPT.md 的 AI 工作约定以及 USER_REQUIREMENTS.md、…|AGENTS.md；.ai/DEVELOPMENT_PROMPT.md；初始提示词|已落实|0.18：编号规格/工作约定/提交与交付记录|v0.19.0已发布|
|4|不要敷衍、只口头承诺、只搭界面或只改正常路径|AGENTS.md；.ai/DEVELOPMENT_PROMPT.md；初始提示词|已落实|0.18：编号规格/工作约定/提交与交付记录|v0.19.0已发布|
|5|对已授权的实现持续推进，常规可逆技术选择自行决定，避免反复询问确认|AGENTS.md；.ai/DEVELOPMENT_PROMPT.md；初始提示词|已落实|0.18：编号规格/工作约定/提交与交付记录|v0.19.0已发布|
|6|原项目已获授权提交、推送、编译三平台并发布正式 Release；同一会话内沿用授权|AGENTS.md；.ai/DEVELOPMENT_PROMPT.md；初始提示词|已落实|0.18：编号规格/工作约定/提交与交付记录|v0.19.0已发布|
|7|软件用于每天捕获、理解、长期记忆概念；中文名“知枢”，英文名“ZhiNexus”|package.json；src/main.tsx；src/core/database.ts；public/app-icon.png|已落实|0.18：编译、格式、SQLite回归；图标1024×1024 RGBA|v0.19.0已发布|
|8|支持 Windows x64、Ubuntu 24.04+ x64、Android 15+/API35 arm64-v8a|package.json；src/main.tsx；src/core/database.ts；public/app-icon.png|已落实|0.18：编译、格式、SQLite回归；图标1024×1024 RGBA|v0.19.0已发布|
|9|使用 Tauri 2、React 19、TypeScript 5.9、Vite 6；SQLite 是本地权威库|package.json；src/main.tsx；src/core/database.ts；public/app-icon.png|已落实|0.18：编译、格式、SQLite回归；图标1024×1024 RGBA|v0.19.0已发布|
|10|使用成熟库与公开 API：Tiptap 3/ProseMirror/Markdown、ts-fsrs 5.x、React Flow/XYFlow 1…|package.json；src/main.tsx；src/core/database.ts；public/app-icon.png|已落实|0.18：编译、格式、SQLite回归；图标1024×1024 RGBA|v0.19.0已发布|
|11|TS 负责领域、工作流和 UI，Rust 负责 OS 边界、原生存储恢复、网络与更新安装等|package.json；src/main.tsx；src/core/database.ts；public/app-icon.png|已落实|0.18：编译、格式、SQLite回归；图标1024×1024 RGBA|v0.19.0已发布|
|12|源文件有概述，新增导出类型和函数有注释，Prettier/Rustfmt 格式化|package.json；src/main.tsx；src/core/database.ts；public/app-icon.png|已落实|0.18：编译、格式、SQLite回归；图标1024×1024 RGBA|v0.19.0已发布|
|13|品牌图标为高质量透明 1024×1024；希望使用 image-2.5|package.json；src/main.tsx；src/core/database.ts；public/app-icon.png|已落实|0.18：编译、格式、SQLite回归；图标1024×1024 RGBA|v0.19.0已发布|
|14|快速/模糊查询标题、正文、标签，重复名称优先复用已有词条；用户再次调取相似概念可进入学习/复习，不能不断创建重复条目|src/App.tsx；src/hooks/useEntryDocument.ts；src/components/editor|已落实|0.18：捕获/原文保留、块聚焦、源码/公式/图片、即时大纲及重启回归|v0.19.0已发布|
|15|原始材料先持久保存，再提交 AI 整理任务|src/App.tsx；src/hooks/useEntryDocument.ts；src/components/editor|已落实|0.18：捕获/原文保留、块聚焦、源码/公式/图片、即时大纲及重启回归|v0.19.0已发布|
|16|词条结构按需包含：英文名/翻译、已知 IPA（可多个）、一句话解释、中文详解、标准定义/公式、条件/边界、直观类比、案例/反例、常见误区、自测、前置…|src/App.tsx；src/hooks/useEntryDocument.ts；src/components/editor|已落实|0.18：捕获/原文保留、块聚焦、源码/公式/图片、即时大纲及重启回归|v0.19.0已发布|
|17|支持 Markdown、LaTeX/KaTeX、严格模式 Mermaid、表格、代码、图片；渲染不执行原始脚本，远程 Markdown 不能自动跟踪…|src/App.tsx；src/hooks/useEntryDocument.ts；src/components/editor|已落实|0.18：捕获/原文保留、块聚焦、源码/公式/图片、即时大纲及重启回归|v0.19.0已发布|
|18|提供 Tiptap 块式所见即所得、持久块 ID、左侧文档大纲、块聚焦、多标签、本机草稿重启恢复|src/App.tsx；src/hooks/useEntryDocument.ts；src/components/editor|已落实|0.18：捕获/原文保留、块聚焦、源码/公式/图片、即时大纲及重启回归|v0.19.0已发布|
|19|大纲点击立即定位，不能平滑滚动|src/App.tsx；src/hooks/useEntryDocument.ts；src/components/editor|已落实|0.18：捕获/原文保留、块聚焦、源码/公式/图片、即时大纲及重启回归|v0.19.0已发布|
|20|阅读页给长标题完整宽度，避免被属性栏挤成难看的断行；属性编辑栏仅在编辑时显示|src/pages/Entry.tsx；src/components/editor/BlockEditor.tsx；src/core/entry-colors.ts|已落实|0.18：entry-header、iteration018、controls018、后台配图并发回归|v0.19.0已发布|
|21|词条页不再放右侧“一句话解释”和“知识连接”卡片|src/pages/Entry.tsx；src/components/editor/BlockEditor.tsx；src/core/entry-colors.ts|已落实|0.18：entry-header、iteration018、controls018、后台配图并发回归|v0.19.0已发布|
|22|添加图片与 AI 配图：配图提示词弹窗预填可配置模板，明确提交后生成，结果审阅后插入当前最新草稿，不能覆盖生成期间的新编辑|src/pages/Entry.tsx；src/components/editor/BlockEditor.tsx；src/core/entry-colors.ts|已落实|0.18：entry-header、iteration018、controls018、后台配图并发回归|v0.19.0已发布|
|23|划词工具条提供 AI 对话、复制、黄色高亮、取消高亮、加粗等；编辑/阅读批注都要保留选区、撤销和正文完整性|src/pages/Entry.tsx；src/components/editor/BlockEditor.tsx；src/core/entry-colors.ts|已落实|0.18：entry-header、iteration018、controls018、后台配图并发回归|v0.19.0已发布|
|24|词条背景色支持默认、柔和浅红/绿/蓝/黄/紫；对比度足够，夜间有对应色，色值用白名单 token 保存并同步|src/pages/Entry.tsx；src/components/editor/BlockEditor.tsx；src/core/entry-colors.ts|已落实|0.18：entry-header、iteration018、controls018、后台配图并发回归|v0.19.0已发布|
|25|添加、重命名、移动、正文改动、图片增删等可审计；保留创建/更新时间、来源、CRDT 历史、回收站和冲突处理|src/pages/Entry.tsx；src/components/editor/BlockEditor.tsx；src/core/entry-colors.ts|已落实|0.18：entry-header、iteration018、controls018、后台配图并发回归|v0.19.0已发布|
|26|知识库使用紧凑分类树表格，不使用大面积卡片|src/components/library/KnowledgeTable.tsx；src/services/categories.ts；CategoryDeletion/CategoryPicker|已落实|0.18：分类拖拽/并发/默认保留/整树删除、取消/关闭/失败；四列表与回车回归|v0.19.0已发布|
|27|表格四列：标题、一句话解释、紧凑创建日期、下次复习|src/components/library/KnowledgeTable.tsx；src/services/categories.ts；CategoryDeletion/CategoryPicker|已落实|0.18：分类拖拽/并发/默认保留/整树删除、取消/关闭/失败；四列表与回车回归|v0.19.0已发布|
|28|设置分类树可以直接拖拽修改父子层级，可移回顶层|src/components/library/KnowledgeTable.tsx；src/services/categories.ts；CategoryDeletion/CategoryPicker|已落实|0.18：分类拖拽/并发/默认保留/整树删除、取消/关闭/失败；四列表与回车回归|v0.19.0已发布|
|29|树节点直接有删除按钮，也有分类右键操作|src/components/library/KnowledgeTable.tsx；src/services/categories.ts；CategoryDeletion/CategoryPicker|已落实|0.18：分类拖拽/并发/默认保留/整树删除、取消/关闭/失败；四列表与回车回归|v0.19.0已发布|
|30|删除分类提供三种选择：a. 保留条目和子分类，直属内容移到被删分类的上一级；b. 删除整棵子树及层级内全部条目；c. 取消|src/components/library/KnowledgeTable.tsx；src/services/categories.ts；CategoryDeletion/CategoryPicker|已落实|0.18：分类拖拽/并发/默认保留/整树删除、取消/关闭/失败；四列表与回车回归|v0.19.0已发布|
|31|所有删除/恢复等确认必须真正等待结果|src/components/library/KnowledgeTable.tsx；src/services/categories.ts；CategoryDeletion/CategoryPicker|已落实|0.18：分类拖拽/并发/默认保留/整树删除、取消/关闭/失败；四列表与回车回归|v0.19.0已发布|
|32|普通确认框支持 Enter 确定，且遵循显式聚焦的取消/关闭按钮|src/components/library/KnowledgeTable.tsx；src/services/categories.ts；CategoryDeletion/CategoryPicker|已落实|0.18：分类拖拽/并发/默认保留/整树删除、取消/关闭/失败；四列表与回车回归|v0.19.0已发布|
|33|接 OpenAI Chat Completions 兼容服务；CPA /models?client_version=cpa 按实际格式解析并做有限合…|src/services/ai.ts；src/core/ai-stream.ts；src/core/ai-queue.ts；src/services/ai-jobs.ts|已落实|0.18：AI空tool_calls、真实分块HTTP、FIFO连续三轮、限流/持久恢复/幂等|v0.19.0已发布|
|34|模型列表和所有选择框显示原始 ID，例如 gpt-6.1-sol-fast；Tools:? 是未知，允许尝试，明确 false 才禁用|src/services/ai.ts；src/core/ai-stream.ts；src/core/ai-queue.ts；src/services/ai-jobs.ts|已落实|0.18：AI空tool_calls、真实分块HTTP、FIFO连续三轮、限流/持久恢复/幂等|v0.19.0已发布|
|35|全局默认模型加“默认模型”选项动态继承；每个任务/对话可覆盖，不覆盖既有单项选择|src/services/ai.ts；src/core/ai-stream.ts；src/core/ai-queue.ts；src/services/ai-jobs.ts|已落实|0.18：AI空tool_calls、真实分块HTTP、FIFO连续三轮、限流/持久恢复/幂等|v0.19.0已发布|
|36|所有 AI 文本功能真实流式输出：聊天、分类、解释、评分、关联、OCR 等；正确拼接 UTF-8、思考内容和工具参数|src/services/ai.ts；src/core/ai-stream.ts；src/core/ai-queue.ts；src/services/ai-jobs.ts|已落实|0.18：AI空tool_calls、真实分块HTTP、FIFO连续三轮、限流/持久恢复/幂等|v0.19.0已发布|
|37|可配置并自动保存 AI 并发上限（默认2，1–16），一条持久本机任务队列统一调度|src/services/ai.ts；src/core/ai-stream.ts；src/core/ai-queue.ts；src/services/ai-jobs.ts|已落实|0.18：AI空tool_calls、真实分块HTTP、FIFO连续三轮、限流/持久恢复/幂等|v0.19.0已发布|
|38|导航不停止后台任务；审阅不占 HTTP 并发|src/services/ai.ts；src/core/ai-stream.ts；src/core/ai-queue.ts；src/services/ai-jobs.ts|已落实|0.18：AI空tool_calls、真实分块HTTP、FIFO连续三轮、限流/持久恢复/幂等|v0.19.0已发布|
|39|影响知识的分类/解释/配图/关联提案不能提前应用|src/services/ai.ts；src/core/ai-stream.ts；src/core/ai-queue.ts；src/services/ai-jobs.ts|已落实|0.18：AI空tool_calls、真实分块HTTP、FIFO连续三轮、限流/持久恢复/幂等|v0.19.0已发布|
|40|每个 AI 功能有独立可编辑提示词模板，变量字面替换|src/services/ai.ts；src/core/ai-stream.ts；src/core/ai-queue.ts；src/services/ai-jobs.ts|已落实|0.18：AI空tool_calls、真实分块HTTP、FIFO连续三轮、限流/持久恢复/幂等|v0.19.0已发布|
|41|全局 Agent 有自己的话题历史；每个词条独立上下文和话题历史|src/pages/Agent.tsx；src/services/agent.ts；src/services/agent-tools.ts；src/services/mcp.ts|已落实|0.18：侧栏/划词/草稿审阅、17工具严格schema、取消/失败/回执；MCP实际stdio|v0.19.0已发布|
|42|划词自动携带选中文本和上下文|src/pages/Agent.tsx；src/services/agent.ts；src/services/agent-tools.ts；src/services/mcp.ts|已落实|0.18：侧栏/划词/草稿审阅、17工具严格schema、取消/失败/回执；MCP实际stdio|v0.19.0已发布|
|43|全局聊天占满可用窗口，外层不滚动，消息区/话题列表独立滚动；提问右对齐；模型和思考设置放输入框下方|src/pages/Agent.tsx；src/services/agent.ts；src/services/agent-tools.ts；src/services/mcp.ts|已落实|0.18：侧栏/划词/草稿审阅、17工具严格schema、取消/失败/回执；MCP实际stdio|v0.19.0已发布|
|44|话题自动标题可双击/按钮编辑；迟到自动标题不能覆盖手动名称|src/pages/Agent.tsx；src/services/agent.ts；src/services/agent-tools.ts；src/services/mcp.ts|已落实|0.18侧栏/草稿审阅；本轮扩为23工具，新增图工具取消/失败/回执/过期单元|v0.19.0已发布|
|45|内置 tools 至少覆盖：搜索/分页列条目、读完整条目和本机草稿、列/读分类、读复习队列和不含凭证的软件状态；词条创建/编辑/移动/软删除/恢复；…|src/pages/Agent.tsx；src/services/agent.ts；src/services/agent-tools.ts；src/services/mcp.ts|已落实|0.18侧栏/草稿审阅；本轮扩为23工具，新增图工具取消/失败/回执/过期单元|v0.19.0已发布|
|46|支持手动启用 MCP：HTTP/Streamable HTTP、SSE、桌面 stdio；放在任务/提示词设置之后|src/pages/Agent.tsx；src/services/agent.ts；src/services/agent-tools.ts；src/services/mcp.ts|已落实|0.18：侧栏/划词/草稿审阅、17工具严格schema、取消/失败/回执；MCP实际stdio|v0.19.0已发布|
|47|使用维护中的 ts-fsrs，而非手写固定间隔|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|48|分清检索概率 R（预计能回忆）、稳定性 S（遗忘速度/时间尺度）、难度 D；曲线显示预计回忆概率，不宣称直接测量了用户大脑或把 AI 自评当作实测记…|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|49|新建知识默认按“已经学过/记住”初始化 FSRS，首次复习安排在未来，不立即进入队列|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|50|独立“遗忘曲线”页显示过去和未来时间范围，多词条不同颜色；滚轮平移时间轴，可缩放/回今天|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|51|图上标出当前时间和复习水平阈值|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|52|低于目标保留率的已学习词条进入复习队列；未知/尚未学习的词条不伪造曲线|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|53|复习采用提取练习：先答题，再看反馈|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|54|允许取消复习、重新出题、重新作答（含高分答案），未完成上下文退出可恢复|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|55|按设备独立设置复习提醒、失焦 AI/OCR 完成、同步失败、预览和冷却|src/core/review.ts；review-policy/forgetting-curves；src/pages/Review/ForgettingCurves.tsx；.ai/LEARNING_DESIGN.md|已落实|0.18：FSRS/历史曲线/阈值与队列一致性、Again自评、未来首次复习；复习控制/通知|v0.19.0已发布|
|56|Local-first：SQLite + append-only 操作日志 + 多值字段 CRDT + 因果版本向量 + SHA-256 + Mer…|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|57|同步 HTTPS WebDAV（含非默认端口和自建 SFTPGo），强制证书/主机名校验，使用全局代理|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|58|云端用 gzip 不可变操作批次和完整可校验检查点：packs/、checkpoints/、blobs/、quarantine/、state/HEA…|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|59|HEAD 原子发布：先探测可靠强 ETag 条件写入；SFTPGo 若忽略条件 PUT，则用经过探测的 WebDAV 排他祖先锁、精确内容版本比较和…|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|60|上传新对象并读回校验后再 CAS HEAD；竞争失败合并重试，不覆盖他人|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|61|自动压缩累积增量批次、复用未变化的活批次|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|62|云端只用于同步、不需历史回滚；删除旧逐事件稳态同步/审计引擎和云端回滚 UI|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|63|普通同步跳过本机可重建并验证的已知批次正文|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|64|校验成功后比较实际本地/云端 Merkle 与逻辑状态，再清理已被三份验证检查点覆盖的本地恢复冗余|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|65|自动同步按距上次成功时间的实际间隔；启动已逾期、唤醒、重新联网都要重新判断；手动同步重置成功时间|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|66|取消“增量同步完成”浮窗|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|67|保留完整加密文件备份/并集合并恢复、数据库空间显示/VACUUM、冲突解决、回收站|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|68|API/WebDAV/MCP 凭证统一“自定义同步密钥（可选）”；留空采用内置默认密钥 AES-GCM 自动本地加密并同步，无跨设备凭证保险箱/封存…|src/core/crdt.ts；src/services/sync-replica.ts；src/services/sync.ts；src/core/auto-sync.ts；src/services/integrity.ts|已落实|0.18：压缩/CAS/锁/并发/离线/损坏修复/密钥回归；上轮真实SFTPGo2.7.6|v0.19.0已发布|
|69|全局代理支持系统/HTTP/SOCKS5，应用于 AI、MCP HTTP、WebDAV、附件、更新等；stdio 子程序网络按其本身环境|src/services/network.ts；desktop/navigation/context-menu；src-tauri/src；src/pages/Graph.tsx|已落实|0.18：Windows原生代理/OCR/存储、导航/选区、SVG右键、全窗口/图删除与移动布局|v0.19.0已发布|
|70|桌面托盘常驻、关闭到托盘、真正退出排空写入；Windows Startup 快捷方式/Ubuntu XDG 自启；全局快速 OCR、捕获、显示窗口快…|src/services/network.ts；desktop/navigation/context-menu；src-tauri/src；src/pages/Graph.tsx|已落实|0.18：Windows原生代理/OCR/存储、导航/选区、SVG右键、全窗口/图删除与移动布局|v0.19.0已发布|
|71|跟随 OS DPI，避免 WebView DPI 重复缩放|src/services/network.ts；desktop/navigation/context-menu；src-tauri/src；src/pages/Graph.tsx|已落实|0.18：Windows原生代理/OCR/存储、导航/选区、SVG右键、全窗口/图删除与移动布局|v0.19.0已发布|
|72|portable 普通标记文件在可执行目录时，全部配置、SQL、日志等放同目录 _data，否则系统用户应用数据目录|src/services/network.ts；desktop/navigation/context-menu；src-tauri/src；src/pages/Graph.tsx|已落实|0.18：Windows原生代理/OCR/存储、导航/选区、SVG右键、全窗口/图删除与移动布局|v0.19.0已发布|
|73|鼠标侧键与 Alt+左右键用软件自己的有界导航历史，支持页面、词条、编辑/选中位置、滚动位置返回/前进，保留草稿；不触发浏览器文档后退、刷新或丢失状…|src/services/network.ts；desktop/navigation/context-menu；src-tauri/src；src/pages/Graph.tsx|已落实|0.18：Windows原生代理/OCR/存储、导航/选区、SVG右键、全窗口/图删除与移动布局|v0.19.0已发布|
|74|全局屏蔽浏览器默认右键菜单|src/services/network.ts；desktop/navigation/context-menu；src-tauri/src；src/pages/Graph.tsx|已落实|0.18：Windows原生代理/OCR/存储、导航/选区、SVG右键、全窗口/图删除与移动布局|v0.19.0已发布|
|75|左侧栏有明显收缩/展开快捷按钮，状态本机保存|src/services/network.ts；desktop/navigation/context-menu；src-tauri/src；src/pages/Graph.tsx|已落实|0.18：Windows原生代理/OCR/存储、导航/选区、SVG右键、全窗口/图删除与移动布局|v0.19.0已发布|
|76|知识星图铺满剩余窗口，不出现外层上下滚动条；移除图上标题、说明、自动整理按钮及默认多余浮层|src/services/network.ts；desktop/navigation/context-menu；src-tauri/src；src/pages/Graph.tsx|已落实|本轮图布局/连线与全库AI扩展，框选实际指针回归及SSE预览专项|v0.19.0已发布|
|77|全部配置自动保存，无“应用设置”按钮|src/services/settings.ts；src/core/diagnostics.ts；src/core/database.ts；src/main.tsx|已落实|0.18：设置失败/并发独立保存、完整拼接输出去敏、启动重放零重复写入、原生阶段计时|v0.19.0已发布|
|78|独立日志页记录 AI 请求提示词/模型/工具定义、拼接后的完整正文、思考和工具调用、耗时、状态与错误；不保存原始响应JSON/SSE帧|src/services/settings.ts；src/core/diagnostics.ts；src/core/database.ts；src/main.tsx|已落实|0.18：设置失败/并发独立保存、完整拼接输出去敏、启动重放零重复写入、原生阶段计时|v0.19.0已发布|
|79|日志本机保存、明确清空、可筛选/查询/导出；容量有界，超长内容明确标记，不因日志失败损失成功任务|src/services/settings.ts；src/core/diagnostics.ts；src/core/database.ts；src/main.tsx|已落实|0.18：设置失败/并发独立保存、完整拼接输出去敏、启动重放零重复写入、原生阶段计时|v0.19.0已发布|
|80|检查启动速度并记录阶段耗时|src/services/settings.ts；src/core/diagnostics.ts；src/core/database.ts；src/main.tsx|已落实|0.18：设置失败/并发独立保存、完整拼接输出去敏、启动重放零重复写入、原生阶段计时|v0.19.0已发布|
|81|versions.json 权威：三平台 major.minor 一致，patch 可不同|versions.json；.github/workflows；scripts；src/services/auto-updates.ts；src-tauri/src/updates.rs|已落实|0.18：平台版本/构建/包/签名/摘要、5原生认证缓存回归、自动更新生命周期|v0.19.0已发布|
|82|一个 Build and release 手动/API入口，只有是否发布/是否草稿选项；一次共享前端构建及摘要封存，Windows/Ubuntu/A…|versions.json；.github/workflows；scripts；src/services/auto-updates.ts；src-tauri/src/updates.rs|已落实|0.18：平台版本/构建/包/签名/摘要、5原生认证缓存回归、自动更新生命周期|v0.19.0已发布|
|83|默认 Android Action 只编译 arm64 发布 APK 并验证包和签名；不运行安卓模拟器、不构建 x86_64 测试 APK、不缓存系…|versions.json；.github/workflows；scripts；src/services/auto-updates.ts；src-tauri/src/updates.rs|已落实|0.18：平台版本/构建/包/签名/摘要、5原生认证缓存回归、自动更新生命周期|v0.19.0已发布|
|84|发布 .apk、.deb、Windows仅 *_protable.exe 单文件（保留protable拼写，不再生成/发布setup或MSI），不带…|updates/auto-updates/desktop；updates.rs；executable_update.rs；Build/package/publisher|已落实|本轮移除Windows安装器，沿用平台版本/摘要/可选签名；三平台构建/签名/摘要、实际包读回与正式v0.19.0已完成|v0.19.0已发布|
|85|latest.json schema2 含平台独立版本、下载地址、说明、SHA-256/可选签名；客户端比较自己平台版本|updates/auto-updates/desktop；updates.rs；executable_update.rs；Build/package/publisher|已落实|本轮移除Windows安装器，沿用平台版本/摘要/可选签名；三平台构建/签名/摘要、实际包读回与正式v0.19.0已完成|v0.19.0已发布|
|86|启动默认自动检查、后台下载校验，联网恢复重试；手动/自动共用任务，缓存重启后重验，不重复下载|updates/auto-updates/desktop；updates.rs；executable_update.rs；Build/package/publisher|已落实|本轮移除Windows安装器，沿用平台版本/摘要/可选签名；三平台构建/签名/摘要、实际包读回与正式v0.19.0已完成|v0.19.0已发布|
|87|每次Build前执行 npm test、npm run test:release、npm run build、npx playwright test…|updates/auto-updates/desktop；updates.rs；executable_update.rs；Build/package/publisher|已落实|本轮移除Windows安装器，沿用平台版本/摘要/可选签名；三平台构建/签名/摘要、实际包读回与正式v0.19.0已完成|v0.19.0已发布|
|88|SFTPGo/AI/MCP/代理兼容不能只凭mock宣称，相关真实服务或实包测试要记录版本和范围|updates/auto-updates/desktop；updates.rs；executable_update.rs；Build/package/publisher|已落实|本轮移除Windows安装器，沿用平台版本/摘要/可选签名；三平台构建/签名/摘要、实际包读回与正式v0.19.0已完成|v0.19.0已发布|
|89|最后推送代码、等待 Build前置检查和三平台所有构建/上传/缓存收尾及正式发布成功|updates/auto-updates/desktop；updates.rs；executable_update.rs；Build/package/publisher|已落实|本轮移除Windows安装器，沿用平台版本/摘要/可选签名；三平台构建/签名/摘要、实际包读回与正式v0.19.0已完成|v0.19.0已发布|
|90|先建立 SQLite/日志/CRDT/校验/恢复与最小可运行跨平台壳，再做捕获/编辑/分类/备份，再接 AI/队列/Agent/MCP，再做FSRS…|初始提示词；AGENTS.md；.ai/ARCHITECTURE.md|已落实|0.18：重建顺序、依赖、逐项状态和源码结构核对|v0.19.0已发布|
|91|安装 Node24、Rust稳定工具链、Tauri所需Linux/Windows依赖，Android JDK21、minSdk35、按实际Tauri…|初始提示词；AGENTS.md；.ai/ARCHITECTURE.md|已落实|0.18：重建顺序、依赖、逐项状态和源码结构核对|v0.19.0已发布|
|92|开始工作先读本文件及 AGENTS.md，再维护逐条清单|初始提示词；AGENTS.md；.ai/ARCHITECTURE.md|已落实|0.18：重建顺序、依赖、逐项状态和源码结构核对|v0.19.0已发布|
|93|新建词条窗口应更大（桌面约900px宽，正文约10行，手机限制视口范围），提供按钮打开小分类树选择所属分类|src/App.tsx；src/components/CategoryPicker.tsx；src/pages/Entry.tsx|已落实|0.18：900px/10行、共享搜索/方向键/折叠、嵌套取消、保存失败保留|v0.19.0已发布|
|94|用户再次要求确认所有需求均已实现、细节完善|.ai/ACCEPTANCE_018.md；.ai/ITERATION_018.md|已落实|0.18：全100项复核；本轮补齐拖拽变更/只读树/SVG和分类创建细节|v0.19.0已发布|
|95|用户质疑默认Action中Ubuntu图形界面/portable损坏恢复验收的耗时及点击报错|.github/workflows/build.yml；native-ui.yml；scripts/workflow.test.mjs|已落实|0.18：默认移出Ubuntu图形自动化；按需复用Build DEB/对应源码、不编译不发布|v0.19.0已发布|
|96|用户要求在启动Action前再次确认全部需求和细节：先完成完整清单复核、本地检查及已知缺陷修复，再推送或手动触发新Action；测试触发频率按第98…|本地全部检查及完整需求清单|已落实|0.18：在任何新Action/推送前复核、修复已知失败；本地Ubuntu隔离容器验收|v0.19.0已发布|
|97|Android手机端禁止双指缩放或双击引发的浏览器整页缩放：在原生WebView创建回调中关闭页面zoom支持和内置zoom控件；不吞掉触摸事件，保…|src-tauri/mobile/android/PageGestures.kt；scripts/configure-android.mjs|已落实|0.18：创建回调安装/幂等/已有安全区升级回归，31脚本通过；Android包编译及设备范围另记|v0.19.0已发布|
|98|每次提交都跑test太浪费时间：普通提交、push/PR不触发测试流水线；删除独立Validate，完整单元/脚本/浏览器测试合并进Build an…|.github/workflows/build.yml；scripts/workflow.test.mjs；AGENTS.md|已落实|0.18：无push/PR触发；共享前端测试仅一次，失败阻止打包；原生更新回归先于打包|v0.19.0已发布|
|99|Android手机APP启动器必须使用知枢软件图标，不显示绿色/黄色圆圈模板|scripts/configure-android.mjs；src-tauri/icons/android|已落实|0.18：生成工程旧普通/圆形图标覆盖、全部密度字节一致、Manifest绑定和幂等回归|v0.19.0已发布|
|100|README需要重写优化：删除历史流水账、冗长示例和过时说明，简明介绍软件用途、下载平台、主要功能、上手配置、开发/构建方法与文档入口；保持与实际软…|README.md|已落实|0.18：211行精简为65行，平台/上手/配置/开发/Build触发和文档链接核对|v0.19.0已发布|
|101|Windows永远只发布单文件exe，不生成或发布安装包/NSIS/MSI；默认数据依旧在系统应用程序数据文件夹，portable标记或已验证的数据…|updates/auto-updates/desktop；updates.rs；executable_update.rs；Build/package/publisher|已落实|选择产物/缓存单元；Linux12原生边界、Windows6边界及实际helper双模式/保留数据/坏摘要拒绝通过|v0.19.0已发布|
|102|Windows可执行文件进行体积优化，前提是不严重影响启动速度；优先编译期优化、符号裁剪和链接优化，不默认加入运行时解压器|Cargo release-windows；tauri.windows.conf；package-portable.ps1；native-smoke|已落实|31,886,336字节，较0.18减少18.96%；CI首帧937ms，后续352–384ms，无运行时解压器|v0.19.0已发布|
|103|条目解释/编辑的所属分类显示完整层级路径，不使用下拉选择框外观；独立修改按钮打开共用小分类树，取消不改变分类，长路径换行且保留完整名称|categories.categoryPath；CategoryPicker；Entry；styles|已落实|完整层级、修改按钮、复用小树、320–1920px无溢出专项通过；截图已检查|v0.19.0已发布|
|104|知识星图提供自动关联全部条目的选项，分析依赖、递进及普通关联；使用流式任务队列、独立可编辑模板，结果先预览再明确应用|knowledge-graph；ai-workflows/ai-apply；Graph；AIJobView；agent-tools；defaults|已落实|DAG/重复/未知/并发/回执单元；真实SSE预览取消/选中升级/过期拒绝专项通过|v0.19.0已发布|
|105|知识星图支持左键拖动框选多个节点，并批量拖动；结束时一次保存所有移动节点的位置，刷新后保持|Graph ReactFlow selection/group callbacks；saveGraphPositions|已落实|实际鼠标框选2节点、同幅移动、第三节点保留、刷新持久化；远端并发单元通过|v0.19.0已发布|
|106|右键菜单颜色色块应更醒目、易区分；实际词条背景仍使用较浅柔和颜色，不能遮盖文字，深色主题对应检查|styles .color-swatch；浅/深主题 --entry-tint|已落实|浅色/深色截图人工检查；色块鲜明、实际浅底与文字对比保留|v0.19.0已发布|
|107|关于与更新页开关/版本/状态与按钮布局、手机无溢出、准确的同版本说明|AboutPanel；styles.toggle/about-header/about-update-controls；native-updates|已实现|五宽度截图/无溢出/同版本说明/自动保存重载通过|待0.20发布|

|108|图片/MD捕获、本机草稿、置顶独立窗口与单写入者|Capture/QuickCapture；capture-draft/repository；quick_capture.rs|已实现|6捕获浏览器/13数据专项通过；Windows实包待完成（Actions付款/额度阻塞）|未发布|
|109|DOCX转简单Markdown与内嵌图片|capture-import；Mammoth/Turndown/fflate|已实现|真实OOXML结构/图片/损坏输入及新输入保留专项通过|未发布|

## 本轮验证

本地218单元、36脚本、locked Rust check及2桥接边界通过；捕获浏览器专项6/6已过，全量浏览器首轮92/93通过，旧定位修正后失败项及6捕获专项共7项复验通过，最终生产构建通过。107五宽度截图已检查，自动保存重载通过。尚未启动Action/发布0.20。原有真实服务、实体设备、签名与更新边界继续适用，详见KNOWN_ISSUES和STATUS。

云端Build40907744178最终218/36/93、生产构建、Ubuntu13原生/DEB、Android和Windows编译成功；Windows烟测驱动误判已修，最终38脚本通过。恢复40911810320/40911901294均未启动即被GitHub计费检查拒绝，尚未完成Windows实包及正式发布，详见STATUS。编号1–106的既有发布证据不等同于本轮新包完整复验。
