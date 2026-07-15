# Platform Harness Loop

> 状态：active
> 日期：2026-07-14
> 依赖：`system-control-plane`、`context-manager`、`a2a-possession-contract`、`acp-runtime-integration`

## 1. 目标

将当前分散在浏览器 store、Task Wakeup、A2A Orchestrator、DispatchGateway 和 daemon 中的 Agent Loop 收拢为服务端可独立运行的 Platform Harness。

平台必须能够在没有浏览器在线的情况下完成：

1. 接收结构化触发；
2. 解析任务、角色、团队和执行配置；
3. 组装本轮上下文；
4. 经过控制面门禁派发到执行端口；
5. 观察执行事件和结果；
6. 更新持久状态并决定完成、等待、阻塞或继续。

## 2. 当前事实

- `TaskWakeup`、`AutonomyGuard` 和 `A2AOrchestrator` 已在服务端判断下一位 Agent。
- `TeamRuntime`、`ContextManager`、`DispatchGateway`、`ExecutionEnvelope`、session、invocation 和统一 `AgentEvent` 已存在。
- 实际 `dispatchToAgent`、上下文组装、busy 队列和部分退出处理仍在浏览器 store。
- daemon 同时承担控制、上下文之后的路由、凭据、进程、事件归一化和完成回写。
- ACP 正在独立分支接入；Harness 不依赖具体 ACP SDK，只依赖 Runtime Port。

## 3. 本期范围

### 包含

- 定义 `HarnessTrigger`、`HarnessDispatchPlan`、`HarnessOutcome` 和 `HarnessRuntimePort`。
- 实现服务端 `HarnessCoordinator`。
- 服务端解析 Conversation Team Runtime、Agent Profile 和 Context。
- `task.wakeup` 和 Autonomy Guard 直接提交 Harness Trigger。
- A2A dispatch 通过可注入回调提交 Harness Trigger。
- daemon 的现有执行链暴露为 Runtime Port；保留 `terminal:start` 兼容入口。
- 使用同一个 execution envelope、invocation 和 normalized AgentEvent 观察执行。
- 为 busy、配置缺失、上下文失败、运行失败提供稳定 reason code。
- 增加单元测试、daemon 集成测试和浏览器兼容测试。

### 不包含

- 本期不实现远程集群、跨主机选主或分布式队列。
- 不修改 ACP SDK、Catalog 或三个 ACP agent 的实现。
- 不一次删除浏览器兼容 dispatch、legacy backend、bridge 或 tmux。
- 不让进程退出自动等价于任务进入 review/done。
- 不新增一套平行任务状态机。

## 4. 核心模型

```ts
type HarnessTriggerSource =
  | 'user'
  | 'a2a'
  | 'workflow'
  | 'review_gate'
  | 'test_gate'
  | 'system';

interface HarnessTrigger {
  id: string;
  source: HarnessTriggerSource;
  conversationId: string;
  agentId: string;
  prompt: string;
  taskId?: string;
  fromAgentId?: string;
  chainId?: string;
  passId?: string;
  idempotencyKey?: string;
}

interface HarnessDispatchPlan {
  trigger: HarnessTrigger;
  engine: CliEngine;
  accountId?: string;
  runtimeId: string;
  systemPrompt?: string;
  prompt: string;
  projectPath?: string;
}

type HarnessOutcome =
  | { status: 'accepted'; envelopeId?: string }
  | { status: 'deferred'; reasonCode: 'agent_busy' }
  | { status: 'blocked'; reasonCode: string }
  | { status: 'failed'; reasonCode: string };

interface HarnessRuntimePort {
  isBusy(agentId: string, conversationId: string): boolean;
  execute(plan: HarnessDispatchPlan): Promise<HarnessOutcome>;
}
```

## 5. 权威边界

| 事实 | 唯一权威 |
| --- | --- |
| Task 状态与依赖 | Task Repository / Task Graph |
| 角色与团队策略 | Conversation Team Runtime |
| 本轮上下文 | Harness Context Planner / ContextManager |
| 是否允许派发 | DispatchGateway / policy gates |
| 是否正在执行 | ExecutionEnvelope + Runtime Port 活跃状态 |
| Session / invocation | Session Repository / Invocation Repository |
| A2A 持有与交接 | A2A Possession Repository |
| UI busy/stream | 服务端事实的投影，不是调度权威 |

## 6. 服务端 Loop

```text
HarnessTrigger
  -> validate + dedupe
  -> load task/conversation/team runtime
  -> resolve role agent + enabled account + engine
  -> ContextManager.assembleContext
  -> HarnessRuntimePort.execute
  -> DispatchGateway envelope lifecycle
  -> normalized AgentEvent / tool mutation / A2A response
  -> task notification + wakeup resolver
  -> next HarnessTrigger or terminal outcome
```

### 6.1 触发规则

- `owner_ready`、`dependency_resolved`：派发任务 owner。
- `review_requested`、`stale_review_gate`：派发 reviewer。
- `review_decision_ready`、`unblocked_unassigned`：派发 coordinator。
- `test_requested`、`stale_test_gate`：派发 QA。
- evidence recovery、`runnable_owned_idle`：派发 wakeup 指定角色。
- A2A 只在 possession/pass 门禁通过后提交 trigger。

### 6.2 幂等与忙碌

- 同一 `idempotencyKey` 在 TTL 内只能有一个 accepted dispatch。
- busy 不能丢消息；返回 `deferred/agent_busy`，由触发源保留或重试。
- 进程活跃状态和非终态 ExecutionEnvelope 任一表明 busy 时，不得重复启动。
- 浏览器兼容监听收到 `handledByHarness=true` 的 wakeup/A2A 事件时不得再次派发。

### 6.3 结果归约

- runtime 完成只更新 invocation/envelope，不自动更新业务 Task 为 review/done。
- 任务状态只能由结构化任务 mutation/tool 经过 gate 后改变。
- Agent 文本中的可执行 handoff 仍由 A2A Orchestrator 解析，并生成下一条 trigger。
- runtime 失败记录 reason code；是否重试由 Harness policy 决定，不由 UI 临时定时器决定。

## 7. 兼容迁移

1. 新增 Coordinator 和 Runtime Port，保持 `terminal:start` 原行为。
2. Task Wakeup 先由 Harness 尝试处理；无法解析运行配置时发兼容事件给浏览器。
3. A2A 采用同一模式，并保留现有 ACK/失败回执。
4. 用户直接 @Agent 后续迁入 Harness；本期不强制切换。
5. ACP Runtime Port 验收通过后替换 legacy Runtime Port，Harness 上层契约不变。
6. 当所有触发都由服务端闭环且兼容指标为零后，删除浏览器调度权威和本地队列。

## 8. 可观测性

每次 trigger 至少记录：

- trigger id、source、conversation、task、target agent；
- context report 或上下文失败 reason；
- runtime/profile 解析结果但不记录凭据；
- accepted/deferred/blocked/failed outcome；
- envelope id、invocation id（可用时）；
- 是否走 compatibility fallback。

## 9. 退出条件

- 没有浏览器连接时，`owner_ready` 可启动一次真实或 mock Runtime Port 执行。
- 同一 wakeup 重复到达不会重复执行。
- busy Agent 的 wakeup 不丢失且不会并发重复启动。
- 配置缺失有明确 `runtime_profile_missing`，不会静默失败。
- A2A 可直接进入服务端 Runtime Port，同时保留旧客户端兼容测试。
- ACP 与 legacy backend 均可通过同一 Runtime Port contract 接入。
- 定向测试、类型检查和生产构建通过。
