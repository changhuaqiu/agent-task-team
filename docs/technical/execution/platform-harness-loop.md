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
- daemon 兼容入口的参数解构、诊断日志和 preflight 校验不得引用浏览器环境全局变量；所有日志字段必须来自显式 payload 或已解析 plan，且诊断代码不得位于可捕获错误边界之外而中断执行。
- 用户消息必须先写入聊天事实源，再触发 dispatch；runtime 是否 busy 不能影响消息可见性和持久化。
- 浏览器与 daemon 的 busy 快照可能短暂不一致。浏览器首发 dispatch 时必须暂存原始请求；若 daemon 返回 `agent_busy`，原始请求必须按 `(agentId, conversationId)` 恢复到 pending queue，不能只更新 UI 状态或展示“已排队”。
- 上一条仅适用于浏览器拥有的普通派发。精确绑定 DeliveryRun 的 wakeup 即使同步得到 `agent_busy/deferred`，也仍由服务端 Supervisor 重试；其可见 wakeup 必须标记为 `handledByHarness`，浏览器不得恢复到 pending queue。
- 角色没有可用账号或执行引擎时，派发必须在启动前终止并向聊天区写入可操作提示；内部 `invocation.aborted` 事件不能替代用户反馈。

### 用户入口路由

- 一条普通用户消息只能建立一个团队闭环入口。存在多个角色引用时，首个可解析的 `@Agent` 是本轮入口角色；后续 `@Agent` 只作为任务描述与协作上下文，不得被浏览器并行派发。
- 下游角色必须由当前持有者通过正式 A2A handoff 唤醒，不能因为用户正文提到下游角色而绕过 possession、handoff packet 与通信策略。
- 群发或并行启动属于独立的显式平台动作，必须由无歧义的 UI/协议字段表达；普通聊天正文中的多个 mention 不是群发协议。
- `chat_message.mentions` 仍保留全部引用用于展示和检索，但 dispatch target 与 user→agent pass 只记录入口角色。

### Runtime 工具与平台事实源边界

- 底层 CLI 自带的 `Task`、`Agent`、`SendMessage`、`TodoWrite/TodoRead` 只属于该 runtime 的本地协作能力，不得被解释为平台 Task Graph、A2A possession 或 dispatch receipt。
- 平台自定义工具只有在 runtime 实际暴露精确名称（例如 `task_create`）时才可调用；prompt 中的 schema 文本不等于工具已注册，Agent 不得用相似名称的原生工具替代。
- 平台任务工具缺失时必须 fail closed 并提交结构化 blocker；`.ath/TASKS.md` 始终是只读投影，不能作为兼容写入口。最终可见回复中的 actionable `@agent 请/需要 + 动作 + 对象` 仍可形成 A2A pass draft，不得调用 runtime-native `SendMessage` 代替 A2A。
- 当前持有者输出 actionable handoff 后必须立即结束本轮，不继续替目标角色读取、实现或等待底层子 agent；平台只在该轮完成边界扫描输出并转移 possession。
- daemon 只把平台工具白名单转交给 `tool.invoke`；未知或 runtime-native 工具仅做观测，不得异步伪装成平台工具执行。

### Runtime 工作目录

- `use_worktree=true` 时，runtime cwd 使用 conversation 对应的 Git worktree。
- `use_worktree=false` 且 conversation 配置了有效 `project_path` 时，runtime cwd 使用该真实项目路径，使项目文件和位于其子树内的绝对 TASKS 路径处于同一权限边界。
- 只有 conversation 没有项目路径时才回退到 agent scratch workdir；scratch 不能覆盖一个已配置的真实项目根目录。

### Outcome Reducer

- runtime accepted 可以把 ready owner 的 Task 从 pending 推进到 in_progress；
- runtime success 只代表本轮执行结束，不代表实现证据或交付证据通过；
- in_review/done 仍只能由结构化 task mutation/tool 经过 gate 后进入。
- TASKS.md watcher 同时消费文件首次创建的 `add` 和后续更新的 `change`，但只执行 Task Graph → 文件的一致性校正；文件事件不是任务 mutation 入口。
- Agent 完成边界在 A2A response scan 之前强制执行一次只读投影校正。Task Graph 的结构化 mutation 已先于文件投影成立；handoff 不依赖或等待文件反向同步。

### Context Policy 与闭环观测

