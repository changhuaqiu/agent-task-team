# Autonomous Delivery Loop

**状态**：active
**日期**：2026-07-19
**目标**：用户提交一次交付目标后，系统在已授权范围内自主完成规划、执行、评审、测试、修复、集成和交付；用户默认只接收最终结果或真正需要其决策的异常。

## 1. 问题

当前系统已经具备 Task Graph、A2A possession、Harness、Agent Session、Worktree、Review/QA 角色和 Proof Log，但自主性仍由消息、定时扫描和 Agent 提示词拼接出来：

- `TaskWakeup` 只表示“某个 Agent 现在可能该运行”，不是持久化调度事实。
- `HarnessCoordinator` 的 `inFlight` 和去重状态只在内存中，进程重启后无法恢复。
- Task 完成、Agent 调用成功、代码已提交、PR 已创建、CI 已通过和最终交付完成是不同事实，目前没有统一收口。
- Coordinator Agent 可以规划和路由，但不能成为唯一完成裁判；提示词服从不能替代系统不变量。
- 外部 Provider 动作尚无统一幂等入口和 Receipt，无法安全重试创建 PR、请求评审、合并等操作。
- 正常路径仍可能要求用户手动 `@Agent`、重试、确认中间步骤或搬运结果。

## 2. 产品承诺

用户提交的是 `GoalContract`，不是一条聊天消息。系统承诺：

1. 接受目标后立即创建一个持久化 `DeliveryRun`。
2. 系统持续推进，直到进入 `completed` 或 `escalated`。
3. 正常路径不要求用户发送第二条消息。
4. 只有超出授权、缺少不可推断信息、安全风险或有限恢复耗尽时才升级给用户。
5. `completed` 必须由证据和 Receipt 推导，不能由任一 Agent 自报。

## 2.1 核心系统定位：Team Harness Environment

本规格不是要实现一个替团队思考的 Boss Agent，而是要把现有运行环境提升为可支撑团队自身 Loop 的 Team Harness：

- **环境可感知**：Agent 能按需获得项目知识、团队角色、任务图、协作历史、工作目录和外部运行事实。
- **环境可行动**：Agent 的执行、验证、交接和 Provider 动作都通过显式 Port 完成。
- **环境可反馈**：每次执行都有 Envelope、Receipt、Gate Decision 和可重新读取的结果。
- **环境可恢复**：进程、runtime 或 session 丢失后，团队从持久化事实和原工作目录继续。
- **环境有边界**：授权、租约、幂等和 Closure Invariant 由确定性内核负责，不依赖提示词服从。

Agent 团队负责开放式的语义决策；Team Harness 负责让这些决策发生在一个信息充分、能力受控、反馈真实、可以持续循环的环境中。

## 3. 核心对象

### 3.1 GoalContract

```ts
interface GoalContract {
  goal: string;
  acceptanceCriteria: string[];
  scope: {
    conversationId: string;
    projectPath?: string;
    repository?: string;
  };
  authorization: {
    allowCodeChanges: boolean;
    allowPush: boolean;
    allowPullRequest: boolean;
    allowAutoMerge: boolean;
    allowedBranches?: string[];
  };
  recoveryPolicy: {
    maxAttemptsPerAction: number;
    maxRepairCycles: number;
    stallTimeoutMs: number;
  };
  deliveryPolicy: {
    requireReview: boolean;
    requireWebE2E: boolean;
    requireMerge: boolean;
  };
}
```

UI 使用“交付目标、验收标准、允许自动创建 PR、允许自动合并”等用户语言，不暴露 runtime、receipt、envelope 等内部概念。
启用自主交付时必须选择 `projectPath`；`requireWebE2E=true` 且缺少项目目录的 GoalContract
在创建阶段直接拒绝，不能运行到验证阶段才失败。

### 3.2 DeliveryRun

