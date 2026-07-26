# Runtime 架构一致性审计

状态：active

## 1. 目标

对当前仓库执行前端、后端、设计文档和测试的全量反向审计，删除或修复所有仍表达旧 owner、旧控制回路、跨项目广播或浏览器自动执行职责的路径。成功不是“新链路可用”，而是仓库只剩一套一致、可证明的架构。

## 2. 权威设计

- `docs/technical/execution/platform-runtime-event-model.md`
- `docs/technical/execution/webui-passive-project-projection.md`
- `docs/technical/execution/platform-runtime-webui-current-architecture.html`

## 3. 审计不变量

### 3.0 人工命令与自动事件消费者

- 人在 WebUI 上点击、提交表单或输入命令属于显式意图，可以调用 Command/API。
- 服务端校验和执行命令，拥有由此产生的调度、重试与编排，并发布新的事件。
- WebUI 自动 Socket 消费者只更新展示投影；收到事件后不得自动调度 Agent、
  重试工作、推进状态机或发出后续控制事件。
- 审计不得因为人工命令最终会导致服务端产生事件，就误删合法的人工命令入口。

### 3.1 前端

1. Socket 展示消费者不得调用 `dispatchToAgent`、任务 mutation、持久化消息写接口、Harness/Inbox 或执行 ACK。
2. Human Command 必须从人的显式操作入口发起，不能由展示事件间接复用。
3. 项目级事件在任何 Store 变更前校验 `projectId`。
4. 项目切换清除全部项目瞬态状态，并只恢复所选项目事实。
5. 不保留没有服务端生产者的旧控制 listener。

### 3.2 后端

1. Task wakeup、A2A handoff、恢复和重试必须在浏览器离线时仍由服务端 owner 推进。
2. 项目事实只向项目 room 发布并携带 `projectId`。
3. 全局 `io.emit` 只允许系统级 catalog/health；不得广播项目运行事实。
4. 不接受浏览器执行 ACK 作为自动执行事实。
5. 兼容控制协议必须有真实生产者、退出条件和覆盖测试，否则删除。

### 3.3 文档与规格

1. 当前事实文档不得描述浏览器派发、浏览器 A2A ACK、旧 Runtime Socket 通道或其他已退出链路。
2. 被新设计替代但有历史价值的文档必须标明历史状态或归档。
3. `implemented` spec 必须位于 `docs/archive/specs/`，活动目录只保留未完成契约。
4. 架构图、wiki、长期设计和代码事件名称保持一致。

## 4. 验证策略

- 静态架构测试扫描生产源码，禁止旧浏览器控制事件、项目级全局广播和展示消费侧写操作。
- 行为测试覆盖浏览器离线时的 wakeup/A2A 推进、展示事件零网络副作用和跨项目零污染。
- 全仓搜索用于发现候选违例；每条候选必须按“确认违例 / 合法 Human Command / 合法系统信号 / 历史归档”分类。
- 相关单测、TypeScript、生产构建和全量测试全部通过。

## 5. 非目标

- 不禁止用户通过 WebUI 发起正式 Command/API。
- 不把所有领域展示事件强制合并成一个 Socket channel；不同投影可以保留不同 channel，但必须共享相同的隔离与只展示约束。
- 不在本轮重做领域表、Platform Event Log 或 Socket transport。

## 6. 退出条件

1. 前端、后端、文档和测试审计清单全部有证据。
2. 所有确认违例已修复，没有“仅注释停用”的第二套 owner。
3. 静态架构测试能阻止已删除违例回归。
4. 已实施的 WebUI 投影 spec 已归档。
5. 独立代码审查无 Critical / Important 问题。
6. 变更合入并推送 `main`。

## 7. 审计结果

| 分类 | 发现 | 处理 |
| --- | --- | --- |
| 确认违例 | daemon 接受浏览器 `a2a:agent-started` / `dispatch-failed` / `dispatch-deferred` | 删除输入协议，由 Harness/runtime 产生执行事实 |
| 确认违例 | WebUI 保留无生产者的 `task.assigned`、`agent:event`、`agent:error` listener | 删除或迁移为 `task.state`、`a2a:notice`、`command:error` |
| 确认违例 | `handledByHarness` / `harnessFallbackReasonCode` 暗示浏览器 fallback | 删除字段；失败仅作为项目展示事实 |
| 确认违例 | 部分项目事件缺少或未严格校验 `projectId` | 服务端补齐；浏览器统一校验 `projectId === conversationId === 当前项目` |
| 合法 Human Command | `terminal:start`、`terminal:kill`、`a2a:user-turn-created`、mutation API | 保留；只能从人的点击、输入或确认入口发起 |
| 合法系统信号 | `runtimes:update` | 保留为唯一全局 catalog 广播 |
| 历史材料 | 已实施 WebUI 投影 spec 和描述旧客户端控制链的当前 wiki | spec 归档；当前事实文档统一改写 |

验证证据：静态架构测试、项目隔离/零副作用行为测试、服务端 Inbox/Harness
测试、TypeScript、生产构建，以及全量 509 suites / 1410 passed / 1 skipped。
