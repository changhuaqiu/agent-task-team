# 验收清单

## 对象与数据

- [ ] 新工作项拥有独立 `workstream` Conversation 和根 Task。
- [ ] Project workspace 不再接收新工作项 Task Graph。
- [ ] 旧 Project workspace Task 可作为 legacy 工作项打开。
- [ ] GitHub Issue 复用相同目录的 Project，重复 webhook 不产生重复工作项。

## UX

- [ ] Project 默认打开概览且不挂载聊天输入器。
- [ ] 工作项列表按状态分组并能进入统一详情。
- [ ] 工作项详情展示目标、子任务、活动和按角色分列的交付件。
- [ ] Project 活动只读聚合且可追溯工作项。
- [ ] 切换工作项不会串用消息、草稿或 selected Task。

## Agent 完成路径

- [ ] Agent 上下文默认限制在当前工作项，只注入必要 Project 摘要。
- [ ] 工作项完成由根 Task、Artifact 和 Review/Gate 证据闭环决定。
- [ ] Project 进度只汇总工作项事实，不使用聊天文本或 Runtime 结束凑数。

## 质量

- [ ] repository/command/API/component 测试通过。
- [ ] TypeScript、全量测试和生产 build 通过。
- [ ] 浏览器宽屏/窄屏与新旧项目路径通过。
- [ ] 新桌面 EXE 已构建并验证 build identity。
- [ ] 文档、规格、wiki 和 STORY 与实现一致。

