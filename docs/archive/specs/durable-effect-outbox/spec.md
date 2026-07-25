# Durable Effect Outbox

> 状态：implemented
> 日期：2026-07-25
> 归档日期：2026-07-25
> 历史实施契约：本目录
> 依赖：已归档 `platform-runtime-events`、`a2a-possession-contract`、
> `autonomous-delivery-loop`、`agent-observability`
> 长期设计：`docs/technical/execution/durable-effect-outbox.md`

## 1. 问题

Durable Dispatcher 已保证 `PlatformEvent × handler` 至少一次投递，但 durable handler
完成后产生的副作用仍由调用者自行保证：

- `RuntimeCompletionProcessManager` 通过 `runRuntimeCompletionStep()` 把动作和 SQLite
  receipt 包在一起，只对同一数据库事务内的写入成立；
- `task-sync` 捕获异常后仍提交 receipt，瞬时失败会被永久视为完成；
- Socket、文件系统和未来远程调用不能随 SQLite 回滚；
- Runtime completion 的 task sync、proof、evaluation、team log、A2A response/done
  六个动作集中在 daemon 的 `complete()` 回调里，重试、顺序和错误语义分散在调用点。

因此当前系统只证明“事件会再次交给 Process Manager”，没有统一证明“由事件决定的
副作用会被持久接纳、恢复并按既定顺序执行”。

## 2. 目标

建立一个平台级 Durable Effect Outbox 深模块，放在 Process Manager 与不可回滚 I/O
之间：

```text
Platform Event
  -> Process Manager
  -> 同事务：completion 状态 + Effect Command 批量入 Outbox
  -> commit
  -> Effect Worker claim
  -> Effect Adapter
  -> success / retry / dead letter
```

首个生产采用者是 Runtime completion。Process Manager 只决定“应该发生什么”并返回
Effect Commands；Effect Outbox 统一承担：

- 批量原子接纳和幂等冲突检测；
- lane 内严格顺序；
- attempt、lease、fencing、超时和崩溃恢复；
- 有界重试与 dead letter；
- 数据库事务型动作和外部幂等动作的不同完成语义。

## 3. 非目标

- 不新增第五类 `PlatformEvent`；Effect Command 是执行意图，不是业务事实。
- 不把 Socket 实时通知升级为 durable 事实。
- 不承诺对不支持幂等键的外部系统实现 exactly-once。
- 不改变 Task、A2A、Review、Delivery 或 Evaluation 的事实 owner。
- 本迭代不强制把所有既有队列迁移到 Effect Outbox。

## 4. 深模块与 seam

模块对生产者暴露一个批量接纳 interface，对执行端暴露注册与运行 interface：

```ts
interface DurableEffectOutbox {
  enqueueBatch(input: {
    sourceEventId: string;
    laneKey: string;
    effects: Array<{
      type: string;
      targetKey: string;
      payload: unknown;
    }>;
  }): DurableEffect[];

  register(registration: {
    type: string;
    execution: 'transactional' | 'idempotent';
    execute(command, context): void | Promise<void> | AfterCommit;
    maxAttempts?: number;
    timeoutMs?: number;
  }): void;

  recover(): RecoveryResult;
  drain(limit?: number): Promise<DrainResult>;
}
```

实现隐藏 row 状态、attempt、lease token、退避和 receipt。Effect Adapter 是真实 seam：
生产环境有 task-sync/evaluation/A2A 等多个 adapter，测试使用内存 adapter。

## 5. Effect Command 契约

每条 command 至少包含：

- `id`、`sourceEventId`；
- `type`、`targetKey`；
- `laneKey`、`laneSequence`；
- `idempotencyKey`；
- JSON payload；
- `queued | running | succeeded | dead_letter`；
- attempt、next-attempt、lease owner/expiry、current attempt、last error；
- created/updated/completed 时间。

默认幂等键：

```text
effect:<sourceEventId>:<type>:<targetKey>
```

同一幂等键和同一内容重复接纳必须返回原 command；内容不同必须抛稳定冲突错误。
同一 batch 的全部新 command 与调用者的领域状态更新在同一 SQLite 事务中提交。

## 6. 顺序与失败语义

- 同一 `laneKey` 按 `laneSequence` 串行；前驱 retry 时后继不可 claim。
- 前驱 `succeeded` 或 `dead_letter` 后后继可继续，避免永久堵塞整条 lane。
- 不同 lane 可并行 claim。
- claim 使用 worker + attempt token fencing；旧 worker 不得提交新 worker 的结果。
- 进程退出后，过期 running attempt 标为 `abandoned`，command 重新排队。
- 失败按有界退避重试；达到 `maxAttempts` 进入 dead letter。
- handler 超时只触发协作取消；必须等待本次执行真正释放后再结算 attempt。

