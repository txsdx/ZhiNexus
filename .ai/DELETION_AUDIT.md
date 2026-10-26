# 删除与确认审查（0.9.0，2026-10-27）

## 根因

`tauri-plugin-dialog` 2.8.3 的 `src/init-iife.js` 将 `window.confirm` 替换为 async 函数，返回 `Promise<boolean>`。DOM 类型仍声明 boolean，所以 TypeScript 没有拦截旧写法。`if (window.confirm(...))` 立即把 Promise 当真；`!window.confirm(...)` 立即为 false，都会跳过等待。普通 Chromium 原生 confirm 是同步的，因此只在普通浏览器接受/拒绝原生弹窗的旧测试没有覆盖桌面问题。

## 审查结果与处理

| 入口 | 原问题 | 当前处理 |
|---|---|---|
| 全局/词条对话删除，`pages/Agent.tsx` | 未等待 Promise 就写 topic tombstone | 应用内异步确认；成功提交后话题才消失，存储失败显示错误并保留上下文 |
| 分类/子分类删除，`components/CategoryEditor.tsx` | 未等待就删除并重分配子类/条目 | 确认后才调用 `removeCategory` 的单次 batch；取消/失败不产生操作日志 |
| 条目删除，`pages/Entry.tsx` | 未等待就写 tombstone 并返回 | 确认后提交成功才返回；失败保留当前条目 |
| 丢弃未保存草稿，`components/editor/EntryTabs.tsx` | 对 Promise 取反导致立即关闭/清草稿 | 有脏草稿时等待确认；无修改的标签仅做普通导航关闭 |
| 从备份恢复设备设置，`pages/Settings.tsx` | 未等待就替换本机凭证和偏好 | 在用户已同意合并知识后，另外等待恢复设备设置的选择；取消保留当前设备设置 |
| 恢复云快照，`pages/settings/DatabasePanel.tsx` | 未等待就开始联网恢复 | 确认后才发起快照请求与合并 |
| 更新安装，`pages/settings/AboutPanel.tsx` | 未等待就下载/启动安装 | 确认后才进入下载校验和安装流程；OS 自己的安装授权继续保留 |
| 知识图关系删除，`pages/Graph.tsx` | 无确认，React Flow 删除后回调再写库；失败可能先丢界面连线 | 在 `onBeforeDelete` 等待确认并提交；始终阻止组件自行乐观删除，连线只由已提交的投影更新。支持 Delete/Backspace |
| MCP 配置移除，`pages/settings/McpPanel.tsx` | 无确认就移除设置草稿 | 确认后更新最新草稿，保存后才落库，避免等待期间覆盖其他设置修改 |

前 7 行共对应 7 处旧 `window.confirm` 调用，已全部移除。后 2 行补齐缺失的确认。

## 统一约束和验证

- `useConfirmation` 将取消、Close、Escape、遮罩与组件卸载解析为 false；`runConfirmed` 必须等待 literal true 才调用写入。不以 Promise/其他 truthy 值作为同意，重复点击不重复发起写入。
- 浏览器回归通过 `addInitScript` 模拟 Tauri 的 async `window.confirm`，分别验证全局/词条对话、知识图、脏草稿、MCP、云快照和设备设置取消路径；其他分类/条目删除回归继续核对完整 docs/events。
- 对话、分类、条目、知识图覆盖存储失败；确认拒绝/抛错与无结果由单元测试覆盖。检查实际 UI 实体是否仍在，而不只检查数据库。
- `scripts/confirmations.test.mjs` 扫描运行时代码，防止重新引入 `window.confirm` / `globalThis.confirm` 调用；应用必须通过统一异步确认入口。

## 已检查且不属于同一问题的操作

- Agent 知识写入和外部 MCP 调用已经 `await confirm(...)`，确认前无执行；原有回执/防重复与旧内容比对保留。
- AI 分类、保存前外部修改比较、存储迁移均由应用内明确按钮触发，未使用该错误的原生确认守卫。
- 编辑器内删除文字/块为正常可撤销编辑，未保存不改已提交条目；不为每次编辑加删除弹窗。
- Rust 中删除旧 checkpoint/恢复冗余、临时写入和更新 pending 文件属于已验证恢复/维护流程；没有发现通过前端异步确认守卫提前删除知识的路径。恢复清理仍要求可信副本和校验，历史/损坏原件/离线设备所需记录保持保留。

本轮浏览器模拟和 Rust 编译检查不等于 Windows 原生弹窗实机验证；用户已安装的旧包需重新构建/安装才包含修复。