`DeliveryRun` 是顶层交付实例，与 Conversation 一对多。Conversation 是协作空间，Run 是一次有起点、有终点、可恢复的交付承诺。

状态：

```text
submitted
  -> planning
  -> executing
  -> reviewing
  -> verifying
  -> integrating
  -> delivering
  -> completed

任意非终态 -> recovering -> 原阶段
任意非终态 -> escalated
用户取消   -> cancelled
```

Run 保存单调递增的 `revision`。所有由旧快照推导的状态写回都必须以 `revision` 做 CAS，
且终态不接受 Supervisor 的非终态写回；因此并发 reconcile、人工升级和慢速 facts
观察不能把 `completed/escalated/cancelled` 回退后继续创建或执行 Action。

数据库升级不能仅以 `_schema_version` 的最大值证明 Run 表结构有效。兼容未发布 checkpoint 时，
迁移必须覆盖“水位已到 v42、但 `revision` 缺失或 `root_task_id` 并非 `ON DELETE SET NULL`”
的状态；修复须保留 Run/Action 数据并通过 `foreign_key_check`，否则 Supervisor 不得开始 reconcile。

### 3.3 DeliveryAction / DeliveryAttempt

- `DeliveryAction`：Supervisor 推导出的逻辑动作，例如 `plan_goal`、`dispatch_task`、`request_review`、`run_web_e2e`、`create_pr`、`merge_pr`、`publish_delivery`。
- `DeliveryAttempt`：某个动作的一次实际执行。一次 Action 可有多次 Attempt。
- Action 以 `idempotency_key` 唯一；Attempt 记录 claim、lease、started、heartbeat、terminal 和 failure taxonomy。
- Supervisor 在副作用执行期间按 lease 的固定分数周期续租；Attempt 终态写入必须同时校验
  `attempt_no == Action.attempt_count`。过期 Attempt 的迟到结果不得改变当前 Action，也不得写入 Receipt。
- `attempt_count` 只用于 Attempt 编号和 fencing；恢复预算由独立的 `failure_count / max_attempts` 约束。Harness 返回
  `deferred / agent_busy` 表示正常背压：本次已 claim 的 Attempt 必须被释放并保留审计记录，但不得增加
  `failure_count`、不得触发 `recovering/escalated`。Supervisor 使用有界退避等待同一 Agent 空闲后继续；只有真实执行、
  协议、权限或配置失败才消耗失败预算。
- 与 DeliveryRun 精确绑定的 wakeup 一旦得到 `deferred / agent_busy`，仍由 Supervisor 持有重试责任；对浏览器发出的
  可见 wakeup 必须标记为 server-owned，禁止启动兼容派发。一个 Task 的同一 wakeup 不得同时进入 Delivery Action
  重试队列与浏览器 pending queue。

### 3.4 Receipt

Receipt 是外部或执行面动作已经发生的权威回执：

- Harness Receipt：Agent 调用、session generation、execution envelope。
- Task Receipt：任务状态、artifact、review/QA decision。
- Verification Receipt：命令、退出码、报告路径、Web UI E2E 结果。
- Provider Receipt：commit、push、PR、review、CI、merge 的外部 ID 与状态。
- Delivery Receipt：最终 `DeliveryBundle` 已提交到持久化 API/UI 投影。

Receipt 必须可重复读取，写入必须幂等。

### 3.5 Acceptance Verification Receipt

任务被标记为 `done` 只证明 Task Gate 接受了该次状态变更，不能直接证明自主交付的验收标准成立。自主交付只接受与当前 Run 绑定的结构化验证回执：

```ts
interface AcceptanceVerificationReceipt {
  schemaVersion: 1;
  deliveryRunId: string;
  status: 'passed' | 'failed';
  method: 'web_ui_e2e' | 'automated_test' | 'manual_review';
  verifierAgentId: string;
  tool: string;
  reportRef: string;
  specRefs: string[];
  codeRevision?: string;
  acceptanceResults: Array<{
    criterion: string;
    status: 'passed' | 'failed';
    evidenceRefs: string[];
  }>;
}
```

