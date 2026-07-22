# Team Harness 自主交付闭环技术设计

**状态**：Accepted
**日期**：2026-07-19
**关联规格**：`specs/autonomous-delivery-loop/`

## 决策

系统的核心不是增加一个更强的“多 Agent 调度器”，而是构建一个能支撑团队自身 Loop 的 **Team Harness Environment**。

单 Agent Harness 为 Agent 提供项目上下文、工具、工作目录和执行反馈，使 Agent 能完成“观察—决策—行动—验证”的局部循环；Team Harness 则为整个团队提供共享目标、项目知识、团队关系、任务图、交接协议、运行事实、质量证据和外部系统回执，使团队能完成“观察—路由—执行—评审—修复—交付”的协作循环。

`AutonomousDeliverySupervisor` 是 Team Harness 内部的确定性 reconcile 内核，而不是系统大脑。它对外隐藏跨阶段状态机、并发 claim、恢复、重试、Provider 副作用和最终收口，但不代替 Agent 做需求理解、方案设计和实现判断。

不新增 “Boss Agent”。Coordinator/Leader Agent 负责理解目标、拆解与语义路由；系统 Supervisor 负责确定性推进和完成判定。

## 架构

```mermaid
flowchart TB
  U["用户：目标 + 验收标准 + 授权"] --> GC["GoalContract / DeliveryRun"]

  subgraph THE["Team Harness Environment"]
    direction TB

    subgraph CE["可感知的上下文环境"]
      KB["项目知识库 / 代码 / 历史决策"]
      TEAM["团队角色 / 能力 / 协作协议"]
      TG["Task Graph / A2A / Shared Memory"]
    end

    subgraph AL["Agent Team Loop：语义决策"]
      P["规划 / 路由"]
      W["实现 / 协作"]
      R["评审 / 修复"]
      P --> W --> R --> P
    end

    subgraph CK["确定性控制内核"]
      S["Reconcile / Recover / Derive / Claim"]
      CI["Policy / Lease / Idempotency / Closure Invariant"]
    end

    subgraph AP["可行动的环境端口"]
      EP["Execution Port"]
      VP["Verification Port"]
      PP["Provider Action Port"]
    end

    subgraph EF["可验证的事实与反馈"]
      EN["Execution Envelope"]
      VR["Build / Test / Web UI E2E Receipt"]
      PR["PR / CI / Merge Receipt"]
      RS["Receipt Store"]
    end
  end

  GC --> CK
  CE --> AL
  CK --> AL
  AL --> AP
  AP --> EF
  EF --> CK
  CK --> CE

  CK -->|证据闭环成立| DB["DeliveryBundle"]
  CK -->|超出授权或恢复耗尽| EX["最小异常升级"]
  DB --> U
```

## Team Harness 的责任边界

| 层次 | 负责什么 | 不负责什么 |
|---|---|---|
| Agent Team Loop | 理解目标、设计方案、拆解任务、实现、评审与修复 | 不自证最终完成，不直接越权操作外部系统 |
| Context Environment | 提供项目知识、团队信息、共享状态与当前可执行事实 | 不把所有上下文无差别塞进提示词 |
| Control Kernel | 对账、恢复、租约、幂等、策略门禁和完成不变量 | 不做开放式业务/技术方案判断 |
| Action Ports | 将执行、验证、GitHub 等副作用变成受控能力 | 不允许 Agent 绕过授权直接产生不可恢复副作用 |
| Evidence Plane | 保存执行信封、验证结果和 Provider 最终回执 | 不接受 Agent 自述作为权威完成事实 |

这使系统具备两个同时成立的特性：Agent 有足够环境自主形成自己的 Loop；平台又能以机械事实约束安全、恢复和最终交付。

## Skill / Tool Capability Plane

Team Harness 采用“复用能力、统一环境”的策略：

```text
SkillRuntime / ACP / MCP / Browser / Provider CLI
                    ↓ adapters
       Context Contributor + Capability Snapshot
                    ↓
       Policy / Scope / Idempotency / Receipt
                    ↓
               Agent Team Loop
```

- Skill 负责方法、领域知识和工作流；平台不复制 Skill 正文或重新定义其步骤。
- ACP/MCP/runtime 注册结果拥有“工具是否可调用”的事实；Prompt 中声明的工具名称不构成能力。
- Browser/Playwright 负责真实 Web UI 操作；Verification Port 负责编排标准、环境、Receipt 和修复预算。
- Provider 官方工具负责外部操作；Gateway 负责授权、幂等、精确对象和终态对账。
- Context Contributor 是这些能力进入某一轮 Agent 环境的统一 adapter；任何来源不得直接拼接 Prompt。

