# Project / WorkItem 作用域技术设计

> Status: Implemented
> Date: 2026-08-31
> Active spec: `specs/project-workitem-hierarchy/`

## 背景

`conversation_id` 长期同时承担消息线程、Task Graph、Runtime、DeliveryRun 和历史“项目”隔离键。Project 一等对象落地后，
Project workspace Conversation 仍被当作所有新工作的写入目标，导致 Project scope 与 WorkItem scope 再次合并。

## 决策

不新增第二套消息或执行事实源。现有 Conversation 退回内部 scope adapter：

- `workspace_kind=project_workspace`：Project 级历史讨论、成员与项目运行摘要的兼容空间，不承载新工作项 Task Graph。
- `workspace_kind=workstream`：一个用户工作项的活动、Task Graph、Invocation 与自主交付作用域。
- `workspace_kind=historical_workstream`：迁移前的工作流；只读投影为旧工作项或历史项目讨论。

服务端新增 `ProjectWorkItemProjection`，以 `project_id + conversation_id + root_task_id` 形成稳定读模型。创建工作项时，
`CommandService` 在同一事务中创建 workstream Conversation、根 Task 和 `work.created` 事件。Renderer 只消费该投影，不自行猜测根任务。

## 写入链

```text
Web / CLI / MCP
  -> work.create(projectId, title, category, description)
  -> CommandService transaction
      -> create or replay deterministic workstream Conversation
      -> create or replay root Task in that Conversation
      -> append work.created scoped to workstream
  -> CommandReceipt { projectId, conversationId, task }
```

幂等键同时决定 Conversation 和根 Task 身份；重放不得产生空 workstream。任一步失败，事务整体回滚。

## 读取链

`/api/state` 继续提供 Project、Conversation 和 Task 的基础水合，以保持现有实时投影兼容。前端使用共享的纯函数
`projectWorkItems(project, conversations, tasks)` 产生：

- 新式工作项：Project 下每个 `workstream` 的根 Task；
- 待规划工作项：GitHub Issue 已建立 workstream、Runtime 尚未生成根 Task 时，以 Conversation 标题和目标显示为 `proposed`，不隐藏已接收的 Issue；
- 旧式工作项：Project workspace 中无法归入子 workstream 的顶层 Task；
- 子任务：同 conversation 内除根 Task 外的 Task；
- 工作项活动 scope：新式使用 workstream Conversation，旧式暂用 Project workspace 并标记 legacy。

服务端投影成为后续收敛 owner 后，前端兼容纯函数删除。退出条件是 state/API 直接返回权威 WorkItem View，且不存在裸 Task 猜测。

## GitHub Issue 接入

Webhook 先通过 `projectRepo.getByRootPath(config.projectPath)` 幂等解析 Project，再创建带 `project_id` 的 workstream Conversation。
Issue ingress 映射保存该 workstream Conversation 与 DeliveryRun；同一 Issue 的唯一约束保持不变。
在 DeliveryRun 首次规划产生根 Task 前，读模型保留一个“等待任务规划”工作项；根 Task 出现后自动切换为权威任务状态。

不存在 Project 时允许在同一事务中创建 Project；Project 创建和 Issue workstream 创建必须共享事务，不留下半成品对象。

## 上下文与完成边界

- Runtime、Task Graph、消息和自主交付以 WorkItem conversationId 隔离。
- Project context contributor 可注入项目摘要和同目录冲突信号，但不注入其他工作项原始消息。
- 完成判断以工作项根 Task、当前 authority、正式 Artifact、Review/Gate 为闭环；Project 只汇总。
- Project workspace 的运行摘要不得因选中子 workstream 漂移。

## 迁移与退出条件

数据库迁移为已有 Project workspace 顶层 Task 建立可投影兼容身份，不复制 Task 或消息。历史消息继续留在原 Conversation。
新创建工作全部使用独立 workstream。待所有旧工作结束或显式归档后，禁止 `work.create` 写入 Project workspace 的兼容断言成为硬门禁。