机械门禁：

- `deliveryRunId` 必须等于当前 Run，且来源 Proof 不早于 Run 创建时间；
- Proof actor 必须等于 `verifierAgentId`，并属于当前 TeamPack 的 QA/质量门负责人；
- `acceptanceResults` 必须与 GoalContract 的验收标准一一对应，不允许缺失、重复或额外标准；
- PASS 的每条标准必须至少有一个 evidence ref；
- `requireWebE2E=true` 时，`method` 必须是 `web_ui_e2e`，工具必须来自 Browser/Playwright 能力；
- 本地报告与测试用例引用必须位于授权 projectPath 内且真实存在；
- 无结构化回执、旧 Run 回执、只有“测试通过”文本或任意 delivery evidence 均不能让 Verification 通过；
- 失败或格式错误的回执形成失败 Receipt，触发有界 `repair_verification`，而不是永久等待。

### 3.6 Acceptance Review Receipt

任务 `done` 不能同时充当独立评审结果。要求 Review 的 Run 必须收到质量门负责人提交的结构化回执：

```ts
interface AcceptanceReviewReceipt {
  schemaVersion: 1;
  deliveryRunId: string;
  status: 'passed' | 'failed';
  reviewerAgentId: string;
  summary: string;
  evidenceRefs: string[];
  codeRevision?: string;
  findings: Array<{
    severity: 'blocking' | 'important' | 'advisory';
    status: 'open' | 'resolved';
    description: string;
    evidenceRefs: string[];
  }>;
}
```

机械门禁：

- `deliveryRunId` 必须精确匹配当前 Run，来源 Proof 不早于 Run；
- Proof 的 actor 必须等于 `reviewerAgentId`，且属于当前 TeamPack 的质量门负责人；
- PASS 必须包含评审摘要和证据，且不能存在未解决的 blocking/important finding；
- “任务已 done”、实现者自评或只有 `mainImpactReviewResult` 文本均不能让 Review 通过；
- 无回执时创建独立 `request_review`，失败回执触发有界 `repair_review`。
- Task Graph 的普通 quality-gate 评审同样必须通过结构化任务工具提交裁决。`.ath/TASKS.md` 只是只读兼容投影，不是 Agent 的写入入口；评审者不得通过原生文件编辑伪造状态变化。
- 平台任务工具是 Task Graph 控制面的基础能力，不以 Agent 是否手工绑定 `task-management` Skill 为前提。任何绑定到精确 Task 的实现、评审或验证 invocation 至少必须获得 `task_list` 与 `task_update_status`；planner 角色可以获得创建与分派工具。授权清单必须按本次 invocation 的 Task/角色收窄，并继续经过 runtime 注册名校验。
- 所有上下文层必须一致声明 `TASKS.md` 为只读投影；缺少精确平台任务工具时，Agent 必须提交结构化 blocker，不能回退到文件编辑。
- `TASKS.md` watcher 只能执行 Task Graph → 文件的投影校正。对于数据库中已经存在的 Task，文件中的状态、负责人、
  标题、依赖或产出描述均不得回写 Task Graph；发现漂移时记录 proof、恢复权威投影。Agent、旧 session 或迟到 I/O
  写入的 `doing/review/done/blocked` 都不能回滚或越过结构化任务工具已确认的状态。
- 只要 Conversation 绑定过 DeliveryRun，该 Conversation 的全部 Task（包含尚未写入 `subtask_of` 边的新建 Task）都由
  Supervisor 独占调度；daemon 的通用 Autonomy Guard 不得派发其中任何 Task。Run 进入
  `escalated/cancelled/completed` 后该隔离仍保持，尤其不能在动态工具授权已撤销后启动后代 Task。Supervisor 的内部
  facts adapter 可以在隔离边界内复用 wakeup 解析器计算 runnable Task，但只有 Supervisor 可以把结果持久化为 Delivery Action。
