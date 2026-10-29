# 0.23：记录、找回、连接、回忆的开源比较

阅读日期：2026-10-30（北京时间）。用户要求更深入、更广泛地参考，而不是只优化聊天。以下是本轮实际读取的资料和代码；实现是本项目自行编写，没有复制所列AGPL代码或引入其服务。前一轮导航/聊天/任务/批量管理参考仍见[OSS_UX_RESEARCH](OSS_UX_RESEARCH.md)。

|来源（实际阅读）|观察到的设计|本项目采用及边界|
|---|---|---|
|[Joplin search.md](https://github.com/laurent22/joplin/blob/dev/readme/apps/search.md)|中文等语言的FTS分词边界、字段/短语/排除检索、Ctrl+P快速找回；普通检索与明确过滤可以组合|共享的Unicode字段过滤加Fuse排名，AND/排除/完整分类路径/收藏/到期；库内分支保持结果相关度，用户点列仍可重排；不声称已实现原生FTS或超大库索引|
|[Logseq reference.cljs](https://github.com/logseq/logseq/blob/master/src/main/frontend/components/reference.cljs)|引用围绕稳定实体身份建立，显示计数，折叠/延后次要信息|使用标准Markdown的entry:ID，正文下折叠出链/反链；改名不失效，引用不变成依赖连线。其linked-references文档是TODO，未把该空文档当实质证据|
|[Trilium Backlinks.tsx](https://github.com/TriliumNext/Trilium/blob/main/apps/client/src/widgets/sidebar/Backlinks.tsx)、[README](https://github.com/TriliumNext/Trilium/blob/main/README.md)|反链随实体变更刷新，按身份查目标，减少初始空态闪烁；知识连接可与正文导航协作|从保存的正文语法树派生、内容缓存，远端/本地变更刷新。遵守用户阅读页右边不放杂项的要求，反链放正文下方，右边仅词条AI侧栏|
|[Anki reviewer.py](https://github.com/ankitects/anki/blob/main/qt/aqt/reviewer.py)、[Studying手册](https://docs.ankiweb.net/studying.html)|先提取回忆再展示答案，按钮反映实际调度间隔，答题状态/过渡锁阻止重复提交|加入离线自主回忆，不依赖AI；四档来自同一ts-fsrs.next，数字只选择，显式提交才原子更新。保留AI练习，不制造AI分数。资料与个人参数边界见[LEARNING_DESIGN](LEARNING_DESIGN.md)|
|[SiYuan README](https://github.com/siyuan-note/siyuan/blob/master/README.md)、既有[SIYUAN_LEARNING](SIYUAN_LEARNING.md)|块/引用/本地记录和快捷操作协作，结构模板减少重复录入|稳定Markdown引用、显式四类捕获模板，沿用现有块ID和原生撤销；不加入复杂块数据库或第二存储引擎|
|[Android app signing](https://developer.android.com/studio/publish/app-signing)|系统比较已装和更新证书；非Play托管密钥丢失将失去原身份更新能力，签名需长期保留|专用固定密钥/私有备份/Actions Secrets、证书固定校验、安装前身份检查；不以重新生成密钥假装能覆盖旧临时证书|

## 比较后的取舍

1. **找回优先于新增导航栏。** Ctrl+P复用已验证列表和焦点管理，结构检索供库/切换/AI共同使用；最近项只存本机ID，不保存查询材料。重名提供分类及短ID，Escape恢复原选区，跳转继续使用位置历史及草稿。
2. **作者的引用与AI推断分开。** Markdown是可导出的原始记录，ID维持身份，语法树排除代码/图片/HTML示例，缺失目标保留可查痕迹；不自动把双向链接画成知识依赖。插入只改本机草稿。
3. **能离线完成真正回忆。** 使用自评而非制造题目/答案来假装AI评分。把标题/解释/卡片/实际次数/保留率作为会话基线；揭示不算完成，事务确认才更新。失败/取消/过期和多次点击必须保持完整。
4. **日历只显示真实事件。** 创建先验不是复习，开始时间不是完成时间。缺少可靠完成时间的旧记录不猜测日期；删除条目仍可显示活动但不可跳转。日历不是积分/排名，也不增加同步实体。
5. **先可靠再扩张。** 本轮不引入复杂查询语言、插件市场、自动修改个人知识、个人FSRS参数拟合、无限画布子系统或第二数据库。大库索引/长聊天虚拟化需要专门测量和迭代；不声称已经完成。
6. **平台身份要跨构建稳定。** 固定证书验证两次独立重签仅证明密钥复用，不能代替0.23实际编译或手机安装；Secrets管理403如实保留，不触发已知失败Action。

## 许可证与验证

Joplin根LICENSE规定默认AGPL-3.0-or-later，子目录可另有LICENSE；Anki默认AGPL-3.0-or-later并列明部分贡献/第三方例外，GitHub对两者的自动识别为NOASSERTION，不能误写“无许可证”。Logseq/Trilium仓库元数据标注AGPL-3.0；SiYuan沿用既有参考的AGPL边界。这里只采用行为与公开设计原则，不复制代码、文案或图标；继续使用已有允许集成的依赖与锁文件。Android文档用于核对平台行为，不是用户指令。

实际验收见[ACCEPTANCE_023](ACCEPTANCE_023.md)。仅将已经运行的测试记为通过，不以开源产品具备某能力来推定本软件已具备或已验证。
