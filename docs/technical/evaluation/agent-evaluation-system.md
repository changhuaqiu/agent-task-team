# Agent 评估系统长期技术设计

> 状态：P1 运行主链与 P2 数据/实验/单操作者提案闭环已实现；人工校准尚无可信身份与产品入口，当前不开放
> 当前实施契约：[`specs/agent-eval-system/spec.md`](../../../specs/agent-eval-system/spec.md)

## 当前实现（2026-07-19）

- `src/server/evaluation/agent-evaluation.ts` 是外部主接口，负责幂等提交、持久 job、重试租约、报告、重放与状态 proof。
- `snapshot-builder.ts` 按 conversation/root task/optional chain/cutoff 冻结多 trace 证据，排除 thinking 和评估自身 proof，并记录代码、RoleCard、Skill、脱敏模型配置摘要、rubric 与 evaluator revision。
- `deterministic-evaluator.ts` 先计算硬门禁，再计算完成、交付、可靠性和工具执行指标；`deterministic-v4` 在 v3 的根任务级交接、fan-out/join、恢复状态与 Agent 贡献画像上，增加 WorkAuthority 终态路径收敛门和 AgentOutcome 结构化结果接纳率。
- `judge.ts` 只允许项目显式选择的 OpenAI/Anthropic API Key 账号，无工具权限；没有账号、超预算、Provider 被禁或调用失败时保留确定性结果并转 `partial`。
- migration 27–38 提供数据库级不可变 rubric/snapshot/score/attempt、ApplicationSnapshot、case execution、带 fencing token 的 job、原子预算预留、双 Judge 复核队列、盲测换序、数据集/实验、gap、policy 与 change proposal 表；历史 `eval_annotation` 表为旧数据和 retention 兼容保留，但当前没有 writer 或公开 route；migration 41 补齐自主交付 `revision`，migration 42 不信任旧 checkpoint 的版本水位，按实际结构补建自主交付表并把旧 `root_task_id` 外键重建为 `ON DELETE SET NULL`。
- 关闭轮次在 valid exit 后于本地事务内冻结快照并提交 job；后台 worker 只消费冻结快照并执行评估，主 Agent loop 不等待 Judge。
- Pages API 唯一入口为 `/api/eval/*`；UI、测试和服务端实现统一使用该路径。
- 平台项目主内容区提供“协作 / 评估”工作模式；评估不是外部控制台，也不占用项目右侧调试栏。
- P2 支持 dataset revision/split、逐例 paired diff、固定种子 95% bootstrap CI、类型/难度/语言/角色拓扑分层、候选盲化与换序复测；实验只接受同 case/manifest 的 completed held-out run，提案审批只接受结论为 `candidate_improves` 的回归实验。
- 主 Judge 的边界标签按需触发第二 Judge；一致才保留，分歧或第二 Judge 缺失进入人工复核，绝不平均成可信分数。
- 离线实验由现有 Harness/Daemon 的评估模式读取 held-out case，分别激活 baseline/candidate ApplicationSnapshot，在指定 commit 的 detached worktree 与独立 session 中执行；完成后自动评估、校验 provenance 并聚合 paired diff。
- 单次 Judge 请求上限 25 秒、job 最多 3 次尝试、线性回退 5/10 秒；包含最终可选第二 Judge 的理论最坏调用路径为 115 秒。运维 P95 从 run `created_at` 计算，包含排队时间，并同时暴露并发饱和度、当日已用/预留/剩余 token。

当前限制：

- 用户已确认平台当前没有权限管理；评估不自建 RBAC，服务端强制 conversation 归属。变更动作使用固定平台操作者审计身份；人工校准不得用自由文本姓名冒充审核者身份，未来只能接入平台统一事实源。
- 任务类型、难度和语言默认显式记为 `unknown`，等待确认最小枚举与标注责任人。
- 人工校准当前没有公开写入/统计接口或工作区入口；在可验证操作者身份与独立审核流程接通前，不能把默认 rubric 宣布为 calibrated。
- SQLite 备份恢复、工作区 axe 可访问性扫描与 24-run/4-worker 容量演练已有自动化证据；生产环境继续积累真实 Provider 延迟分位数，但请求超时和总路径上界已由代码约束。

## 决策

### 2026-08-30 Agent 完成路径可评测化

“任务已完成”不再由单一 Task 状态代表。评测将结果成功、路径收敛和执行效率分开：Task 必须有当前 Gate/证据，终态 owner/attempt 必须具有终态 Invocation 且 WorkAuthority 已关闭，重试与交接则单独计入效率。`EvalSnapshotBuilder` 冻结 Authority 和 Outcome，cutoff 之后的 Authority 变更视为 late fact，不倒灌历史评测。

- `path_convergence` 是 gate：只要已失败/过期的 Invocation 或终态 Task/A2A pass 仍保留 active Authority，即失败。
- `outcome_acceptance` 是确定性指标：以被 WorkContract 权威边界接纳的 AgentOutcome 占比评估结构化交付质量。
- 没有 Authority/Outcome 执行证据的历史样本保持 `not_applicable`，不把缺失的新事实伪装成通过或失败。
- 本轮只建立组件/路径级可靠性证据；没有固定 TestSuite 与 baseline/candidate ApplicationSnapshot 前，不宣称端到端任务完成率提升。