- 平台 `task_create` 是 Task Graph 的权威 mutation：创建 Task 时必须在同一数据库事务中追加 `task.created` Action；
  Delivery-bound 创建还必须写入新 Task → Delivery 根 Task 的 `subtask_of` 边，并把每个声明依赖写成
  依赖 Task → 新 Task 的 `depends_on` 边。`.ath/TASKS.md` 只能在事务提交后作为兼容投影更新，不能先于或代替图谱事实。
- Agent 的账号绑定必须由服务端持久化并成为客户端与 Harness 的共同事实。Team Pack role 未配置非空
  `accountIds` 时，按稳定 role ID 继承对应全局 Agent 的账号；Team Pack 显式绑定优先。自主创建入口在提交
  Conversation/DeliveryRun 前验证全部 required role 均能解析可用账号；验证失败不得留下 Conversation、根 Task、
  DeliveryRun 或项目上下文，只返回面向用户的缺失成员列表和配置入口。
- 实现、评审与验证上下文必须明确区分“清单中存在的测试脚本”和“可形成门禁证据的一次性执行”。进入 watch、超时、被终止或非零退出的命令都不是成功证据；若项目 `test` script 默认进入 watch，必须改用对应 runner 的 one-shot 形式（例如 `npx vitest run`）并等待正常退出。
- 自主 Invocation 通过平台任务工具提交状态后，由任务通知链路立即产生的 review/test wakeup 必须沿可信调用栈携带该 Invocation 绑定的精确 `deliveryRunId`。不得通过 Conversation 的“最新 Run”推断；文件 watcher、手动任务变更或其他无绑定来源继续保持无授权、fail-closed。这样通知抢先于 Supervisor reconciliation 派发时，Reviewer/QA 仍能在同一活跃 Run 的动态授权边界内使用 Terminal、Browser 等原生工具。
- ReviewReceipt 的状态枚举是协议字段而不是自然语言结论：PASS 必须使用任务 `status=done` 且 `reviewReceipt.status="passed"`；REJECT 必须使用任务 `status=rejected|blocked` 且 `reviewReceipt.status="failed"`。该精确枚举与 findings 字段结构必须同时出现在基础协议、wakeup contract 和工具描述中；校验失败须返回期望值，不能只返回模糊字段名导致 Agent 在 `pass/approved/done` 间猜测重试。
- 实现门禁选择 install/build/test 运行证据时，只能解析真实 Shell 工具调用输入的顶层 `command`/`cmd` 字段，并按同类命令的最新一次真实执行终态裁决。不得全文搜索任意工具输入，也不得让 `task_update_status` evidence 内嵌的命令描述反向遮蔽已经正常退出的 Shell span。
- 非 Git 实现任务进入 `in_review` 时，`task_update_status.evidence` 的 `installResult`、`buildResult`、`testResult`、`impactEvidence` 必须是非空摘要字符串；命令是否真实成功仍由上述 Shell span 独立校验，Agent 自报的对象或退出码不能替代运行事实。
- 被明确唤醒的 gate owner 对目标 `in_review` Task 提交 PASS/REJECT 后，平台必须在同一权威 mutation 中持久化 review note/evidence、发布任务变化并派发下一合法负责人。REJECT 必须离开 `in_review` 进入 `rejected|blocked`，并唤醒原实现者；不得因评审 Invocation 正常结束但状态未写回而用 `execution` 场景重复派发同一评审者。
- `advance_tasks` 的运行场景由实际 wakeup 语义决定：`review_requested` 必须使用 `code_review`，`test_requested` 必须使用 `verification`，不能仅按外层 Action kind 统一降级为 `execution`。

## 4. 模块设计

对外的产品能力是 Team Harness Environment；`AutonomousDeliverySupervisor` 是其内部控制内核，不是团队大脑。