## 7. 两种执行模式

### 7.1 `transactional`

用于所有可在当前 SQLite connection 内完成的同步动作。Adapter 动作与 command
`succeeded` 在同一事务提交：

- 动作失败：领域写入和 success receipt 一起回滚；
- 动作成功后进程退出：success receipt 已与领域写入一起提交；
- Adapter 不得返回 Promise；违反时抛稳定配置错误。

Adapter 可返回 `AfterCommit`，只用于 Socket 等 best-effort 通知。AfterCommit 在事务提交后
执行，失败不把 durable command 重新排队。

### 7.2 `idempotent`

用于文件系统、远程服务或其他不能加入 SQLite 事务的动作。Adapter 必须接收并向下游传播
`idempotencyKey`；崩溃可能造成再次调用，因此系统只承诺 at-least-once。

不支持幂等键的外部动作不得注册为 durable effect，除非动作本身是可安全重复的收敛操作。

## 8. Runtime completion 采用

`runtime.invocation.terminated` 的 Process Manager 纯规划以下 lane：

| 顺序 | Effect | 条件 | 执行模式 |
| --- | --- | --- | --- |
| 1 | `runtime.task_sync` | production invocation | `idempotent`，文件读取 + 收敛同步 |
| 2 | `runtime.valid_exit_proof` | 有场景且退出无效 | `transactional` |
| 3 | `runtime.closure_evaluation` | closure、有效退出且有 task | `transactional`；Socket 走 AfterCommit |
| 4 | `runtime.team_log` | production invocation | `idempotent`，文件投影是收敛操作 |
| 5 | `runtime.a2a_response` | output 非空 | `transactional`；领域状态 + Inbox + receipt 同事务，Socket/内存/timer AfterCommit |
| 6 | `runtime.a2a_done` | production invocation | `transactional`；推进状态 + receipt 同事务，进程态 AfterCommit |

held-out evaluation invocation 不产生 production effects。

Process Manager 的完成边界改为“全部 Effect Commands 已原子接纳”；具体 effect 的最终状态
由 Outbox 事实表示。旧 `runtime_completion_step_receipt` 退出生产路径；migration 先将
已提交步骤转成只读 effect suppression，再删旧表，pending context 只规划未完成 effect。

## 9. 可观测与安全

- command payload 不得包含密钥、认证头或完整工具输入。
- `last_error` 存储截断后的可读错误，不存 stack 中可能出现的秘密。
- Effect 状态和 attempts 可供诊断查询，但不进入用户主界面。
- Socket 通知保持 best-effort，不作为 effect 成功条件。

## 10. 退出条件

- Effect batch 与 Runtime completion 状态在同一事务提交。
- 幂等重复返回原 command；内容漂移产生稳定冲突。
- lane 顺序、跨 lane 并行、retry、dead letter、lease recovery 和 fencing 有自动化测试。
- lease recovery 消耗 attempt 预算，到限 dead-letter 并释放 lane。
- transactional adapter 的动作与 success receipt 原子；异步误用被拒绝。
- idempotent adapter 在“动作成功但 receipt 未提交”的故障注入下收到同一幂等键。
- `task-sync` 失败不再被记为成功，能够重试。
- Runtime completion 六类动作全部退出 daemon 内联 step receipt。
- A2A 内部任意失败在 receipt 前回滚 chain/worklist/Inbox，重试后保持一条 chain、一个
  worklist entry、一个 Inbox Command。
- Socket 通知只在 durable 数据提交后 best-effort 发送。
- 旧 `runRuntimeCompletionStep` 和生产 `runtime_completion_step_receipt` 被删除。
- TypeScript、相关测试、全量测试和 production build 通过。
- 长期设计、Wiki 和 Spec 状态同步。

## 11. 实施证据

- 深模块：`src/server/platform-events/durable-effect-outbox.ts`。
- 首个采用者：Runtime completion planner、六类 adapter 与 Platform Event worker。
- migration 52：Effect command/attempt、v51 suppression bridge、旧 step receipt 退场。
- 自动化：确定性全量 180 files / 1393 tests 通过，1 项既有 skip；TypeScript、改动文件
  ESLint 与 production Turbopack build 通过。
- 真实 Claude ACP handoff repro 依赖外部进程/凭据，连续两次在其自带 120 秒边界超时；
  该测试不触及本规格路径，作为环境型复现测试单独报告，不伪装成确定性门禁。
- 可复用结论已进入长期技术设计与 backend daemon Wiki；无需另建重复 knowledge 条目。
