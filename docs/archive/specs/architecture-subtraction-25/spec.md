# Architecture Subtraction — Round 25

> Status: implemented
> Date: 2026-08-15

## Goal

收窄 `TaskHubState` 的浏览器 Store interface，删除八个没有真实生产调用方的 action，避免把旧迁移、恢复、浅 selector 和自测构造器继续伪装成受支持能力。

## Evidence

全仓符号搜索显示前七个 action 均只有 `TaskHubState` 声明和 `appSlice` 实现两处命中，没有 UI、测试、middleware、Socket 或其他 Store slice 消费者；第八个只有声明、实现及其自身单元测试，没有生产调用方：

- `setHasHydrated`：真实水合状态由 `loadFromServer()` 直接写入；测试也使用 Zustand `setState`，该 action 从未调用。
- `mergeLegacyChatMessages`：旧聊天迁移函数没有 persist migration 或启动入口；当前消息由 `/api/state`、`/api/messages` 与实时 delta 对账。
- `getConversations`：只返回 `get().conversations`，不增加筛选或不变量。
- `getEventsForSelectedConversation`：未被 UI 使用的 selected-project 浅 selector。
- `getDispatchReceiptsForSelectedConversation`：未被 UI 使用的 selected-project 浅 selector。
- `restoreConversation`：独立恢复 action 无入口；`deleteConversation` 的失败回滚已在同一事务流程内直接恢复完整聚合。
- `fixBlocker`：无按钮、命令或事件调用；保留它只会形成浏览器单方面修改 blocker 事实的旁路。
- `createProgressMessage`：只有针对该 helper 本身的三条单元测试，生产 UI、Socket 和消息投影均不调用；它产出的 `progressData` 也没有其他生产者，因此连同专用类型和 `ProgressMessageCard` 消费尾巴一起删除。真实进度继续由普通聊天、任务通知和工程协作 metadata 展示。

`Blocker.status = 'fixed'` 与 `blocker.fixed` 事件词汇不随 action 删除：服务端 TASKS.md 格式仍使用 fixed 状态，浏览器持久化中也可能存在历史 blocker/event，保留它们属于格式兼容而非领域写旁路。

## Contract

1. 删除上述八个 action 的 `TaskHubState` 声明和 `appSlice` 实现，并删除只验证死 helper 自身的测试及其不可达 `progressData` UI 尾巴。
2. 保留真实使用的 `hasHydrated` 状态、`loadFromServer()` 写入与 persist rehydrate migration。
3. 保留消息快照/实时对账、`deleteConversation` 内部失败回滚、`openBlocker` 展示投影和 `recordDispatchReceipt` Socket 写入。
4. 不新增替代 wrapper；组件需要原始状态时直接使用 Zustand selector，需要领域命令时调用已有正式 Human Command interface。
5. 不改变持久化 schema、localStorage version、Socket protocol、API 或 UI 行为。

## Exit Criteria

- 生产代码和 `TaskHubState` 无八个退役 action。
- 架构守卫阻止这些零消费者 action 回流。
- Store 水合、消息对账、项目删除回滚、blocker 展示与 dispatch receipt 回归通过。
- 长期 Store 文档明确 interface 只保留真实消费者和真实命令。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 初始定向回归：6 files / 70 tests 通过；修复独立复审意见并加入第八个 action 后，最终定向回归 8 files / 85 tests 通过，覆盖水合、消息对账、完整项目删除回滚、blocker/receipt 投影、消息扩展、消息组渲染与全 Store 架构守卫。
- `pnpm build`：通过；仅保留既有 Next.js NFT tracing warning。
- 全量：204 files / 1512 tests 通过，2 files / 2 tests 跳过；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：修复两项初始 Minor（全 Store 防回流范围、完整聚合回滚断言）和一项后续 Important（无 producer 的 `progressData` UI 尾巴）后，最终 Critical 0 / Important 0 / Minor 0，Ready: Yes；复审方另行复跑相关 4 files / 48 tests 通过。