因此，平台需要建设的是可组合 Harness，不是不断扩大的私有工具箱。

## 为什么现有 Autonomy Guard 不够

现有 guard 从 Task、Envelope 和时间推导 wakeup，并使用进程内 Map 做短期去重。它适合发现局部停滞，不具备：

- 顶层交付契约；
- 跨进程的 action claim；
- attempt lease 和失败分类；
- Provider receipt；
- 跨 Review/QA/CI/Merge 的 closure invariant；
- 交付结果幂等发布。

因此 guard 的规则应逐步收进 Team Harness 的控制内核；daemon 只保留“事实变化通知 + 周期 reconcile”。

## 持久化模型

### `autonomous_delivery_run`

- `id`
- `conversation_id`
- `root_task_id`
- `status`
- `goal_contract_json`
- `current_stage`
- `repair_cycle`
- `revision`（Run 级 CAS/fencing 版本）
- `escalation_code`
- `delivery_bundle_json`
- `created_at / updated_at / completed_at`

Supervisor 每次基于 `facts.observe(snapshot)` 写回状态时，必须携带该快照的 `revision`；
更新成功后原子递增版本。若等待外部事实期间 Run 已被取消、升级或由其他 worker 推进，
旧决策写回失败并重新读取当前事实，不能把终态回退为非终态。`root_task_id` 在 Task
删除时使用 `ON DELETE SET NULL`，项目删除再由 `conversation_id` 级联清理整个 Run。
对曾运行未发布 checkpoint 的数据库，不能只相信 `_schema_version` 水位；前向结构修复迁移会补建缺失表，并在关闭外键校验的单事务中重建旧 Run 表，提交前执行 `foreign_key_check`，保证已有 Run/Action 不丢失。
历史 checkpoint 可能已经写入 v42 水位，却仍保留不含 `revision` 或错误 `root_task_id` 外键的旧表。v43 必须在该水位之后重新校验这些结构不变量，幂等补列或重建 Run 表，并保留既有 Run/Action 数据；结构修复成功前不得启动 Supervisor。
项目删除入口必须使用 Conversation 聚合事务：先按依赖顺序清理 Task Graph、A2A、
运行时与观测投影，再删除 Task 和 Conversation；任一未知外键阻塞时整体回滚，禁止留下
“Task 已删但项目/Run 仍存在”的部分状态。前端只有在该事务成功后才展示删除成功提示；
当前不提供无法恢复完整 Task Graph 的伪“撤销”。

### `autonomous_delivery_action`

- `id`
- `run_id`
- `kind`
- `subject_type / subject_id`
- `idempotency_key UNIQUE`
- `status`
- `not_before`
- `attempt_count`
- `max_attempts`
- `last_failure_code`
- `created_at / updated_at`

### `autonomous_delivery_attempt`

- `id`
- `action_id`
- `attempt_no`
- `status`
- `lease_owner / lease_expires_at / heartbeat_at`
- `workdir_ref / session_generation / execution_envelope_id`
- `started_at / completed_at`
- `failure_code / failure_detail`

### `autonomous_delivery_receipt`

- `id`
- `run_id / action_id / attempt_id`
- `kind`
- `external_id`
- `status`
- `payload_json`
- `idempotency_key UNIQUE`
- `observed_at`

### Acceptance Verification Receipt

`task_graph.gate_evidence.accepted` 只是候选 Proof。Supervisor 只把其中符合以下契约的 `evidence.verificationReceipt` 转换为 `verification.acceptance` Receipt：

- schemaVersion 固定为 1；
- deliveryRunId 精确绑定当前 Run；
- status 为 passed/failed；
- verifierAgentId 与 Proof actor 一致，且属于当前 QA/质量门 audience；
- method 为 web_ui_e2e、automated_test 或 manual_review；
- reportRef、tool、specRefs 可定位真实执行产物；
- acceptanceResults 与 GoalContract 验收标准逐项同构，每个 PASS 项都有独立 evidenceRefs。

当 GoalContract 要求 Web UI E2E 时，只有 Browser/Playwright 产生的 `web_ui_e2e` 回执可通过门禁。旧式 `mainTestResult: "passed"`、任务完成状态或任意 delivery evidence 都不能代替该回执。
本地 reportRef/specRefs 还必须解析到授权 projectPath 内的真实文件，避免只提交一个看似合理的路径字符串。

