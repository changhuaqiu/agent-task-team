# 验收清单

## 对象与数据

- [x] 新工作项拥有独立 `workstream` Conversation 和根 Task。
- [x] Project workspace 不再接收新工作项 Task Graph。
- [x] 旧 Project workspace Task 可作为 legacy 工作项打开。
- [x] GitHub Issue 复用相同目录的 Project，重复 webhook 不产生重复工作项。

## UX

- [x] Project 默认打开概览且不挂载聊天输入器。
- [x] 工作项列表按状态分组并能进入统一详情。
- [x] 工作项详情展示目标、子任务、活动和按角色分列的交付件。
- [x] Project 活动只读聚合且可追溯工作项。
- [x] 切换工作项不会串用消息、草稿或 selected Task。

## Agent 完成路径

- [x] Agent 上下文默认限制在当前工作项，只注入必要 Project 摘要。
- [x] 工作项完成由根 Task、Artifact 和 Review/Gate 证据闭环决定。
- [x] Project 进度只汇总工作项事实，不使用聊天文本或 Runtime 结束凑数。

## 质量

- [x] repository/command/API/component 测试通过。
- [x] TypeScript、全量测试和生产 build 通过。
- [x] 真实浏览器宽屏、新旧项目路径与窄屏响应式结构断言通过。
- [x] 新桌面 EXE 已构建并验证 build identity。
- [x] 文档、规格、wiki 和 STORY 与实现一致。
