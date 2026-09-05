# Tasks

- [x] T1 冻结 Result success、Path convergence、Execution efficiency 指标与基线。
- [x] T2 深化 WorkLifecycleReconciler，加入 Invocation/A2A 事件收尾与启动恢复。
- [x] T3 增加 task `completed_at` 写入与历史回填 migration。
- [x] T4 将 WorkAuthority、AgentOutcome 纳入 EvalSnapshot，并增加确定性路径指标。
- [x] T5 清理正式交付件中的 proof-only 独立卡片。
- [x] T6 终结已退役 handler 的遗留 queued delivery。
- [x] T7 运行固定场景、全量测试、类型检查、生产构建和真实数据库升级核验。
- [x] T8 独立代码审查、修正、提交、合并并推送。
- [ ] T9 修复 Coordinator accepted Task Graph 的全图激活语义，并以新 handler 版本重放恢复历史滞留 Task。
- [ ] T10 在 WorkItem 详情展示 Task 状态、依赖阻塞与执行不一致告警。
- [ ] T11 以“优化项目结构及UX”旧任务完成桌面升级、真实恢复、唯一派发和进度可见性核验。
- [ ] T12 补充 C 级评测、独立代码审查、构建、合并、推送与 EXE 更新。