### 2026-08-21 根任务级可观测证据闭包

在线评测不再接受仅有 `conversationId` 的“项目诊断”。一次评测必须绑定根任务，`EvalSnapshotBuilder` 通过根任务级证据收集模块扩展 Task 后代、WorkContract、A2A pass group/pass、Invocation 与 observation span 的关联闭包。这个模块是评测与执行数据模型之间的唯一关联 seam，调用者不自行拼接表关系。

- `chainId` 是可选收窄条件，不是发现多 Agent 协作的前置条件。
- 未绑定 task/work/A2A 的会话级 Invocation 不进入根任务可靠性指标。
- A2A group 与 pass 是交接、fan-out、join、失败和恢复指标的权威事实；聊天文本中的“已完成”不算回执。
- A2A 历史事件既冻结在快照正文，也进入统一证据引用目录；引用从事件载荷保留 `chainId` / `passId`，使恢复结论可直接下钻到协作链或分支。
- Phoenix 继续承载跨 trace 浏览、会话分析与后续 evaluator 投影；本地冻结 snapshot/score 仍是可复现评测事实源，系统不从 Phoenix 回读业务真相。
- 在线 closure cutoff 来自权威终态事件；手动请求未指定时使用服务端冻结事务的采集时点。cutoff 后更新的 mutable fact 不倒灌旧边界，而是被列为 late fact 并降低 coverage；显式 replay 只能复用已有 snapshot。
- `eval-bundle-v3` 的高频 Task/DeliveryRun/Work/A2A/Invocation/Span/Proof/Event 关联键由 migration v88 建立索引，fresh submit 仍需遵守 500ms 本地提交预算。

平台采用“业务事实源 + 冻结评估快照 + 可版本化评分器”的结构。

- Task Graph、A2A、control proof 和 observation 继续拥有执行事实。
- 一次完整协作以 `rootTaskId + optional chainId + evidenceCutoffAt` 定义，可能跨多个 trace。
- `EvalSubjectSnapshot` 冻结证据引用、应用配置 revision 和内容哈希；历史报告不随迟到事件漂移。
- 评估按关键门、确定性指标、模型裁判、人工校准四层执行。关键门失败或证据不足不能被总分掩盖。
- 在线评估用于真实任务诊断和案例发现；离线版本化数据集用于基线/候选回归比较。
- 模型裁判必须用人类标注校准；模型自报 confidence 不作为可信度门。
- 评估异步、幂等、可重试，主执行链只提交持久 job。
- gap 只能生成受控 change proposal；RoleCard、Skill 和协作策略变更必须审批、回归和可回退。

## 边界

```text
Task/A2A/Proof/Observation facts
  → EvalSnapshotBuilder
  → immutable subject snapshot
  → gates + deterministic evaluators + model judge
  → scores/report/gaps
  → human calibration / offline experiments
  → approved change proposal
```

`ProjectObservationProjection` 面向调试查询，不拥有评估快照的冻结语义。评估实现可复用底层 repositories 和 DTO，但应保持独立模块边界。

## 演进约束

- 已发布 rubric revision、snapshot、score、judge attempt 不原地修改。
- 比较必须固定 dataset、rubric、evaluator 和应用 manifest revision。
- 新增指标要定义适用性、空分母、证据不足和失败语义。
- 任何声称“变好”的结论必须给出逐例差异、分层结果和不确定性。
- 评估输入视为不可信内容；Judge 无工具权限，证据引用必须可验证。
- 实现事实以当前 spec 为准；实现完成后更新本文状态和实际模块/API 路径。

## 参考