Verification 状态区分：

- `not_started`：尚无验证 Action，Supervisor 创建 `run_verification`；
- `pending`：验证已派发，等待结构化 Proof；
- `failed`：执行失败或回执不合法，进入有界 repair；
- `passed`：存在当前 Run 的完整 PASS Receipt；
- `not_required`：GoalContract 明确不要求该类验证。

最终 DeliveryBundle 从有效 Receipt 逐项生成 acceptanceResults，不再把同一组 Proof 引用复制给全部验收标准。

### Acceptance Review Receipt

`done` 只说明 Task Gate 接受了状态变更，不等于独立 Review PASS。要求评审时，
Supervisor 只接受当前 TeamPack 质量门负责人提交的 `evidence.reviewReceipt`：

- 精确绑定当前 DeliveryRun；
- Proof actor 与 reviewerAgentId 一致，且 reviewerAgentId 属于 review gate audience；
- PASS 有摘要和 evidenceRefs；
- 没有未解决的 blocking/important finding。

合法回执持久化为 `review.acceptance` Receipt；无回执创建独立 `request_review`，
失败或非法回执进入有界 `repair_review`。

普通 Task Graph quality gate 使用同一“结构化事实优先”原则：Agent 只读 `.ath/TASKS.md` 投影，状态裁决通过 `task_update_status` 写入 Task Graph。被唤醒的 gate owner 只能裁决目标 `in_review` Task；PASS/REJECT 必须携带结构化 review receipt。平台在一次权威 mutation 中保存状态与 review note、发布通知并触发下一 wakeup。REJECT 进入 `rejected|blocked` 并唤醒原实现者；Invocation 仅输出 REJECT 文本不构成裁决，也不得导致 reviewer 以普通 execution 场景无限重派。

任务控制面能力由 Harness 按 invocation 授予，而不是由用户是否给某个 Agent 绑定 `task-management` Skill 决定。绑定精确 Task 的实现者、评审者和验证者获得 `task_list` / `task_update_status`；planner 角色额外获得 `task_create` / `task_assign`。Context Manager 将这些基础能力与 Skill 工具去重后，再与当前 transport 的真实注册名求交集，最终清单同时用于 prompt、观测和 ACP MCP grant。这样 Skill 负责专业策略，平台基础工具负责不可缺失的控制面契约。

`TASKS.md` 在所有 prompt 层中都必须保持只读投影语义。若当前 transport 没有注册所需的精确任务工具，Agent 只能报告结构化 blocker；任何“缺工具时直接编辑 TASKS.md”的兼容提示都属于失效路径，不能再次进入运行时上下文。

项目清单中的命令只能证明“命令入口存在”，不能证明它会形成一次性门禁证据。基础任务协议和 Project Context 的可信命令段都必须提醒 Agent：测试、构建与安装只有在进程正常退出时有效；watch 模式即使先打印 PASS，随后超时或被终止仍是失败。发现 `npm test` 等脚本进入 watch 后，应使用 runner 的 one-shot 形式（例如 `npx vitest run`）重新执行。

任务状态变更还有一条低延迟通知路径：平台任务工具提交状态后，Task Notification Publisher 会先于 Supervisor 的下一次 reconciliation 生成 review/test wakeup。该路径必须直接传递当前 Invocation 已验证的精确 `deliveryRunId`，让 Reviewer/QA 的 Terminal、Browser 等原生工具仍处于同一 Run 的动态授权边界。只把 Run ID 写进 prompt 不构成授权；无绑定的 watcher、手动变更与普通协作通知不得查询或猜测 Conversation 的“最新 Run”，并继续 fail-closed。

ReviewReceipt 使用严格的机器枚举：评审通过时任务提交 `status=done`，回执提交 `reviewReceipt.status="passed"`；评审拒绝时任务提交 `status=rejected|blocked`，回执提交 `reviewReceipt.status="failed"`。基础协议、review wakeup 与 task tool schema 必须重复这个精确映射，并声明 finding 的 severity/status/description/evidenceRefs 结构。校验错误应直接写明期望枚举和值的映射，避免 Reviewer 根据自然语言猜测 `pass`、`approved` 或 `done` 并陷入重试循环。

命令证据的事实来源是与当前 DeliveryRun、Task 和 Agent 绑定的真实 Shell observation span。门禁只解析该 Shell 调用输入的顶层 `command`/`cmd` 字段，并使用同类命令的最新真实执行结果；状态工具、评审工具或其他非 Shell 工具中作为说明文本出现的命令不得参与匹配。这样可以避免 `task_update_status` 自身携带的 evidence 命令描述被误识别为失败执行，并反向锁死 `in_review` 流转。