对外只提供一个深模块：

```ts
interface AutonomousDeliverySupervisor {
  start(contract: GoalContract): DeliveryRunSnapshot;
  advance(runId: string, cause?: AdvancementCause): Promise<AdvanceResult>;
  get(runId: string): DeliveryRunSnapshot | undefined;
}
```

`advance()` 内部隐藏状态推导、claim、lease、重试、恢复、并发控制和收口规则。调用方只表达“事实可能变化，请重新对账”。

内部 Port：

- `TaskAuthorityPort`：读取/变更 Task Graph 的唯一适配器。
- `ExecutionPort`：适配现有 Harness。
- `VerificationPort`：执行构建、测试与 Web UI E2E。
- `ProviderActionPort`：适配 Git/GitHub 等外部动作。
- `Clock`：确定性时间与测试。

每个外部依赖提供 production adapter 和 in-memory test adapter。

## 5. 推进算法

每次 `advance()` 必须按固定顺序：

1. **Reconcile**：先读取所有运行中 Attempt、Harness envelope、Task、验证和 Provider Receipt。
2. **Recover**：回收 lease 过期或 runtime 丢失的 Attempt；按 failure taxonomy 决定复用 workdir、复用 session 或开启新 generation。
3. **Derive**：从 GoalContract + 持久化事实推导下一组合法 Action。
4. **Claim**：事务内按 idempotency key 创建或 claim Action/Attempt。
5. **Execute**：通过 Port 执行副作用，并在长任务期间持续 heartbeat 续租。
6. **Receipt**：在 fencing 校验通过后持久化结果，再触发下一次 `advance()`。
7. **Bundle**：Review、Verification、Provider gate 已通过后，先生成并持久化 DeliveryBundle。
8. **Publish**：把已经持久化的 DeliveryBundle 提交到可查询 UI 投影，并在 Attempt
   完成事务内记录幂等 Delivery Receipt；不得在事务提交前广播临时事件。
9. **Close**：Delivery Receipt 可见后才进入 `completed`。

系统采用“事件驱动 + 周期对账”：

- Task/Envelope/Provider/Verification 状态变化时立即触发 `advance()`。
- 服务启动时立即扫描所有非终态 Run 并触发一次 reconcile，不等待首个定时周期。
- 周期 reconcile 只作为丢事件、重启和网络分区的安全网。

## 6. Closure Invariant

`DeliveryRun.completed` 当且仅当：

1. GoalContract 的每条 acceptance criterion 都有验证证据。
2. 根 Task 子图没有非终态任务，没有未处理 blocker。
3. 所有要求的 Review/QA gate 都有来自合法 gate owner 的结构化 PASS。
4. 所有交付必须项都有成功 Receipt。
5. 若 `requireMerge=true`，目标 commit 已合入目标分支且远端可查询。
6. 已生成并持久化 `DeliveryBundle`。
7. `DeliveryBundle` 已通过持久化 API/UI 投影发布，且幂等 Delivery Receipt 只有一条。

Agent 文本中的“完成了”不参与该判断。

`DeliveryBundle.acceptanceResults` 必须逐项复制最终有效的 Acceptance Verification Receipt，不得把同一份笼统证据批量标记给所有验收标准。

`DeliveryBundle` 同时保留面向用户的验证摘要（验证方式、工具、报告、用例和代码版本）。
完成页逐项展示验收证据，并展示 Web UI E2E 报告；内部 proof/receipt 标识不得进入主界面。

## 7. 恢复与升级

失败分类：

- `transient_runtime`：runtime offline、lost response、timeout；自动重试，可复用 workdir。
- `transient_provider`：网络、5xx、rate limit；退避重试。
- `poisoned_session`：上下文溢出、无效 session；保留 workdir，开启新 session generation。
- `verification_failed`：进入 bounded repair cycle。
- `policy_denied`：不重试，升级。
- `missing_authorization`：不执行外部动作，升级。
- `permanent_configuration`：缺少账号、凭证或工具；升级。
- `unknown`：有限重试后升级。

