# 0.24 重要性与学习取舍（正式发布）

正式[v0.24.0](https://github.com/txsdx/ZhiNexus/releases/tag/v0.24.0)于北京时间2026-10-31 02:18:26发布，源码`2fe56543584ba8c5f6dd1af0a8ecd1f3cee29aa3`。新增124–128全部接入、对应验收及正式发布完成。

[Build41102913797](https://github.com/txsdx/ZhiNexus/actions/runs/41102913797)全组成功：253单元（43文件）、47脚本、117浏览器（5.5分钟）及生产构建16.19秒；Windows11项/Ubuntu12项原生边界、Windows完整真实实包和Android arm64/Kotlin/固定签名验证通过。四资产实际下载、版本/URL/字节/SHA-256、公开tag与匿名latest.json、Android包名/递增versionCode/图标及SDK35/37相同证书均已核对。详见[ITERATION_024](ITERATION_024.md)。

实现：三等重要性、人工锁定/恢复自动与独立AI建议、全路径免复习与迟到保护、等级筛选/组合检索/批量/AI工具、七日当前计划预览。保留所有FSRS卡片/次数/历史，参见[IMPORTANCE_DESIGN](IMPORTANCE_DESIGN.md)。模拟WebDAV/本地HTTP SSE不等于用户真实提供商或自建服务；未做实体Android安装/通知验收。

## 逐项结果

- 124：高/普通/低的单一importance寄存器；未设置默认普通，不写迁移、不重置卡片。解释/整理有独立真实流式importance阶段和可编辑模板，失败保留成功解释与原等级。
- 125：人工锁定、恢复自动、单独AI建议、提案人工修订、右键/批量；后来的manual优先；解释/等级/回执一次原子提交，关闭/失败/重试与并发保护。
- 126：队列、包含未到期、角标/概览、AI查询、通知排程及自主/AI实际写入共用免复习资格；低等保留会话/卡片/次数/历史，恢复等级后续接。高等只优先已到期工作。
- 127：原四列内紧凑标识、importance结构过滤/中文别名、23个现有工具扩展；曲线可明确查看免复习项。七日预览只统计每项当前下次计划，本地日历/DST，日明细点击导航。
- 128：IMPORTANCE_DESIGN记录实际Anki手册/源码与Obsidian公开文档、许可证边界及不采用设计；全部规格和维护规则进入初始提示词。

## 实际验证

- 本地253单元（43文件）、47发布脚本、117浏览器全量（5.3分钟）、生产构建15.50秒、修改文件Prettier/diff检查通过。CI对应253/47/117（5.5分钟）、生产构建16.19秒。
- 首轮完整110/116：新阶段需要补请求/日志夹具的合法评估响应与次数断言；标题测试精确定位标题按钮避免badge前缀；恢复既有星图过时提示原文。补独立评估场景时等待实际异步弹窗关闭后读持久状态，没有人工sleep或删除断言。最终117/117全量已通过。
- 新增8个完整浏览器场景：取消/失败与持久人工等级、四列/筛选/批量/右键、队列/暂停恢复、真实HTTP SSE评估及审阅重启、生成期间人工修改、模拟WebDAV新客户端校验读回、触屏/深色/七日日明细、独立评估修订/恢复自动和可编辑模板。模拟协议/本地提供商不等于用户真实服务。
- 六张实际浏览器隔离示例截图，Asia/Shanghai，pageerror=0，390px视口body=390px；已生成独立离线HTML预览，不冒充实体机截图。
- Windows11项/Ubuntu12项原生边界通过。Windows实包实际执行：公开匿名更新、置顶可缩放不透明捕获/OS关闭与图片草稿、唯一主写者、快捷键/OCR/非默认端口代理/模型/真实SSE/MCP stdio、SQLite、系统/portable隔离、重启/损坏恢复与双模式单exe helper替换/坏交接拒绝。
- Windows CI首帧864ms，后续287/274/256ms；driver+startup4005/796/745/719ms。EXE32,243,200字节，较0.23增加8,192字节；仅有限CI样本，不声明跨硬件速度保证。
- Android arm64/Kotlin编译、包名/递增versionCode、API35、15图标像素及adaptive21dp安全区通过。实际APK与0.23同一固定证书：`3ca565872acafd9121a3fde847d6da82df43d3f3ba96f453220218c538e55d5f`，SDK35/37标准PEM/DER签名复验。没有新密钥或默认模拟器，也未做实体机安装/通知。

## 最终CI作业

|作业|Job ID|结论|
|---|---:|---|
|signing|124224119153|success|
|frontend|124224268962|success|
|android|124228278744|success|
|desktop (windows, windows-latest)|124228278796|success|
|desktop (ubuntu, ubuntu-24.04)|124228278881|success|
|publish|124233723776|success|

## Release独立读回

Release ID `429348458`，published_at `2026-10-30T18:18:26Z`，非草稿/非预发布、latest。公开tag指向上述实际打包源码；后续仅更新交付文档，不重写tag或替换已发布资产。

|资产|实际字节|SHA-256|
|---|---:|---|
|ZhiNexus_0.24.0_amd64.deb|25,492,334|`430afec5dfa5498f743fe41db0b901bc63f14781dd1f0c512753a2338c476f2d`|
|ZhiNexus_android_arm64_0.24.0.apk|41,016,115|`456806ff266f9e44ec85ccb026c4a08142c8c573c40a68ed9deae60f695dc2af`|
|ZhiNexus_windows_x64_0.24.0_protable.exe|32,243,200|`91dccf567277f36f8fb9b6ca1359a6439959ba6379068cff923a8b587e4da795`|
|latest.json|96,178|`07f6e8d5e300ab56b2ecc07b35d6735218ff13cd90867fcc037cfd5cc70678df`|

三平台版本均0.24.0，schema2/commonVersion0.24、三个最终URL与包/清单摘要一致；仅一个Windows_protable.exe，无安装器。实际Release APK/DEB与先行核验CI包逐字节摘要相同，PE资源版本为0.24.0/x64，DEB元数据0.24.0/amd64。解包扫描EXE/APK/DEB未发现GitHub PAT/旧更新Token选择器或Android私有签名材料；latest.json同样无PAT。匿名latest/download/latest.json读回与本版清单完全相同。

旧临时签名首次迁移、实体设备/真实服务及大库性能的边界继续见KNOWN_ISSUES；不把通过的模拟和编译结果扩大成未测范围。