对于非 Git 实现任务，Agent 提交的 `installResult`、`buildResult`、`testResult`、`impactEvidence` 是面向评审的非空字符串摘要，不是执行事实本身；门禁同时要求这些摘要完整，并要求对应 Shell span 正常退出。结构化对象中的自报 `exitCode` 不得代替真实 span。

Action kind 不是执行场景的唯一来源。`advance_tasks` 取到 review/test wakeup 时必须分别使用 `code_review` / `verification` 场景，保证恢复派发仍保留角色边界和工具契约。

### 重启恢复

服务启动时立即扫描所有非终态 DeliveryRun，并在周期对账之前先执行一次 reconcile。
startup reconcile 在读取运行事实前必须把前一个本地 daemon 进程遗留的 `started` ExecutionEnvelope
（包括该 daemon 代理的 `bridge:*` 调用）持久化为 `expired`；否则它会永久伪装成活跃执行，阻止恢复 wakeup。periodic reconcile 只按 TTL
回收尚未 started 的派发状态，不得把当前进程内的正常长任务按初始 TTL 误判为中断。
Envelope payload 必须记录 `executorKind`、执行所有者节点和 Invocation 引用；`tmux_pane` 还必须在启动前
持久化 worktree 与每个 Envelope 独占的 tmux server 引用，pane ID 在原子创建返回后补写。即使 pane
创建后的补写失败或 pre-start Envelope 已按 TTL 过期，专属 server 引用仍是可恢复的 cleanup record。
重启只扫描启动瞬间已有的 tmux 执行，并在严格终止、再次查询确认 pane/server
不存在后才回收；kill 失败但独立查询确认 pane 已不存在可视为成功，查询不确定则保留 started/busy
所有权并在后续周期重试。重启后新建的 pane 不进入该重试集合。
Envelope 回收必须同步终结关联 Invocation 并释放 AgentBinding，不能留下外围 `running`/`busy` 假状态。
daemon/bridge 的 Envelope、Invocation 与仍指向该旧 Envelope 的 AgentBinding 必须在同一数据库事务内收口；
事务失败时保留启动节点的待恢复标记，由 periodic reconcile 重试。tmux 首次枚举失败也必须保持未就绪并在
periodic 重新枚举。旧 tmux 集合未全部严格清理前，daemon 的 dispatch readiness barrier 不开放，
避免新 pane 与旧 pane 清理并发或复用 pane ID；该 barrier 在执行事实观察/重新派发之前释放，避免恢复自锁。
任一 pre-reconcile 所有权检查失败必须中止整轮回收，不能继续过期 Envelope、删除待恢复节点或开放 readiness。
所有 reconcile cycle 必须串行；事务恢复成功后必须先移除旧节点恢复责任，再开放 readiness，防止重入周期
把本进程新创建的 Envelope 当作旧进程遗留项。tmux 创建命令必须通过同一命令原子返回 pane ID；后置设置
失败时由 gateway 自行严格清理，无法确认时必须把 pane 引用带回 daemon 保留 ownership。
`routed -> sent` 与 `sent -> started` 都必须使用“前置状态仍匹配且 TTL 未过期”的原子条件更新；
失败的旧启动链立即停止，不得把已被 reconcile 回收的 envelope 复活。
`started -> completed` 及非终态到 `failed` 同样采用条件更新；迟到的完成/失败回调不得覆盖
`expired` 或其他既有终态，也不得重复写入回执与释放所有权。
失败终态的 Envelope、仍指向它的 Binding 与关联 Invocation 必须由同一事务的 CAS 胜者更新；并发
kill/timeout/shutdown 的败者不得改写 Invocation 的终态原因。
无法证明执行器类型的 legacy `started` 记录必须始终 fail closed，不能依据重启后的 tmux 开关猜测；
进程内执行句柄与输出缓存按 Invocation 隔离，所有异步清理均校验句柄仍是当前所有者，force 也不得绕过同 key 的启动锁。
运行中 Attempt 的 lease 过期后会被持久化为 `abandoned`；恢复过程复用原 Action 的
idempotency key，在剩余预算内创建新 Attempt。恢复不依赖进程内 Map，也不会创建第二个
逻辑 Action。