根 Task 是交付编排承诺，不是每个子任务执行期间都必须持续产生状态变化的普通工作项。只要存在任一非终态的非根 Task，Supervisor 不得把根 Task 的 completed/failed/expired Envelope 计入 no-progress 恢复耗尽，也不得从 autonomy-guard 或 action 执行旁路重新派发根 Task；执行恢复必须由实际负责推进的子 Task 承担。该约束必须覆盖 daemon 全局 autonomy-guard 定时扫描：扫描必须从持久化的、尚未 `completed|cancelled` 的 DeliveryRun 得到根 Task 抑制集合，`escalated` Run 仍由 Delivery 控制，任意状态、任意子任务数量下都不能退回普通 Task 的 `owner_ready|runnable_owned_idle|chain_ready_for_closure`；不能只依赖可选的 `subtask_of` 边，因为自主交付任务可能尚未写入这些边。若数据库中已经存在一个待执行的旧 root `advance_tasks` Action，Action adapter 必须将它以带 skipped/superseded Receipt 的成功 no-op 收口，不能返回可重试失败并把整个 Run 升级。全部子 Task 首次进入终态时，Repository 为当前稳定子任务集合写入不可变、幂等的收敛 Receipt，并以其 `observed_at` 作为新的根恢复 epoch；`done → done`、补 artifacts/evidence 等后续可变更新时间不得刷新 epoch。epoch 之前的历史 Envelope 不消耗收口预算；根 Task随后由 chain-closure 或 epoch 后的新根恢复推进。根 Task 尚未拆出子 Task时，只有 active Run 仍走普通恢复；escalated Run 始终停留在显式升级边界。

同一 repair cycle 的 Action 处于 `ready/claimed/running/retry_wait` 时必须复用原 cycle；
只有该 Action `succeeded` 但外部失败事实仍存在时才进入下一 cycle。repair Action 自身
`failed/cancelled` 时直接升级，不能用新 cycle 掩盖执行失败。

升级消息必须只包含：

- 无法继续的具体事实；
- 已经自动尝试过什么；
- 用户需要做的最小决策；
- 做出选择后系统将从哪个 Action 继续。

## 8. 与现有模块的关系

- Task Graph 继续拥有业务任务真相。
- A2A possession 继续拥有 Agent 间责任转移语义。
- Harness 继续拥有一次 Agent 执行。
- Dispatch Gateway 继续拥有运行时投递事实。
- Team Harness 新增“跨多次执行直至最终交付”的环境能力。
- Autonomous Delivery Supervisor 只拥有确定性状态推进和完成判定权，不拥有开放式方案决策权。
- Daemon/UI 只能触发 `advance()` 和展示 Snapshot，不再自行判断下一步。

## 9. 业界实现取舍

### Multica

吸收：

- Issue 与 execution task 分离；
- queued/dispatched/running/terminal 状态；
- 原子 claim、heartbeat、stale dispatch reclaim；
- 按原因分类的有限自动重试；
- workdir 与 session 分别恢复；
- Agent 作为一等协作者，Squad 作为稳定路由入口。

不照搬：

- Squad Leader 的提示词路由不能成为交付状态机；
- “Agent task completed” 不能等同“目标已交付”；
- 中间失败不默认回退给用户手动 rerun，而由 Run 级 Recovery Policy 处理。

### OpenAI Symphony / Harness Engineering

吸收：

- 任务系统作为控制面；
- 每次 dispatch 前先 reconcile；
- 单一 mutation authority；
- workspace 隔离、机械约束、可观察性和重启恢复。

### Anthropic Long-running Harness

吸收：

- Generator 与 Evaluator 分离；
- 小步迭代和结构化交接；
- 独立 Playwright Web UI E2E；
- 失败后从持久化 artifact 继续，而不是依赖长会话记忆。