- [OpenAI Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [LangSmith Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)
- [MLflow Evaluation datasets](https://mlflow.org/docs/latest/genai/datasets/)

## 2026-07-19 可信性纠偏

这轮评审确认评估能力与 Agent 平台是同一个产品内的深模块，而不是一套独立系统。项目 `conversationId` 是当前真实的数据隔离边界；平台尚无身份与权限事实源，因此不新增 RBAC。旧人工标注接口曾接收自由文本审核者名称，但无法证明独立身份，现已删除；历史表仅为旧数据兼容保留。

实现采用以下 fail-closed 规则：

- Judge token 在外部调用前通过 `eval_budget_reservation` 原子预留，预留带过期时间；OpenAI/Anthropic 输出均设置上限。
- 全局数据集可以复用 case；历史 `eval_annotation.conversation_id` 仍保存旧项目边界，但当前没有 annotation writer 或 kappa API。
- 删除项目会话时，先按聚合依赖顺序清理评估实验、运行、快照和项目数据集，再删除任务与会话；新建数据库同时用外键级联兜底，兼容早期数据库中仍是 `NO ACTION` 的评估外键。
- 人工校准必须等待可验证平台身份、独立审核流程与真实 UI；不再用 `identity_unverified` 响应包装一条没有可信消费者的假公开能力。
- pairwise 换序与人工裁决算法保留为内部验证能力，但当前不注册公开 pairwise route。可信 case runner 已接通；当前剩余问题是同一平台操作者仍能从 experiment/run 相邻接口反推 A/B，因此统一身份接通前不对外宣称真正盲测。
- 内部 pairwise 结果使用 opaque `subjectToken`，不携带 run id 或 application manifest；未来开放 route 时沿用该最小披露契约，换序不一致必须人工裁决并回写权威 winner。
- 在线失败晋升不修改旧数据集，而是复制为新 revision，并把脱敏后的冻结 evidence 一并保存；retention 不删除其来源 run。
- 现有 Harness/Daemon 已接入评估执行模式，能够把 held-out case、ApplicationSnapshot、worktree HEAD、invocation、trace、proof 与 EvalRun 绑定；只有 target/observed manifest 完全相等时才写 `execution_verified=1`。旧的客户端配对实验仍默认 `execution_verified=0`，只作诊断。

这条边界很重要：统计公式、盲测和漂亮的 UI 都不能替代可信的实验执行来源。

## 2026-07-19 Runner 工程契约

`runner` 不是独立服务，而是现有 Harness/Daemon 的评估执行模式。它复用平台已有的账号解析、Agent backend、上下文组装、worktree、invocation、trace 与 proof，只增加不可变快照和校验约束。

- `eval_application_snapshot` 保存 Git commit、TeamPack/RoleCard 快照、显式 Skill revision、engine/runtime/account 引用和规范化 digest；不保存凭据。
- `eval_case_execution` 保存某个 held-out case 在 baseline/candidate 快照上的状态、task、Harness trigger、invocation、trace、EvalRun、target/observed digest 与错误。
- Harness 的普通模式继续解析当前 conversation 配置；评估模式必须从 `ApplicationSnapshot` 构造 runtime profile，并按显式 revision 编译 Skill，禁止回退到 active revision。
- Daemon 为每个执行创建独立 detached worktree 和新 session。评估 worktree 只投影当前 case task，不启动生产 Task watcher、不写入团队日志、不加载当前项目本地 Skill，也不授予共享项目目录访问权。
- 执行工作目录的实际 Git HEAD、实际 Skill revision、RoleCard/TeamPack digest、engine/runtime/account 构成 observed manifest；离线 `EvalSubjectSnapshot.appManifest` 只从冻结 `ApplicationSnapshot` 与已验证的 target/observed digest 构造，不重新读取当前项目 HEAD、TeamPack、RoleCard 或 active Skill。离线请求的 case、root task、Harness trigger、invocation 与 trace 必须和同一条运行中/评估中的 case execution 完整绑定；缺少有效快照、绑定或 observed digest 时必须 fail-closed，不能回退到当前配置，也不能复用旧的无 provenance 快照。
- 评估输出只进入 invocation/observation/evaluation 证据，不写入生产 `chat_message`，也不触发 TeamLog 物化、消费游标、`@mention` 扫描或 A2A chain 推进；因此 held-out case 不会反向污染后续生产 Agent 上下文和协作状态。
- 只有 observed digest 与 target digest 一致，且 invocation、trace、任务证据和 EvalRun 均已绑定时，执行才可标记 verified；否则实验仅供诊断。

这保持了系统边界：评估与平台在一起，执行能力只实现一次；可信性由“冻结输入 + 隔离执行 + 实际来源校验”提供。

## 2026-07-19 真实 Web UI 端到端校验

在生产构建的 `http://localhost:3000/` 上，以真实项目“PR评审”完成了结果、数据集、对比实验和在线评估链路校验。页面展示 12 条 active 校准案例；不完整的对比实验被客户端校验阻止；通过“立即评估”产生了新的持久化评估记录，且浏览器控制台无 error/warn。

端到端校验同时发现：评估证据按钮虽然派发了 `observability:open`，但详情抽屉原先挂载在协作聊天子树中，评估模式下监听器已卸载。正确的平台集成契约是：

- 评估证据下钻复用平台现有 `AgentObservabilityDrawer`，不新建第二套详情页。
- 抽屉挂载在 `ProjectWorkspace` 公共层，因而在“协作 / 评估”两种模式下都保持监听。
- 点击 task/span/trace/chain/pass 证据后必须留在当前评估上下文并打开可关闭的详情抽屉；无可定位事实的 proof/invocation 保持禁用。
## 2026-07-19 单操作者提案治理

平台当前没有权限管理，产品确认本阶段由一个平台操作者即可完成 change proposal 的批准和应用确认。该规则只放宽身份门，不放宽质量门：

- `approve` 与 `apply` API 必须收到 `operatorConfirmed=true`，否则拒绝。
- 审计身份固定记录为 `platform-operator`，明确表示平台操作来源，不伪装为已验证个人身份或 RBAC 角色。
- 批准前仍必须选择 completed、`candidate_improves` 的 held-out 回归实验；全部 case 必须执行来源已验证，且盲测结论 consistent 或 human-resolved。
- 应用必须复用批准时锁定的回归实验；应用和回退继续记录 evidence。
- 平台工作区通过独立确认框表达操作者意图，不能只凭一次普通按钮点击越过门禁。
