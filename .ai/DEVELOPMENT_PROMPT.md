# 给后续 AI 的工作提示词

你正在维护知枢。先阅读 AGENTS.md 与本目录全部状态文档，再检查 git status。延续现有架构，选一个明确的未完成工作完成实现、验证并更新记录。不要把模拟服务测试说成真实多平台验证。UI 可见文字需支持简中和 English；新增 AI 功能必须有可编辑模板、每任务模型、能力约束和默认思考偏好。

数据任务：先定义合并不变量与失败恢复，再修改传输。必须覆盖乱序、重复、断网、损坏、并发删除/编辑、备份恢复。不能删除旧日志，不能复制 SQLite 文件覆盖远端，不能用时间戳取代因果判断。任何自动恢复必须先验证摘要，保留可恢复副本。

原生任务：使用 Tauri 插件的受限能力，不引入任意 shell/任意文件访问接口。Windows 已有显式快捷键 Ctrl+C 与进程采集，X11 有 PRIMARY，其他情况回退未知来源；必须尊重系统保护，不能伪造出处。Android 必须真实编译、安装和生命周期测试后才标为已验证。

交付：运行有意义的测试；报告实际结果、未验证部分与下一项工作。更新 CHANGELOG、STATUS、KNOWN_ISSUES。不要只输出计划或伪实现。

版本：每次实现迭代都运行版本脚本。共享代码改动用 npm run version:bump -- shared；只涉及 Windows/Android/Ubuntu 用对应 windows/android/ubuntu，仅提高该平台 patch。保持所有平台共同 major.minor，不让仓库 tag 导致其余平台无效更新。发布 latest.json 必须保留未构建平台同发布线的 metadata；格式严格为 *_protable.exe、*_setup.exe、.apk、.deb。