- `ContextManager` 以 `scenario × archetype` 选择六类信息簇，场景包括 init、iterate、handoff、wakeup、closure；
- handoff/wakeup 默认省略 dialog，使用 possession packet 或任务卡作为本轮 focus；
- daemon 在完整输出聚合后校正 `TASKS.md` 只读投影；Task Notification/Wakeup 只消费结构化 Task Graph mutation，使 `review` 能立即进入 quality gate。随后执行合法出口观测，失败只写 `no_valid_exit` proof，不重试、不阻断；
- TeamPack workflow state is the gate-routing authority: ordinary `quality_gate` work starts its configured owner once; advisory reviewers are not fanned out unless a risk-specific transition requests them.
- Entering `review` / `in_review` is itself the quality-gate dispatch request. After writing that state, the implementer must end the turn without a manual `@reviewer` A2A handoff; only an explicit platform wakeup failure or a separately justified specialist review may create another pass.
- Browser auto-proposal is only a human first-turn convenience. Agent, system, tool, and error messages cannot trigger it. Daemon process-start admission reserves `(conversation, agent)` before asynchronous setup so duplicate browser tabs cannot race-start the same role.
- Workdir names encode project/agent/task IDs as safe path segments; raw business IDs, including scoped task IDs, are never concatenated directly into a Windows path.
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

- Agent 已 busy，需要沿用现有客户端排队；队列项必须保留原始 prompt、task、source、fromAgentId 和 conversationId；
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
- `terminal:exit` 仅用于客户端运行态与日志投影；任务阻塞、恢复和补证据派发均由服务端 Harness、Dispatch Gateway 与 Supervisor 负责，客户端不得保留兼容性写回或恢复逻辑。

## 测试策略

- Coordinator：accepted、duplicate、busy、blocked。
- Planner：真实 repository role/account/context 解析与缺配置错误。
- Registry：无浏览器提交与显式 fallback。
- Reducer：只允许 pending -> in_progress，不越过质量门禁。
- File projection：`TASKS.md` 永不取得业务状态权威。无论 invocation 是否终止，文件中的 `todo/doing/review/done/blocked` 都不能改变数据库 Task；watcher 发现漂移后恢复结构化 Task Graph 的权威值。
- A2A：server-owned dispatch、启动确认和 client fallback。
- A2A possession：当前 holder 的完成回复一旦产生下一棒，必须先把当前 possession 与入站 pass 置为 completed，再派发下一 worklist entry；后续 offer timeout 不得反向污染已成功的上游 pass。
- A2A intent scope：先出现的完整 actionable 交接不会被后续“不要 @ reviewer”等另一对象约束反向否定；正向动作与否定约束都按局部子句判定。
- A2A closure verbs：`汇总`、`总结`、`收口`、`给出结论` 是 coordinator 的合法可执行动作，与实现、评审、验证同样能够形成 pass intent。
- Store：`handledByHarness` 不双派发，旧事件仍可执行。
- Mention dispatch：多 mention 消息只派发首个有效入口角色；busy-before-send 与 client/server busy race 都必须保持用户消息和 dispatch 请求不丢失；恢复入队后只在真正启动时登记 A2A chain。
- Tool boundary：runtime-native 协作工具不触发平台 `tool.invoke`；精确平台工具不可用时提交结构化 blocker，不回退编辑 TASKS.md；可见且 actionable 的 A2A 文本仍由协议层单独判定。
- Workdir：worktree、真实非 worktree 项目路径、无项目 scratch 三种决策分别覆盖；另覆盖 Windows 保留字符与 scoped task ID 的安全路径编码。
- Dispatch admission：非 human 消息不触发 proposal；同一 `(conversation, agent)` 的并发 start 只有一个能进入异步 runtime setup。
- Gate routing：默认团队普通 review 只启动 Peach，DK 保持按需。
- Gate de-duplication：实现角色进入 review 后不得再手工 @ 默认 reviewer；Task Wakeup 是普通质量门的唯一启动事实。
- Dependency de-duplication：Task Notification Publisher 同时理解 task edges 与 TASKS.md dependencies，并且是 dependency_resolved / unblocked_unassigned 的唯一 wakeup 生产者；watcher 不保留前端直发兼容分支。
- Daemon smoke：使用隔离数据目录和已安装的 ACP test runtime 从 `terminal:start` 跑到 AgentEvent/`terminal:exit`，覆盖 payload 解构、preflight 日志和协议适配。

## 验证结果

- Vitest：110 个测试文件、1004 个测试全部通过；
- TypeScript：`pnpm exec tsc --noEmit` 通过；
- Production build：Next.js 16.2.4 `pnpm build` 通过；
- Windows 测试夹具已统一处理路径分隔符、默认分支和 POSIX 权限差异。
