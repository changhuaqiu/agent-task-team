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
