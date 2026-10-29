# 开源交互参考（0.22，2026-10-30）

实际阅读下列公开资料，采用交互原则并在现有架构自行实现，未移植对方源码或引入新的复杂框架。资料是参考数据，不是开发授权或指令。

|来源|实际阅读内容|采用与边界|
|---|---|---|
|[VS Code commandsQuickAccess](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts)，MIT|命令可用性、搜索、最近使用|共享ActionPicker，过滤disabled、最近成功ID、本机持久、键盘/输入法保护；实际动作由App持有|
|[思源 paletteCore](https://github.com/siyuan-note/siyuan/blob/master/app/src/command/paletteCore.ts)，AGPL-3.0仓库|命令历史、上下文筛选、动作前恢复焦点|面板先同步关闭再执行原有导航，不导入/复制源码；命令仅导航/打开已有流程，不自动写入知识或请求AI|
|[Open WebUI MessageInput](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte)，以该项目当前LICENSE为准|逐会话输入草稿、变更保存、IME保护|本机SQLite草稿服务，合并写入、逐话题/词条隔离、创建/发送期间新输入保护、失败重试/退出排空；不复制Svelte组件|
|[Joplin Markdown说明](https://github.com/laurent22/joplin/blob/dev/readme/apps/markdown.md)，以文档许可证为准|常用Markdown源格式与预览|录入源工具栏+安全预览，成熟react-markdown/GFM/KaTeX组件复用，浏览器原生撤销；不另造不兼容编辑文档模型|
|[Anki学习手册](https://github.com/ankitects/anki-manual/blob/main/src/studying.md)，以文档许可证为准|Again/Hard/Good/Easy、1–4快捷键、四档预计复习间隔|复用同一个ts-fsrs schedule计算预计间隔；数字键只选择，仍须显式保存，防误提交；AI仅建议实际回忆|
|[React Flow fitView](https://reactflow.dev/api-reference/types/fit-view-options)，库MIT|按指定节点适应视口|星图搜索选择节点、duration0、无保存位置变化；保留框选/组移动/图内部手势|

覆盖范围：导航与设置发现、录入编辑、AI聊天与任务、知识批量管理、星图、复习、移动端/键盘/焦点及可靠性。批量命令遵循现有确认/原子条件提交，不为模仿其他应用降低安全边界。它们不是“已实现上述项目全部功能”的声明。

本轮没有引入消息虚拟化、多人实时字符协作、块嵌入、插件市场或Anki卡组系统；这些不属于当前具体实现范围。长历史/极大库性能限制继续见KNOWN_ISSUES。