根 Task 代表整次交付的编排承诺。存在非终态子 Task 时，根 Task 的历史、重启过期或
completed-without-status-change Envelope 不进入 no-progress 恢复计数，autonomy guard 与
Action executor 也不得从旁路重新唤醒根 Task，避免把仍在推进的 DeliveryRun 升级为
`poisoned_session`。daemon 的全局 autonomy-guard 定时扫描必须按尚未 `completed|cancelled` 的
DeliveryRun 计算并传入根 Task 恢复抑制集合；`escalated` 仍是 Delivery 控制态，即使根 Task 仍为
`pending` 且尚无子任务，也不能回落为普通 Task 的 `owner_ready`、`runnable_owned_idle` 或
`chain_ready_for_closure`。不能只用 `subtask_of` 边判断，因为自主交付子任务可能尚未投影这些边。
此时由子 Task 的 Envelope/Task 状态承担执行恢复。全部子 Task 首次终态后，
Repository 按稳定子任务 ID 集合写入一次不可变 `root.children.converged` Receipt，以该 Receipt
的 `observed_at` 开启新的根恢复 epoch；后续 `done → done` 或 artifacts/evidence 更新不能刷新
epoch。epoch 前的历史 Envelope 不消耗收口预算，再由 chain closure 或新的根恢复完成收口。
只有尚未拆出子 Task 的根执行从一开始就使用普通 Envelope 恢复预算。
若子任务出现前已持久化旧 root `advance_tasks` Action，Action adapter 以成功 no-op 和
`harness.dispatch.skipped` Receipt 将其收口；不得用 `transient_runtime` 消耗该 Action 的预算，
否则 max-attempts 内核会把已被子任务取代的旧动作误升级为整个 Run 失败。

长任务执行期间，Supervisor 按 lease 的固定分数周期刷新 `heartbeat_at` 和
`lease_expires_at`。Attempt 完成或失败时，Repository 还会校验它仍是 Action 的当前
`attempt_no`；已被回收的旧进程即使迟到返回，也无法覆盖新 Attempt 或追加 Receipt。

## 一致性规则

1. Action 推导是纯函数；副作用执行前必须先持久化。
2. 同一 `idempotency_key` 永远只对应一个逻辑 Action。
3. claim 使用条件更新：只有 `ready/retry_wait` 且 `not_before <= now` 的 Action 可进入 `claimed`。
4. lease 过期只意味着 Attempt 可被回收，不意味着外部动作未发生；回收前必须先向 Adapter reconcile Receipt。
5. Provider adapter 必须先查后写，并使用 run/action 标记作为外部幂等键。
6. 所有阶段转换由 Receipt + Closure Policy 推导，UI/Agent 不直接写 Run 终态。
7. Review/Verification gate 通过后先持久化 DeliveryBundle，再执行发布动作；发布 Receipt
   与 Attempt 完成在同一事务内提交，成功后才把 Run 置为 completed。完成页通过持久化
   API 轮询该事实，不在事务提交前广播临时 socket 事件，避免崩溃窗口造成重复通知。
8. repair Action 的 retry 复用同一 repair cycle；只有 Action 成功但失败事实仍存在时才递增
   cycle。Action 自身失败直接升级。

## Multica 对照

Multica 的 `Issue -> Task Queue -> Daemon -> AI Tool` 分层证明了“协作对象”和“一次执行”必须分离；其 queued/dispatched/running/terminal、claim recovery、heartbeat、有限重试、workdir/session 分离恢复将作为 Attempt 层基线。

我们的差异：

- DeliveryRun 跨越多次 Task/Attempt，对最终交付而非单次 Agent 执行负责。
- Squad/Coordinator 只做路由，不拥有终态。
- Review、Web E2E、Provider 和 Delivery 都形成 Receipt。
- 默认由系统自动 repair/retry，只有策略外异常才回到用户。

## 安全

- GoalContract 明确预授权动作；未授权动作不得推断为允许。
- GitHub adapter 使用 argv 调用，不拼接 shell 字符串。
- 仓库、remote、目标分支必须命中 allowlist。
- 自动合并前重新读取 HEAD、CI、Review 和 branch protection 状态。
- 高风险动作保留完整 Proof/Receipt。

## 迁移

1. 先增加 Run/Action/Attempt/Receipt 与纯 reducer，不改变旧路径。
2. 新建项目可选择“自主交付”，由 Supervisor 驱动。
3. 将 autonomy guard 的 stale/closure 规则迁入 reducer。
4. 将直接 UI/daemon 推进改为触发 `advance()`。
5. 完成 E2E 后，默认新建项目使用自主交付；旧会话保持兼容。

