# Tasks

- [x] 建立共享 Task Graph Outcome parser/owner，并在 WorkContract admission 内原子调用。
- [x] 扩展 Task Graph commit，支持 revision-safe 地规划已有未分配 WorkItem。
- [x] 为 standalone proposal 原子排队依赖满足的 Task。
- [x] 为所有授予 proposal 的 WorkContract 冻结 Task Graph revision，并由 MCP Adapter 注入。
- [x] 为 `task_propose_graph`、`work_continue` 暴露完整 Schema和可定位输入错误。
- [x] 为非 Delivery `continue_work` 原子创建有界 continuation Inbox command。
- [x] 补 admission、MCP、Task Graph、continuation、历史升级和回放测试。
- [x] 同步长期技术文档并完成验证。
