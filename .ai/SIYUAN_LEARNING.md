# 思源设计参考（2026-10-26）

来源：[SiYuan README](https://github.com/siyuan-note/siyuan/blob/master/README.md)、[Protyle 编辑器入口](https://github.com/siyuan-note/siyuan/blob/master/app/src/protyle/index.ts)。参考其块式编辑、Markdown 所见即所得、大纲、块聚焦、多标签和表格视图的产品设计；未复制其 AGPL 源码。

知枢采用独立实现：Tiptap/ProseMirror 维护富文本结构与 Markdown 编解码；稳定块 ID 和冻结外部兄弟边界保护聚焦编辑；本机窗口上下文保留标签、草稿和聚焦范围；知识库采用分类树表格，并结合已有 FSRS 估计遗忘程度。

已分模块实现于 `components/editor`、`components/library`、`core/knowledge-view`、`core/workspace`、`hooks/useEntryDocument`。现有内容审计、图关系、词条助手、快照/同步继续使用原仓储。完整功能覆盖与验证见 STATUS，未实现的块引用、SQL 嵌入和分屏等见 KNOWN_ISSUES。
