# 实施任务（已归档）

## 切片 1：契约和发布 seam

- [x] 新增共享 `ProjectViewEnvelope` 类型。
- [x] 新增 room-scoped `ProjectViewPublisher`。
- [x] 补发布隔离测试。

## 切片 2：Runtime 展示投影

- [x] Runtime canonical event 映射到 `project:view`。
- [x] ACP text/thinking delta 映射到 `project:view`。
- [x] tmux/bridge output/exit 映射到 `project:view`。
- [x] WebUI 用单一消费者更新聊天、工具、计划、终端和活动态。

## 切片 3：被动消费、主动 Command 分离

- [x] 删除 `task.assigned` 浏览器派发。
- [x] 删除 `task.wakeup` 浏览器派发和任务推进。
- [x] 删除 `a2a:dispatch` 浏览器派发及 ACK。
- [x] 删除 `terminal:exit` 浏览器恢复派发。
- [x] 删除 `agent:error` 浏览器重排队。
- [x] 验证 Harness/Inbox 拥有对应执行职责。
- [x] 保留并测试人的显式 Command 入口，不把它误删为展示层副作用。

## 切片 4：项目隔离

- [x] 所有项目展示事件携带 `projectId`。
- [x] WebUI 消费前校验当前项目。
- [x] 项目切换清空瞬态投影。
- [x] Daemon 状态恢复按项目过滤。

## 切片 5：收敛与验证

- [x] 任务/A2A/observability room 事件补齐项目门禁。
- [x] 更新 wiki 事件清单，删除过期 `task.ready`。
- [x] 运行相关单测、类型检查和构建。
- [x] 完成代码评审与交付审计。