## 10. 非目标

- P0 不实现可视化 Workflow DSL。
- P0 不让 LLM 自由决定安全策略。
- P0 不支持任意 Provider；先定义 Port 和 GitHub production adapter。
- P0 不把所有旧聊天直接迁移为自动交付 Run。

## 10.1 能力复用原则

Team Harness 不重复实现模型、Skill、工具协议、浏览器驱动或 Provider SDK。平台只建设稳定 seam、环境事实和机械控制：

| 能力 | 复用事实源 | Team Harness 增加的责任 |
|---|---|---|
| 专业工作流与知识 | 现有 `SkillRuntime` 和标准 `SKILL.md` 包 | 固定 revision/hash、按场景激活、记录加载证据 |
| Agent 执行 | Codex / Claude / OpenCode 等 ACP adapter | 统一 ContextSnapshot、workdir、session generation 与 Receipt |
| 工具发现与调用 | Runtime 注册工具、MCP tool catalog | Capability Snapshot、scope/policy 门禁和机器可读 Outcome |
| Web UI 验证 | Browser/Playwright 能力 | criterion-specific E2E plan、浏览器级 Receipt 与有限修复循环 |
| Git/PR/CI | Git 与 Provider 官方 CLI/SDK | allowlist、精确 head、幂等动作和终态 reconcile |
| 架构/评审方法 | 可版本化 Skill | 通过 Contributor 注入项目约束和证据，不把方法硬编码进 Supervisor |

新增平台能力前必须先确认：

1. 现有 Skill、MCP、runtime 或官方工具是否已经提供该能力；
2. 若已存在，只实现 adapter 和证据契约；
3. 只有缺少跨工具一致性、权限、恢复或完成不变量时，才由平台补齐；
4. Supervisor 不复制 Skill 中的开放式工作流程。

## 11. 验收场景

### 正常路径

用户在 Web UI 创建交付目标并发送一次。此后不再发送消息。系统完成任务拆解、开发、Review、Web UI E2E、修复、PR/合并（若授权），最后 UI 展示 DeliveryBundle。
创建时可以异步加载 Team Pack，但 `autonomous=true` 时不得再触发普通 Conversation 的初始 proposal；
首个规划调用必须来自持久化的 `plan_goal` Action/Attempt。非自主项目的既有 proposal 行为保持不变。
页面刷新后，自主标记必须由持久化 DeliveryRun 重新水合；创建定时器、聊天自动提案和
`triggerProposal` 统一入口都必须拒绝为该 Conversation 派发 legacy proposal。
平台 MCP 工具授权必须兼容 adapter 对同一工具的点号名与双下划线名，但归一化后仍只允许
当前 grant 明确列出的 server/tool，并只对当前 session 首次出现的相关 tool call ID 单次生效；
重复、冲突或跨 session 的 call ID 必须拒绝，不得因此扩大普通工具权限。

### 重启恢复

