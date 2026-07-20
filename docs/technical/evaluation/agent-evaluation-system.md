# Agent 评估系统长期技术设计

> 状态：P1 运行主链与 P2 数据/实验/单操作者提案闭环已实现；真实人工校准与可验证盲审身份仍待完成
> 当前实施契约：[`specs/agent-eval-system/spec.md`](../../../specs/agent-eval-system/spec.md)

## 当前实现（2026-07-19）

- `src/server/evaluation/agent-evaluation.ts` 是外部主接口，负责幂等提交、持久 job、重试租约、报告、重放与状态 proof。
- `snapshot-builder.ts` 按 conversation/root task/optional chain/cutoff 冻结多 trace 证据，排除 thinking 和评估自身 proof，并记录代码、RoleCard、Skill、脱敏模型配置摘要、rubric 与 evaluator revision。
- `deterministic-evaluator.ts` 先计算硬门禁，再计算完成、交付、可靠性和工具执行指标；`deterministic-v2` 把工具执行成功与离线用例定义的工具名称/必需参数匹配拆开，没有工具预期时正确性为 `not_applicable`。
- `judge.ts` 只允许项目显式选择的 OpenAI/Anthropic API Key 账号，无工具权限；没有账号、超预算、Provider 被禁或调用失败时保留确定性结果并转 `partial`。
- migration 26–37 提供数据库级不可变 rubric/snapshot/score/attempt、ApplicationSnapshot、case execution、带 fencing token 的 job、原子预算预留、双 Judge 复核队列、盲测换序、项目域标注、数据集/实验、gap、policy 与 change proposal 表。
- 关闭轮次在 valid exit 后于本地事务内冻结快照并提交 job；后台 worker 只消费冻结快照并执行评估，主 Agent loop 不等待 Judge。
- Pages API 的规范入口为 `/api/eval/*`；`/api/evaluations/*` 保留为当前 UI 的兼容入口。
- 平台项目主内容区提供“协作 / 评估”工作模式；评估不是外部控制台，也不占用项目右侧调试栏。
- P2 支持 dataset revision/split、双人标注加权 kappa、逐例 paired diff、固定种子 95% bootstrap CI、类型/难度/语言/角色拓扑分层、候选盲化与换序复测；实验只接受同 case/manifest 的 completed held-out run，提案审批只接受结论为 `candidate_improves` 的回归实验。
- 主 Judge 的边界标签按需触发第二 Judge；一致才保留，分歧或第二 Judge 缺失进入人工复核，绝不平均成可信分数。
- 离线实验由现有 Harness/Daemon 的评估模式读取 held-out case，分别激活 baseline/candidate ApplicationSnapshot，在指定 commit 的 detached worktree 与独立 session 中执行；完成后自动评估、校验 provenance 并聚合 paired diff。
- 单次 Judge 请求上限 25 秒、job 最多 3 次尝试、线性回退 5/10 秒；包含最终可选第二 Judge 的理论最坏调用路径为 115 秒。运维 P95 从 run `created_at` 计算，包含排队时间，并同时暴露并发饱和度、当日已用/预留/剩余 token。

当前限制：

- 用户已确认平台当前没有权限管理；评估不自建 RBAC，服务端强制 conversation 归属。变更动作使用固定平台操作者审计身份；annotation 的审核者名称仅用于双人校准分组。未来身份能力只能接入平台统一事实源。
- 任务类型、难度和语言默认显式记为 `unknown`，等待确认最小枚举与标注责任人。
- 人工校准当前提供数据与加权 kappa 计算接口，但尚未由两名审核者完成 held-out 实标，不能把默认 rubric 宣布为 calibrated。
- SQLite 备份恢复、工作区 axe 可访问性扫描与 24-run/4-worker 容量演练已有自动化证据；生产环境继续积累真实 Provider 延迟分位数，但请求超时和总路径上界已由代码约束。

## 决策

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

这轮评审确认评估能力与 Agent 平台是同一个产品内的深模块，而不是一套独立系统。项目 `conversationId` 是当前真实的数据隔离边界；平台尚无身份与权限事实源，因此不新增 RBAC。人工标注仍要求填写审核者名称，这是为了双人校准和审计，不表示获得某种权限。

实现采用以下 fail-closed 规则：

- Judge token 在外部调用前通过 `eval_budget_reservation` 原子预留，预留带过期时间；OpenAI/Anthropic 输出均设置上限。
- 全局数据集可以复用 case，但 `eval_annotation.conversation_id` 隔离各项目的标签与 kappa。
- 当前公开 API 的审核者名称不可验证，因此一致性结果明确返回 `identity_unverified`，不能把 rubric 标成 calibrated；这不是临时伪造 RBAC，而是对平台身份能力缺口的诚实呈现。
- pairwise 换序与人工裁决算法保留为内部验证能力，但公开 pairwise API 返回 `pairwise_blind_integrity_unavailable`。可信 case runner 已接通；当前剩余问题是同一平台操作者仍能从 experiment/run 相邻接口反推 A/B，因此统一身份接通前不对外宣称真正盲测。
- pairwise 客户端只拿到 opaque `subjectToken`，不能从响应获得 run id 或 application manifest；换序不一致必须人工裁决并回写权威 winner。
- 在线失败晋升不修改旧数据集，而是复制为新 revision，并把脱敏后的冻结 evidence 一并保存；retention 不删除其来源 run。
- 现有 Harness/Daemon 已接入评估执行模式，能够把 held-out case、ApplicationSnapshot、worktree HEAD、invocation、trace、proof 与 EvalRun 绑定；只有 target/observed manifest 完全相等时才写 `execution_verified=1`。旧的客户端配对实验仍默认 `execution_verified=0`，只作诊断。

这条边界很重要：统计公式、盲测和漂亮的 UI 都不能替代可信的实验执行来源。

## 2026-07-19 Runner 工程契约

`runner` 不是独立服务，而是现有 Harness/Daemon 的评估执行模式。它复用平台已有的账号解析、Agent backend、上下文组装、worktree、invocation、trace 与 proof，只增加不可变快照和校验约束。

- `eval_application_snapshot` 保存 Git commit、TeamPack/RoleCard 快照、显式 Skill revision、engine/runtime/account 引用和规范化 digest；不保存凭据。
- `eval_case_execution` 保存某个 held-out case 在 baseline/candidate 快照上的状态、task、Harness trigger、invocation、trace、EvalRun、target/observed digest 与错误。
- Harness 的普通模式继续解析当前 conversation 配置；评估模式必须从 `ApplicationSnapshot` 构造 runtime profile，并按显式 revision 编译 Skill，禁止回退到 active revision。
- Daemon 为每个执行创建独立 detached worktree 和新 session。执行工作目录的实际 Git HEAD、实际 Skill revision、RoleCard/TeamPack digest、engine/runtime/account 构成 observed manifest。
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
