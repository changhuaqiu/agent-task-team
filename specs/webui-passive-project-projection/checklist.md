# 验收清单

## 被动展示职责

- [x] WebUI 收到展示事件后只更新 Store。
- [x] WebUI 不因任务、协作、退出或错误展示事件启动 Agent。
- [x] WebUI 不发送 A2A 执行结果 ACK。
- [x] 服务端 Inbox/Harness 是唯一执行入口。
- [x] 人的点击、输入和确认仍能通过正式 Command/API 产生平台事件。
- [x] 自动展示消费者与 Human Command adapter 是两个独立入口。

## 项目隔离

- [x] 服务端项目事件只发往项目 room。
- [x] 缺少项目标识的事件被拒绝。
- [x] 非当前项目事件不改变 Store。
- [x] 切换项目不残留上一项目瞬态状态。
- [x] Daemon 恢复状态仅包含请求项目。

## 契约

- [x] Runtime 结构化事件使用 `project:view`。
- [x] `project:view` 有版本、项目、类型和时间。
- [x] ACP 与 tmux/bridge 都能形成项目展示事件。
- [x] 未知版本和未知类型不会触发业务动作。

## 验证

- [x] 发布模块单测通过。
- [x] Store 项目隔离测试通过。
- [x] Runtime projection 测试通过。
- [x] task-flow/A2A/Harness 回归测试通过。
- [x] TypeScript 类型检查通过。
- [x] 生产构建通过。
- [x] 设计文档和 wiki 已同步。
