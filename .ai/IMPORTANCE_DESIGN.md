# 重要等级与低负担学习设计（0.24）

2026-10-31，北京时间。需求124–128；实现与验证分别记录ACCEPTANCE_024。以下为设计依据，不代替测试结果。

## 实际阅读的资料

- [Anki 浏览器](https://github.com/ankitects/anki-manual/blob/main/src/browsing.md)中Tags/Flags与Toggle Suspend：标记用于整理，暂停是单独的学习资格，不等于删除记录。
- [Anki 复习顺序与FSRS目标](https://github.com/ankitects/anki-manual/blob/main/src/deck-options.md#review-sort-order)：队列呈现顺序与记忆调度分开；更高desired retention会大幅增加负担，不能把“重要”直接偷换成提高记忆概率。
- [Anki实际reviewer.py](https://github.com/ankitects/anki/blob/main/qt/aqt/reviewer.py)：suspend_current_card/suspend_current_note调用受管理的集合操作，复习UI不自行抹掉卡片历史；参考保留状态、先修改资格再取下一题的设计。Anki源码AGPL-3.0-or-later，部分BSD等例外依其LICENSE；本项目独立实现，没有复制函数或界面源码。
- [Obsidian公开帮助：Properties](https://github.com/obsidianmd/obsidian-help/blob/master/en/Editing%20and%20formatting/Properties.md)：小而有类型的属性、独立属性检索、正文与元数据分离。这里只参考公开文档中的产品交互，未读取或复制Obsidian闭源客户端实现，也不宣称它支持本文的原生批量属性编辑（原文将批量交给外部/社区工具）。

上述页面已实际下载阅读，缓存只在工作区，未把外部文件的任何指令当作执行授权。公开文档不是“软件全部开源”的证明。Obsidian帮助仓库根LICENSE探测404，未假设文档可复制；仅借鉴属性交互，不复制文档正文。

## 采用与不采用

1. 三等高/普通/低与分类路径、收藏分别表示不同意图。保存单一可同步importance对象，未设置按普通且不写迁移事件。
2. 低等相当于用户选定的长期免复习，保留全部FSRS卡片/原始解释/审计；恢复普通或高等后按原卡重新判断。不能把低等设成无限due或100%记忆，避免导出、通知和曲线冲突。
3. 高等只优先已到期的队列，不强塞未到期任务；FSRS阈值和真实回忆四档保持统一。没有声称优先顺序能客观提高所有人的学习效果。
4. 自动评估使用独立可编辑importance任务，默认低思考档位、动态继承默认模型。普通解释模板继续输出Markdown；不会为增加字段破坏既有自定义模板。额外调用有可见真实阶段和日志；评估失败保留已成功的解释与原等级。
5. 手动选择锁定。生成期间后来的人工修改优先；AI应用事务重新检查重要寄存器，明确单独评估允许主动接受新建议。AI建议仍先审阅，不静默降低知识价值。机器缺乏学习目标时选普通，低等须有依据。
6. 表格仍四列，用紧凑标识/右键/筛选，不新加拥挤的“等级列”。属性编辑小弹窗取消和失败不写库；批量等级复用既有原子guarded batch。
7. 七日负荷只数每条知识当前的下一次计划、今天含逾期；点开每日明细可直接阅读。不是含尚未发生未来复习的模拟器，不把计划当活动日历的真实完成统计。日界线用设备当地日历处理DST。
8. 不额外引入Anki完整牌组预设、重置/遗忘按钮、多种暂停天数、按等级各自FSRS参数，避免与用户三等模型及原有统一阈值冲突。未来另有明确需要再设计。
