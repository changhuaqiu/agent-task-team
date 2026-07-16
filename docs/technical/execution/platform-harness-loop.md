# Platform Harness Loop

> 当前状态：服务端闭环第一阶段已落地（2026-07-14）。ACP Runtime Port 由独立分支接入。

## 定位

Platform Harness 是角色 Agent 与底层执行运行时之间的服务端闭环。它不替代 Task Graph、A2A、ContextManager 或 Runtime Adapter，而是明确这些模块的调用顺序与事实权威。

平台 Agent 是一个项目角色实例。OpenCode、Claude、Codex 或其他 ACP Agent 只是该角色某一轮使用的执行端口。

## 当前落地链路

```text
Task mutation / Autonomy Guard / A2A pass
  -> TaskWakeup or A2A dispatch request
  -> HarnessCoordinator admission
     -> idempotency
     -> runtime busy check
  -> RepositoryHarnessPlanner
     -> conversation + task
     -> TeamRuntime + enabled account
     -> ContextManager
        -> resolve scenario + role archetype
        -> apply cluster injection policy
  -> Harness Runtime Port
     -> daemon terminal execution compatibility entry
     -> DispatchGateway / ExecutionEnvelope / Proof
     -> backend or future ACP runtime
  -> normalized AgentEvent
  -> task tool / A2A response / invocation outcome
  -> next wakeup or terminal state
```

## 模块职责

### HarnessCoordinator

- 接收结构化 trigger；
- 在组装上下文前完成幂等和 busy admission；
- 调用 Planner 和 Runtime Port；
- 记录 accepted、duplicate、deferred、blocked、failed proof；
- 不直接推断 review/done。

### RepositoryHarnessPlanner

- 从 Conversation、TeamPack、RoleCard、Account、Skill、Task、Message 和 Session 仓库读取本轮事实；
- 通过 TeamRuntime 解析角色与执行 profile；
- 通过 ContextManager 组装 server-owned prompt；
- 输出与具体 Runtime SDK 无关的 `HarnessDispatchPlan`。
- 按 trigger source 区分 user turn、A2A handoff 与系统 resume，并把 wakeup reason 和已解析 scenario 透传到执行完成边界。

### Harness Runtime Port

- 判断当前角色在 conversation 内是否 busy；
- 接收完整 plan 并提交执行；
- 当前实现复用 daemon 已有执行入口；
- ACP 分支只需实现相同端口，无需修改 Task、A2A 或 Context 层。

### Outcome Reducer

- runtime accepted 可以把 ready owner 的 Task 从 pending 推进到 in_progress；
- runtime success 只代表本轮执行结束，不代表实现证据或交付证据通过；
- in_review/done 仍只能由结构化 task mutation/tool 经过 gate 后进入。

### Context Policy 与闭环观测

- `ContextManager` 以 `scenario × archetype` 选择六类信息簇，场景包括 init、iterate、handoff、wakeup、closure；
- handoff/wakeup 默认省略 dialog，使用 possession packet 或任务卡作为本轮 focus；
- daemon 在完整输出聚合后执行合法出口观测，失败只写 `no_valid_exit` proof，不重试、不阻断；
- autonomy guard 按 `subtask_of` 的 child → parent 边递归判断完整子树，终态后唤醒 planner 收敛；
- closure dispatch 写持久 proof，后续扫描以 `(conversationId, rootTaskId, reasonCode)` 去重。

### Team Log Projection

- `chat_message` 与协作型 `control_proof_event` 保持事实源地位，TeamLogProjection 将其物化为 active workdir 内的只读 `.ath/team-log.md`；
- ContextManager 不再推送群聊正文，只在 situation 簇注入 ≤150 token 的未消费摘要信封；handoff/wakeup 按当前 task 过滤；
- Harness plan 携带本轮 envelope 的 `upToEntryId`，daemon 仅在本轮完成后推进 `agent_log_cursor`，不会误消费执行期间新到的消息；
- hot 视图受 50 条、24 小时和 5KB 三重上限控制；7 天内溢出按日归档，更早内容进入 INDEX 摘要并继续以 DB 为 cold source；
- 用户直发尚未完全迁入 Harness 时，daemon 对缺少 envelope snapshot 的 terminal payload 做一次兼容补位；迁移完成后删除该分支。

## 兼容机制

服务端接受 wakeup/A2A 后，Socket 事件携带 `handledByHarness=true`。浏览器仍展示事件，但不会再调用 `dispatchToAgent`。

以下情况显式回退旧客户端路径：

- Agent 已 busy，需要沿用现有客户端排队；
- 服务端缺少 runtime profile；
- 服务端上下文组装失败；
- Runtime Port 在派发前拒绝请求。

回退事件携带 `handledByHarness=false` 和 `harnessFallbackReasonCode`，因此不会静默丢失。

## 状态权威

| 状态 | 权威 |
| --- | --- |
| Task 生命周期 | Task Repository / Task Graph |
| Agent 角色和协作策略 | Conversation Team Runtime |
| Context | ContextManager + repository providers |
| Dispatch 生命周期 | ExecutionEnvelope / DispatchGateway |
| 进程与会话 | Runtime Port / Session / Invocation |
| A2A 持有权 | A2A possession/pass |
| UI busy 和流式内容 | 服务端状态投影 |

## 已知迁移边界

- 用户直接 @Agent 仍由浏览器首发；Task Wakeup、Autonomy Guard 和 A2A 已优先走服务端。
- busy 时仍回退浏览器内存队列；下一阶段应替换为持久 dispatch inbox。
- daemon 仍包含 legacy backend、bridge 和 tmux 分支；ACP 完成后应收敛到单一 Runtime Port。
- `terminal:exit` 中仍有部分客户端兼容恢复逻辑，待所有触发迁移后删除。

## 测试策略

- Coordinator：accepted、duplicate、busy、blocked。
- Planner：真实 repository role/account/context 解析与缺配置错误。
- Registry：无浏览器提交与显式 fallback。
- Reducer：只允许 pending -> in_progress，不越过质量门禁。
- A2A：server-owned dispatch、启动确认和 client fallback。
- Store：`handledByHarness` 不双派发，旧事件仍可执行。

## 验证结果

- Vitest：104 个测试文件、989 个测试全部通过；
- TypeScript：`pnpm exec tsc --noEmit` 通过；
- Production build：Next.js 16.2.4 `pnpm build` 通过；
- Windows 测试夹具已统一处理路径分隔符、默认分支和 POSIX 权限差异。