在 executing、verifying、integrating 各阶段重启进程。重启后启动 reconcile 能立即从数据库、
worktree 和 Provider Receipt 恢复；过期 Attempt 被标记为 abandoned，同一个幂等 Action
创建下一次 Attempt，既不丢任务也不重复逻辑动作或外部副作用。
startup reconcile 必须在观察事实前把前一本地 daemon 进程遗留（含本地代理 bridge）的 started ExecutionEnvelope 持久化为
`expired`，使中断任务能够产生受恢复预算约束的重新派发，而不是永久停在 running。periodic
reconcile 只能按 TTL 回收 pre-start 状态，不得把当前进程内的正常长任务误判为中断并重复派发。
`routed -> sent` 与 `sent -> started` 必须要求前置状态与 TTL 同时满足原子 CAS；CAS 失败的旧 handler 必须中止。
完成与失败也必须使用终态保护 CAS，迟到回调不得覆盖 `expired`/`completed`/`failed` 等既有终态。
Envelope 必须区分 `daemon_process`、`bridge_proxy` 与 `tmux_pane` 执行所有权，记录执行所有者节点、
Invocation 引用，并在 tmux 启动前持久化 pane 引用。重启只能处理启动瞬间捕获的旧 pane；tmux
只有在严格终止并经独立查询确认 pane 不存在后才可进入失败恢复，查询不确定时必须 fail closed 并周期重试，
不得把重启后新建的 pane 纳入旧执行清理。回收同时终结 Invocation 并释放 AgentBinding。
daemon/bridge 的三类状态收口必须位于同一事务，且 Binding 只在仍指向旧 Envelope 时释放；事务或 tmux
枚举/确认失败时保留恢复责任并由 periodic 重试。旧 tmux 集合清零及持久化回收完成前，daemon 不得接受
新 dispatch，以阻断 pane ID 复用竞态；就绪屏障必须在事实观察和恢复派发之前解除。
任一 pre-reconcile ownership hook 失败必须立即中止当前 cycle，且不得过期 Envelope、移除 restart node 或开放 readiness。
tmux 在创建 pane 前必须持久化每个 Envelope 独占的 server 引用；pane 创建命令原子返回 pane ID，
后置设置失败由 gateway 严格清理或把引用交还 daemon。sent/started 及因 TTL/dispatch 过期但仍带 cleanup
record 的 Envelope 都参与启动清理，确保后续 bind 持续失败和 daemon 再次崩溃时仍可按专属 server 回收。
reconcile cycle 必须串行，恢复责任在开放 readiness 前删除。失败 CAS 的胜者在同一事务中收口 Envelope、
旧 Binding 与 Invocation，迟到的 kill/timeout/shutdown 不得覆盖 Invocation 原因。
无法识别执行器类型的 legacy `started` 必须不依赖当前 tmux flag 一律 fail closed；运行中的进程句柄和
响应缓存按 Invocation 隔离，异步超时、终止、完成及 shutdown 只能清理仍由自身持有的 key。

### 失败修复

Web UI E2E 第一次失败，系统自动创建 repair action；修复后重新验证并完成，且 repair cycle 不超过 GoalContract 上限。

### 全链路浏览器验收基线

自主交付的发布门禁必须包含一条不直接写入 Run、Task、Proof 或 Receipt 的黑盒链路：

1. 用户只能通过 Web UI 新建项目、填写目标与验收标准并启动自主交付；
2. `RepositoryHarnessPlanner` 必须真实执行，Context Manager 至少生成 execution、code_review、verification/recovery 场景的上下文快照；
3. 测试可以在 `HarnessRuntimePort` 接缝替换外部 LLM/ACP，但不得替换 Supervisor、Harness Coordinator、Task Tool、Review/Verification Receipt、Closure Policy 或 UI 投影；
4. Web UI 验收必须由真实 Browser/Playwright 页面操作产生结果，再由测试专用 Agent Adapter 按生产 `task_update_status` 契约提交结构化回执；
5. 首次验证失败后必须推导 `repair_verification`，不得由测试直接修改 `repair_cycle`；
6. 在 repair verification 执行中终止服务，重启后必须依靠持久化 Action/Attempt、lease 回收和 startup reconcile 恢复，同一逻辑 Action 不得重复创建；
7. 最终 `DeliveryBundle` 只能由生产 Closure Invariant 推导，并在 Web UI 展示逐项验收、独立评审和 Web UI E2E 证据。

测试专用 Agent Adapter 仅在非生产环境且显式设置
`AUTONOMOUS_DELIVERY_E2E_DRIVER=1` 时可用。该适配器用于消除外部模型和账号网络波动，
不是业务完成态的快捷写入接口。

### 异常升级

需要合并但 GoalContract 未授权或 Provider 凭证缺失。系统不尝试危险动作，只向用户提出一个最小决策，并在授权后从原 action 继续。