## 端到端验证接缝

发布级 E2E 保留整条生产控制链，只在 `HarnessRuntimePort` 替换不可控的外部
LLM/ACP 执行。测试仍真实经过：

```text
Web UI 创建 GoalContract
  → AutonomousDeliverySupervisor
  → RepositoryHarnessPlanner / Context Manager
  → HarnessCoordinator
  → 确定性 Agent Adapter
  → task_update_status / Review Receipt
  → Browser/Playwright Web UI 验收
  → Verification Receipt
  → repair / lease recovery / startup reconcile
  → Closure Invariant / DeliveryBundle / Web UI
```

自主项目在创建 Conversation 和加载 Team Pack 时不得触发 legacy `triggerProposal()`；
`plan_goal` DeliveryAction 是唯一规划入口。普通非自主 Team Pack 项目继续保留原自动 proposal 行为。
前端的 `Conversation.autonomous` 不是新的持久化事实，而是创建时的即时标记，并在服务端水合时
由“该 Conversation 是否存在 DeliveryRun”重新推导；统一 `triggerProposal` 入口必须据此拒绝绕过。

ACP 平台工具授权使用 grant 内的规范名 `mcp.<server>.<tool>`。不同 ACP adapter 可能把同一个工具
报告为 `mcp__<server>__<tool>`；进入权限相关性判断前必须先归一化为规范名，再与当前 grant 的
精确 allowlist 比较。只有当前 session 事件中首次观察到的同一 tool call ID 可以获得一次性放行；未知 server、
未知 tool、普通文件/终端工具以及重放的 call ID 继续 fail closed。相关性不得依赖 adapter 私有
`_meta`：Claude ACP 的 permission request 不携带 Codex ACP 的 MCP approval 标记。

原生工具授权必须由 Harness 将精确 `deliveryRunId` 贯穿到 Invocation。daemon 不得按 Conversation 查找
“最新 Run”替代该绑定，并须在每次 permission request 时重新读取该 Run、校验 Conversation 一致且
Run 仍为非终态；手动调用、缺失/错误绑定和已取消 Run 一律拒绝。运维级
`ACP_PERMISSION_MODE=deny` 是硬拒绝，优先于平台 MCP 的相关性单次批准。

该接缝的边界是“Agent 如何决定并调用工具”，不是“系统是否完成”。测试适配器不得直接更新
DeliveryRun、Action、Attempt、Receipt 或最终 Bundle；这些事实仍由生产 Repository、Task Tool
和 Closure Policy 生成。测试控制端只负责把真实浏览器观察转换为 Agent 本应提交的结构化验证回执。

为验证跨进程恢复，Supervisor 的 attempt lease 支持通过
`AUTONOMOUS_DELIVERY_LEASE_MS` 调整；生产默认仍为 60 秒。测试在验证执行中终止进程，
待 lease 过期后重新启动服务，startup reconcile 必须将原 Attempt 标记为 abandoned，
复用同一 Action 并创建下一次 Attempt。

浏览器黑盒链路覆盖 `repair_verification` 执行中的真实进程终止与恢复；Repository +
Supervisor 的持久化进程边界测试另外按表驱动覆盖 `executing/advance_tasks`、
`verifying/run_verification`、`integrating/integrate_change` 三个阶段，统一验证旧 Attempt
被回收、逻辑 Action 不重复、下一 Attempt 从剩余预算继续。

`repair_cycle` 按失败回执推进，而不是按 reconcile 次数推进。若当前 cycle 对应的
`repair_review` / `repair_verification` Action 仍处于 ready、claimed、running 或 retry_wait，
Policy 必须复用原 idempotency key；只有该 Action 已成功结束且最新事实仍为失败时，
才允许进入下一 cycle。这样周期对账和进程重启不会误耗修复预算。

测试专用适配器与控制端点受双重门禁保护：`NODE_ENV !== production` 且
`AUTONOMOUS_DELIVERY_E2E_DRIVER=1`。生产环境无论变量如何设置都不得启用。

## 业界参考

- Multica: https://multica.ai/docs/how-multica-works
- Multica Tasks: https://multica.ai/docs/tasks
- Multica Squads: https://multica.ai/docs/squads
- OpenAI Symphony: https://openai.com/index/open-source-codex-orchestration-symphony/
- OpenAI Harness Engineering: https://openai.com/index/harness-engineering/
- Anthropic Long-running Harness: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic Harness Design: https://www.anthropic.com/engineering/harness-design-long-running-apps
