# Agent 评估系统（Agent Evaluation System）

> 状态：draft（完成方案审计，待产品与技术评审后转 active）
> 初始日期：2026-07-18
> 最近修订：2026-07-18
> 规格事实源：本文件；实施任务见 [`tasks.md`](./tasks.md)，验收门见 [`checklist.md`](./checklist.md)
> 架构图：[`architecture.html`](./architecture.html)（自包含 HTML，可导出 PNG/PDF）
> 依赖：[`agent-observability`](../agent-observability/)、[`observability-drilldown`](../observability-drilldown/)、[`system-control-plane`](../system-control-plane/)、[`a2a-possession-contract`](../a2a-possession-contract/)
> 产品对象模型提案：[`docs/product/business/2026-07-19-evaluation-object-model.md`](../../docs/product/business/2026-07-19-evaluation-object-model.md)

一句话定位：**用可复现的任务快照，把线上协作诊断、离线回归实验、模型裁判与人工校准连成一个闭环，回答“这次任务是否可信地完成、为什么、改动后是否真的更好”。**

---

## 1. 产品问题、用户与成功标准

### 1.1 要解决的问题

平台已有 `observation_span`、任务图、A2A、proof 和交付证据，能够回答“Agent 做了什么”，但还不能稳定回答：

1. 结果是否满足任务目标与项目交付门；
2. 过程中的工具选择、拆解、交接和修复是否合理；
3. 某次 RoleCard、Skill、模型或协作策略改动是否带来真实提升；
4. 自动评分是否与人的判断一致，是否发生漂移或被“刷分”；
5. 线上失败能否进入离线回归集，防止同类问题再次发生。

### 1.2 目标用户与主要任务

| 用户 | 主要任务 | 默认看到的内容 |
|---|---|---|
| 项目开发者 | 定位一次任务为何低分或失败 | 结论、关键门、证据、可执行建议 |
| Agent/Skill 维护者 | 对比改动前后是否提升 | 同一数据集上的基线与候选实验 |
| 评估负责人 | 维护标尺、样本和校准质量 | 数据集覆盖、裁判一致性、漂移 |
| 审核者 | 复核高风险结论和改进提案 | 原始证据、盲审结果、审批与回退 |

### 1.3 成功标准

- **诊断可信**：每个结论都可下钻到冻结证据，关键证据不存在时返回“证据不足”，不臆测。
- **比较有效**：只有任务类型、难度、数据集版本、rubric 版本兼容时才允许直接比较。
- **可复现**：一次评估能追溯输入快照、应用配置、代码 revision、RoleCard/Skill revision、裁判模型与参数。
- **可校准**：模型裁判持续对照人类标注集，报告一致率与分歧，而不是相信模型自报置信度。
- **不伤主链**：线上评估异步、幂等、可重试；失败不阻断 Agent loop、closure 或用户操作。
- **能防回归**：线上典型失败可脱敏后晋升为离线案例，候选改动必须与基线做成对比较。

### 1.4 非目标

- 不用行业排行榜替代项目内真实任务评估。
- 不宣称研发任务完全没有可验证答案；构建、测试、任务状态、必需工具参数等仍应确定性验证。
- 不让评估结果自动修改并上线 RoleCard、Skill 或协作策略。
- P1 不做跨项目排行榜、计费系统、分布式执行集群和通用模拟器平台。

---

## 2. 现状审计与关键架构纠偏

### 2.1 可复用事实

| 事实 | 权威来源 | 评估用途 |
|---|---|---|
| 一次 Agent turn 的调用树 | `observation_span` / `observation_span_payload` | 工具、上下文、输出与耗时证据 |
| 任务结构与状态 | `task` / `task_edge` | 目标、拆解、终态与交付门 |
| 协作交接 | `a2a_possession_chain` / `a2a_possession` / `a2a_pass` / handoff packet | 责任转移与交接质量 |
| 控制面证据 | `control_proof_event` | 触发、路由、失败和幂等 |
| 现成确定性判定 | `checkValidExit`、`evaluateTaskStatusEvidenceGate` | 格式与交付证据门 |

评估结果是这些事实的**带版本投影**，不能反向改写业务事实。

### 2.2 关键纠偏：完整任务不等于单个 trace

`agent-observability` 的既有契约是“一次 harness trigger 创建一个 trace；一个 conversation 包含多个 trace”。因此 Mario → Luigi → Peach 的完整协作通常跨多个 trace。

本系统的在线评估对象改为：

```text
EvalSubject =
  projectId + conversationId + rootTaskId
  + optional possessionChainId
  + evidenceCutoffAt
```

`traceIds[]` 是快照内的证据索引，不是评估对象主键。`evidenceCutoffAt` 冻结“评估当时看见的事实”，避免迟到事件让历史报告悄悄变化。

### 2.3 原方案主要缺口

| 原方案 | 风险 | 修订 |
|---|---|---|
| `trace_id × rubric_id × judge_model` 即一次运行 | 跨 trace 任务丢证据 | 引入任务级 `subject_snapshot` |
| Rubric 可原地更新 | 历史分数无法解释 | 逻辑 rubric + 不可变 revision |
| 单一总分 | 关键失败可能被平均值掩盖 | 关键门 + 分维度 + 覆盖率 + 可选总分 |
| LLM 自报 `confidence` | 与真实正确率无可靠对应 | 用人类一致率、重测一致性和裁判分歧 |
| “工具成功率 = 工具准确率” | 成功执行不等于选择正确 | 拆成执行成功、选择/参数正确两类 |
| closure 后直接 best-effort 调用 | 重复触发、进程重启、限流难治理 | 幂等 job、状态机、重试和死信 |
| golden trace 只校准 rubric | 容易过拟合且不可重放 | 版本化案例集 + 人类标签 + held-out split |
| 分数提升即证明优化有效 | 任务难度与随机性混淆 | 成对实验、置信区间与实际效应阈值 |
| 建议可自动 apply | 评分劫持与自我强化 | 只生成变更提案，人工审批、回归、回退 |

---

## 3. 成熟能力地图与分期

成熟评估系统不是一个 Judge API，而是“定义成功 → 收集案例 → 冻结运行 → 多类评分 → 校准 → 比较 → 门禁 → 学习”的系统。

| 能力域 | P1：可信诊断 MVP | P2：回归与治理 | 后续 |
|---|---|---|---|
| 在线评估 | closure 后任务快照、异步评分、证据下钻 | 采样、告警、人工队列 | 漂移检测、容量治理 |
| 离线评估 | 最小校准集、固定案例重评 | 数据集版本/split、批量实验、基线 | 仿真、对抗生成、跨项目基准 |
| 评分器 | 硬门、规则、单模型 Judge | 成对 Judge、分歧仲裁、人类标注 | 专用 Judge、领域专家网络 |
| 可复现 | rubric/app/judge/input revision | 完整实验清单、导入导出 | 跨环境重放 |
| 统计 | 覆盖率、逐例差异 | bootstrap CI、实际效应阈值、回归门 | 序贯检验与功效分析 |
| 反馈闭环 | 差距与建议 | 变更提案、审批、回归、回退 | 安全的半自动优化 |
| 治理 | 脱敏、最小权限、审计 | 保留/删除策略、成本预算 | 合规策略包 |

**P1 边界判断**：P1 必须含一个小型离线校准集。没有人类标注的自动裁判只能算“评分原型”，不能称为可信评估系统。

---

## 4. 核心对象与事实边界

### 4.1 领域对象

| 对象 | 含义 | 关键不变量 |
|---|---|---|
| `Rubric` | 评估标尺的逻辑身份 | 名称可持续存在 |
| `RubricRevision` | 一次不可变标尺版本 | 发布后不可原地修改 |
| `EvalSubjectSnapshot` | 一次线上任务或离线案例的冻结证据 | 内容哈希稳定；可追溯来源 |
| `EvalRun` | 用一个评估配置处理一个快照 | 幂等键唯一；状态可恢复 |
| `EvalScore` | 一个维度的一次确定结论 | 带适用性、证据和 evaluator revision |
| `JudgeAttempt` | 一次模型裁判调用 | 保存模型、参数、解析与用量 |
| `EvalDataset` / `EvalCase` | 可重放案例集合与案例 | 数据集 revision 与 split 可追溯 |
| `HumanAnnotation` | 人对案例/分数的结构化判断 | reviewer 与 rubric revision 可追溯 |
| `EvalGap` | 被证据支持的差距 | 不是直接变更命令 |
| `ChangeProposal` | 从差距形成的候选改动 | 必须审批、回归、可回退 |

### 4.2 快照组成

任务快照至少包含：

- `projectId / conversationId / rootTaskId / possessionChainId?`
- `evidenceCutoffAt / collectedAt / snapshotHash`
- `traceIds[] / taskIds[] / passIds[] / proofEventIds[] / messageIds[]`
- 脱敏、裁剪后的 Judge 证据包；完整内容仍按原权限从事实源下钻
- 任务类型、难度、语言、角色组合、场景标签
- `codeRevision / worktreeRef / roleCardRevisions / skillRevisions / modelConfigDigest`
- 数据完整性报告：缺失来源、迟到事件、截断项和覆盖率

### 4.3 在线与离线统一

```text
线上：真实任务事实 → EvalSubjectSnapshot → EvalRun
离线：EvalCase + 候选应用执行 → EvalSubjectSnapshot → EvalRun
```

两者复用评分器与报告，但不能混为同一种证据：

- 在线运行适合发现真实分布中的异常和候选案例；
- 离线实验适合在固定数据集上比较候选与基线；
- 线上低分不自动等于产品回归，离线高分也不自动等于线上成功。

---

## 5. 评估方法：四层判定而非万能总分

### 5.1 第一层：关键门（Hard Gates）

关键门回答“能否视为合格交付”，结果为 `pass | fail | unknown | not_applicable`：

- 根任务是否达到允许的终态；
- 必需构建、测试、类型检查、review evidence 是否存在且通过；
- closure 是否满足 `valid-exit`；
- 是否存在权限、安全、秘密泄漏或越权工具调用；
- 关键交接是否有真实 start/complete receipt。

任一必需门为 `fail` 时，报告为“未通过”；为 `unknown` 时，报告为“证据不足”。总分不能覆盖该状态。

### 5.2 第二层：确定性指标（Deterministic Scorers）

| 指标 | 正确定义 | 误用防线 |
|---|---|---|
| 任务结果率 | completed / eligible leaf tasks，并单列 blocked/cancelled | blocked 不算 completed，也不静默丢弃 |
| 工具执行成功率 | 工具结果 `ok` / 有终态的工具调用 | 无调用返回 N/A，不返回 100% |
| 工具选择/参数正确 | 对有预期工具约束的离线案例做匹配 | 不从“调用成功”推断“调用正确” |
| 交付证据完整度 | 必需 evidence 字段满足数 / 应满足数 | 只对进入对应状态的任务适用 |
| 交接可靠性 | started/completed receipt、失败阶段、重试 | 不用文本中的“已交付”代替 receipt |
| 延迟/token/重试 | 原始量 + 同类 cohort 分位数 | 不跨难度直接评好坏 |
| 循环与返工 | 重复 pass、重复工具、reopen、review 打回 | 区分合理迭代与无效循环 |

### 5.3 第三层：模型裁判（Model Judge）

适用于无法由事实直接判定的维度：

- 需求理解与范围遵守；
- 拆解覆盖、依赖顺序与职责边界；
- 证据使用是否充分，是否无依据推断；
- 交接包是否足以让接收者行动；
- 最终交付说明是否清晰、诚实、可执行；
- 代码/设计质量中无法被测试覆盖的部分。

默认用**带锚点的等级制**，例如 0/1/2/3，每一级给出行为示例；再归一化到 0–100。与“打 7.3 分”相比，分类或成对比较更易校准。

Judge 输出必须符合结构化 schema：

```ts
type JudgeResult = {
  label: '0' | '1' | '2' | '3' | 'not_applicable' | 'insufficient_evidence';
  rationale: string;
  evidenceRefs: Array<{ sourceType: string; sourceId: string }>;
  violatedCriteria: string[];
  proposedGap?: string;
};
```

### 5.4 第四层：人工判断与校准

- 建立小而精的专家标注集，覆盖正常、边界、失败、长链路和多语言案例；
- 先由两人独立盲审，分歧由第三人或评估负责人仲裁；
- 统计精确一致率、加权 Cohen’s kappa（两人）或 Krippendorff’s alpha（多人/缺失标签）；
- Judge 达到预设一致性门后才可扩大线上自动评分；
- 高风险 gap、Judge 分歧和“证据不足”进入人工队列。

模型自报 `confidence` 只保留作诊断信息，不作为可信度门槛。

### 5.5 默认研发任务 Rubric v1

| 维度 | 评分器 | 适用性 | 说明 |
|---|---|---|---|
| 交付门 | hard gate | 有实现交付的任务 | build/test/typecheck/review evidence |
| 任务结果 | deterministic | 有任务图 | 完成、阻塞、取消分布 |
| 工具可靠性 | deterministic | 有工具调用 | 终态、错误、重试 |
| 协作可靠性 | deterministic | 多角色任务 | receipt、失败阶段、循环 |
| 需求与范围遵守 | judge | 全部 | 是否满足目标且未越界 |
| 拆解质量 | judge | 有 planner/子任务 | 覆盖、粒度、依赖、owner |
| 证据与诚实性 | judge + gate | 全部 | 结论是否有证据，限制是否披露 |
| 交付可用性 | judge + gate | 有最终交付 | 可理解、可操作、风险清晰 |
| 效率画像 | deterministic | 证据完整时 | token/延迟/返工，仅同 cohort 比较 |
| 安全与合规 | gate + deterministic | 全部 | 秘密、越权、危险操作 |

报告同时展示：

- `gateStatus`
- `dimensionScores`
- `evidenceCoverage`
- `dataQuality`
- `overallScore?`（仅全部必需维度可评分时计算）

---

## 6. 数据与版本模型

### 6.1 P1 表

1. `eval_rubric`：逻辑身份、owner、状态。
2. `eval_rubric_revision`：不可变 JSON 定义、revision、content hash、发布者、发布时间。
3. `eval_subject_snapshot`：评估对象、冻结边界、证据引用、配置 revision、snapshot hash、数据质量。
4. `eval_run`：mode、snapshot、rubric revision、幂等键、状态、gate status、coverage、总分、错误码、时间。
5. `eval_score`：dimension、evaluator kind/revision、applicability、raw/normalized score、label、rationale、evidence refs。
6. `eval_judge_attempt`：run/score、模型与参数、prompt digest、响应、解析状态、token/latency/error。
7. `eval_gap`：差距、severity、证据、建议目标、状态。
8. `eval_dataset` / `eval_case`：最小校准集与来源、split、标签、脱敏状态、revision。
9. `eval_annotation`：人工标签、reviewer、rubric revision、盲审批次。

### 6.2 P2 表

- `eval_experiment` / `eval_experiment_item`：固定数据集 revision 上的基线与候选运行。
- `eval_change_proposal`：变更假设、目标 revision、审批、回归结果、apply/revert 证据。

### 6.3 不变量

- 已发布 rubric revision、subject snapshot、score 和 judge attempt 不原地修改。
- 重跑创建新 run；历史结果不覆盖。
- `idempotencyKey = mode + subjectSnapshotHash + rubricRevisionId + evaluatorBundleDigest`。
- `eval_run.status ∈ queued | running | partial | completed | failed | cancelled`。
- 一个维度可有多个 attempt，但只有显式聚合后的 score 成为报告结论。
- Judge 引用必须在 snapshot 证据清单内，否则 attempt 标记 `invalid_evidence`。
- 原始 Judge 返回只存脱敏与限长版本；隐藏推理不采集。

---

## 7. 执行架构与接口

### 7.1 在线流程

```text
closure proof committed
  → EvalTrigger 生成幂等 job
  → SnapshotBuilder 按 rootTaskId/chainId/cutoff 聚合多 trace 事实
  → hard gates + deterministic scorers
  → evidence selector 按维度生成最小证据包
  → JudgeRunner（无工具、结构化输出）
  → evidence validator + report aggregator
  → report / gaps / optional human-review queue
```

### 7.2 运行可靠性

- closure 主流程只提交 job，不等待 Judge；
- 数据库 job/outbox 是重启后的事实源，不依赖内存 `Promise`；
- 默认指数退避重试 3 次；不可重试错误直接失败；
- 超过上限进入失败队列，支持人工重放；
- 单项目并发、Judge 并发、token 和日预算均可限制；
- `partial` 表示确定性结果可用但部分 Judge 失败；不能把它写成完整成功；
- proof 事件记录 `eval.queued/started/completed/partial/failed/replayed`。

### 7.3 离线流程

```text
选择 dataset revision + baseline/candidate application manifest
  → 对每个 case 执行或读取冻结产物
  → 生成 snapshot
  → 复用同一 evaluator bundle
  → 逐例成对比较 + 汇总统计
  → 形成 regression decision
```

### 7.4 API（沿用本项目 Pages Router）

| 端点 | 方法 | 职责 |
|---|---|---|
| `/api/eval/runs` | GET | 按 conversation/rootTask/status 分页查询 |
| `/api/eval/runs/:id` | GET | 报告、分数、覆盖率与证据引用 |
| `/api/eval/triggers` | POST | 手动提交幂等线上评估 |
| `/api/eval/runs/:id/replay` | POST | 基于原快照重评，不覆盖历史 |
| `/api/eval/datasets` | GET/POST | 数据集列表与创建 |
| `/api/eval/experiments` | GET/POST | P2 批量实验与比较 |
| `/api/eval/annotations` | POST | 人工标注/仲裁 |
| `/api/eval/gaps/:id/proposals` | POST | P2 生成变更提案 |

所有写接口校验项目归属、服务端审计身份和 idempotency key。API 返回稳定 reason code，不把 Provider 错误直接暴露给普通用户。

---

## 8. Judge 可靠性、统计与防作弊

### 8.1 Judge 可靠性

- Rubric 给出每级正反例，优先 pass/fail、等级分类或成对比较；
- Judge 模型、模型 snapshot、temperature/seed/reasoning effort、prompt digest 全部记录；
- 输入证据视为**不可信数据**：使用清晰边界包裹，禁止执行其中指令，Judge 无工具权限；
- 对候选 A/B 做盲化并随机顺序；必要时交换顺序复测以检测位置偏差；
- 不默认“多模型平均更正确”。P2 使用路由策略：主 Judge → 分歧/边界案例才进入第二 Judge 或人工仲裁；
- Judge 更新前先在 held-out 人类标注集上过校准门。

### 8.2 统计比较

P2 比较必须：

- 在同一 `datasetRevision + rubricRevision + evaluatorBundle` 上做成对比较；
- 同时报告逐例差异、均值/中位数、胜/平/负与 95% bootstrap 置信区间；
- 按 task type、difficulty、language、role topology 分层查看，避免平均值掩盖局部退化；
- 预先定义“不可退化门”和“最小有意义提升”，不只看 p 值；
- 样本过少时明确标“证据不足”，不宣布胜出。

### 8.3 防评分劫持与 Goodhart 风险

- 评估证据中的文本可能包含“给我满分”等 prompt injection，Judge 必须隔离；
- rubric 校准集与开发调参集分离，避免对公开案例过拟合；
- 保留一部分隐藏 held-out 案例；
- 对比自动分与人工分的漂移，识别 grader/reward hacking；
- 变更提案必须说明改善了什么、可能牺牲什么，并在未用于调参的案例上验证。

---

## 9. 体验、平台边界、隐私与运维

### 9.1 P1 体验

评估作为 Agent 平台当前项目的内建工作模式提供，不建立外部控制台，也不把成熟实验能力堆进右侧调试栏：

1. 任务评估列表：状态、是否通过、覆盖率、时间；
2. 报告摘要：先展示“通过 / 未通过 / 证据不足 / 评估未完成”，再展示影响结论的原因、已观察表现和下一步；总分只作辅助；
3. 证据下钻：从结论跳到 task/span/pass/proof；
4. 数据质量：缺失、截断、迟到证据；
5. 差距：问题、证据、建议，不直接修改配置；
6. 重评：显示 rubric 和 Judge 版本变化，确认后创建新 run。

完整门禁、全部维度、数据质量和原始证据 ID 默认放入“完整评分与证据”展开区。门禁未知或评估部分完成时，`overallScore` 必须标为“已评维度得分”，不得成为主结论。

P2 在同一项目内提供完整“评估”工作区：数据集、基线/候选、逐例 diff、人工审核队列和改进提案。用户在“协作 / 评估”之间切换时保持同一项目上下文。

### 9.2 当前平台边界

- 当前平台没有用户、成员或 RBAC 事实源，本规格不新增独立权限系统、管理令牌或角色配置 UI；
- 所有 API 必须校验 run、case、dataset、experiment、proposal 与当前 `conversation/project` 的归属；
- 变更类审计字段使用服务端生成的本地平台操作者身份，不信任请求体伪造 `actorId/reviewerId/createdBy`；人工 annotation 单独要求 `reviewerName`，服务端归一化为 `local-reviewer:<name>`，只用于双人校准分组而非认证或授权；
- 完整证据沿用平台现有调试入口的可见边界，不新增第二套证据存储；
- 若未来平台建立统一身份与项目成员模型，评估能力接入该统一事实源，不自行维护成员表。

### 9.3 隐私与保留

- 快照和 Judge 输入必须经过 `redactObservationPreview` 等同等级脱敏，但不能误以为预览截断等于完整隐私策略；
- secrets、authorization header、环境变量、私钥、隐藏 chain-of-thought 永不进入快照；
- 记录 payload 来源、脱敏版本和截断原因；
- P2 提供项目级 retention、删除与导出；删除源事实时，派生快照按策略级联删除或不可逆去标识；
- 发送到外部 Judge Provider 前执行 Provider allowlist 与数据策略检查；
- 评估配置变更、人工标注、提案 apply/revert 进入审计日志。

### 9.4 SLO 与预算

- closure 提交评估 job：P95 < 500ms，不含实际评估；
- P1 单任务评估完成：P95 < 120s；超时转 partial/failed，不阻塞主链；
- Judge 单请求上限 25s、最多 3 次尝试、回退 5s/10s；即使最终触发第二 Judge，理论最坏调用路径为 115s。P95 从 run 创建时间起算，包含排队；
- 重复 closure proof 不产生重复 run；
- Judge token/调用次数按 run 记录，超预算时保留确定性评分并标 `budget_exhausted`；
- 队列积压、失败率、partial 率、Judge 解析失败率和人工分歧率可观测。

---

## 10. 实施路线、风险与决策记录

### 10.1 发布门

**P1 可转 active 的前置决策**

- 确认任务类型/难度标签的最小枚举；
- 确认 rubric 维护责任与发布流程；
- 确认 Judge Provider allowlist 和数据外发策略；
- 确认最小人工校准集负责人。

**P1 implemented 退出条件**

- `tasks.md` T1–T14 与 `checklist.md` C1–C17、C23–C26 全部满足；
- 长期技术文档与最终实现同步；
- 默认 rubric 在 held-out 人类标注集达到约定一致性门；
- 线上失败不会影响 closure，重复触发可证明幂等；
- 规格迁入 `docs/archive/specs/` 前，稳定结论已回写 `docs/technical/` 和 `docs/product/`。

### 10.2 主要风险

| 风险 | 监测 | 缓解 |
|---|---|---|
| 输入事实不完整 | evidence coverage / data quality | unknown 而非猜测；补采集后新建 run |
| Judge 偏见或漂移 | 人类一致性、顺序一致性、解析失败率 | 校准、盲化、版本冻结、仲裁 |
| 任务难度混淆 | cohort 分层 | 禁止跨 cohort 直接排名 |
| 线上成本失控 | token、队列、预算事件 | 采样、按需第二 Judge、日预算 |
| 反馈闭环自我强化 | 自动分与人工分背离 | 人工审批、held-out 回归、回退 |
| 敏感信息外发 | 脱敏失败/策略拒绝 proof | 本地规则优先、Provider allowlist |

### 10.3 教学式决策记录

| ID | 观察 | 推导 | 决策 | 放弃的方案 |
|---|---|---|---|---|
| D1 | 一次协作跨多个 harness trace | 单 trace 不能代表完整任务 | rootTask/chain + cutoff 快照 | `trace_id` 作为评估主键 |
| D2 | 硬事实与主观质量性质不同 | 平均会掩盖关键失败 | 四层判定 | 八维统一相加 |
| D3 | 历史事实会继续写入 | 查询时现算会漂移 | 不可变 snapshot | 每次打开报告重新 join |
| D4 | LLM 自报信心不可校准 | “0.9 confidence”不等于 90% 正确 | 人类一致性与分歧 | 直接信任 confidence |
| D5 | 线上 trace 适合发现问题，不适合公平对比 | 任务分布与难度变化 | 在线诊断 + 离线固定集双环 | 只做 closure 在线评分 |
| D6 | 分数可能被优化对象利用 | 自动 apply 会放大 Goodhart 风险 | 提案→审批→回归→回退 | 自动改 Prompt/Skill |
| D7 | 多 Judge 成本高且相关性强 | 简单平均未必增加真值 | 分歧路由与人工仲裁 | 所有维度默认 2×3 次调用 |
| D8 | 评估与 Agent 平台部署在同一产品、共享同一项目上下文 | 独立控制台会复制导航、项目选择和身份边界 | 评估作为项目主工作区的“评估”模式 | 独立评估站点或右侧调试栏 tab |
| D9 | 仅给 run 打上 case/manifest 标签不能证明案例真的被执行 | 伪 provenance 会让回归门产生虚假安全感 | 旧客户端配对实验只作诊断；Harness/Daemon 评估模式只有在 case、快照、worktree HEAD、invocation、trace、proof 与 EvalRun 全部绑定后才写 `execution_verified=1` | 把标签匹配当作执行证明 |
| D10 | Judge 调用发生在数据库事务之外，多个 worker 可同时越过“先查询后调用”的预算判断 | 日预算必须在外部调用前形成数据库内互斥占用 | 使用带过期时间的原子 token reservation；attempt 落库后释放 | 仅统计历史 token 后再决定是否调用 |
| D11 | 全局数据集可被多个项目复用，但人工标注和校准结论属于当前项目 | 只按 dataset 聚合会跨项目污染 kappa | annotation 显式保存 conversation scope；审核者姓名用于校准审计，不代表权限角色 | 全局数据集上的全局 annotation |
| D12 | 当前平台没有可验证的统一用户身份 | 自填 Alice/Bob 只能区分标签，不能证明是两个人 | API 标注记为 `identity_unverified`，不得使 rubric 进入 calibrated；统一身份接入后再开放校准门 | 把两个不同的输入姓名当作双人校准证据 |
| D13 | 同一平台操作者能通过 experiment/run 相邻接口识别 baseline/candidate | 仅把 runId 替换为 token 不能形成真正盲测 | pairwise 算法保留为内部验证；可信 case runner 已接通，但公开 API 在统一身份接通前仍返回 fail-closed reason code | 对无身份隔离的流程宣称“盲测” |
| D14 | 评估系统与 Agent 平台部署在一起，平台已经有 Harness/Daemon 执行链 | 另建 runner 服务会重复账号、运行时、上下文和观测能力；直接读取当前配置又会让历史实验不可复现 | `runner` 定义为现有 Harness/Daemon 的**评估执行模式**：服务端冻结 `ApplicationSnapshot`，用同一 held-out case 分别触发 baseline/candidate；每次使用独立 worktree、任务上下文与 session，账号只保存引用；规划前校验目标 revision，结束后用实际 worktree HEAD、Skill/RoleCard/模型清单生成 observed digest，完全相等才写 `execution_verified=1` | 新建独立评估执行服务，或仅在 run 上附加客户端提供的 manifest 标签 |

### 10.4 Runner 术语与可信执行契约

本文中的 `runner` 不是新的平台组件，也不是另一套 Agent runtime。它只是现有 Harness/Daemon 的一种受约束调用方式：

```text
Experiment
  → 冻结 baseline / candidate ApplicationSnapshot
  → 对每个 held-out case 创建两个 EvalCaseExecution
  → Harness 按快照规划上下文
  → Daemon 在两个隔离 worktree/session 中执行
  → 冻结 invocation/trace/task/artifact/proof
  → 评估并聚合 paired diff
```

`ApplicationSnapshot` 至少冻结：

- Git commit；
- TeamPack 内容、RoleCard snapshot；
- 每个 Agent 的 Skill revision；
- engine、runtime 与 account id 引用（不复制凭据）；
- 清单版本与规范化内容哈希。

可信执行必须同时满足：

1. case 输入只由服务端从冻结 dataset revision 读取；
2. baseline/candidate 不复用 session、task 或可写 worktree；
3. Harness 不回退到当前激活配置；
4. Daemon 记录实际工作目录 HEAD 与实际加载的配置清单；
5. target/observed manifest digest 完全一致；
6. invocation、trace、proof 与后续 `EvalRun` 可相互追溯。

任何一步缺失都可以保留为诊断运行，但不得进入发布门。

### 10.5 开放问题

- O1：任务类型和难度由谁标注，允许自动建议到什么程度？
- O2：P1 Judge 默认使用本地已绑定账号中的哪个允许模型，失败时是否允许跨 Provider？
- O3：哪些项目数据禁止发送给外部 Judge，只能运行确定性评分？
- O4：人工一致性门采用何种阈值；建议初始目标为加权 kappa ≥ 0.70 且关键门漏判率为 0。

---

## 11. 依据、差距追踪与关联文档

### 11.1 外部实践如何转化为本方案

| 外部经验 | 本项目采用方式 |
|---|---|
| 评估要贴近真实分布、持续运行并用人类校准自动分 | 线上案例晋升 + held-out 人工校准集 |
| 离线数据集与线上 trace 各自承担不同任务 | 在线诊断/发现，离线比较/门禁 |
| 规则、模型、人类、成对比较应组合使用 | 四层判定与 P2 成对实验 |
| Agent 评估要覆盖工具选择、参数与 handoff | 确定性工具指标 + Judge 轨迹/交接 |
| Judge 有位置/冗长偏差且可能被 reward hacking | 盲化换序、人类一致性、隐藏集 |
| 数据集必须版本化并支持 split | `EvalDataset/EvalCase` revision 与 held-out |

### 11.2 参考资料

- [OpenAI：Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [OpenAI：Graders 与 grader hacking](https://developers.openai.com/api/docs/guides/graders)
- [LangSmith：Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)
- [MLflow：Building evaluation datasets](https://mlflow.org/docs/latest/genai/datasets/)
- [MLflow：Evaluating production traces](https://www.mlflow.org/docs/latest/genai/eval-monitor/running-evaluation/traces/)
- [OpenTelemetry：GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- [Judging the Judges：position bias study](https://arxiv.org/abs/2406.07791)

### 11.3 项目关联

- 长期技术设计：[`docs/technical/evaluation/agent-evaluation-system.md`](../../docs/technical/evaluation/agent-evaluation-system.md)
- 观测事实：[`docs/technical/observability/agent-observability.md`](../../docs/technical/observability/agent-observability.md)
- 完整 payload 与下钻：[`observability-drilldown`](../observability-drilldown/)
- closure 与持久幂等：[`docs/technical/execution/context-injection-mvp.md`](../../docs/technical/execution/context-injection-mvp.md)

### 11.4 本轮分析留痕

本轮不是对原结构继续“加卡片”，而是完成了三次根本性检验：

1. 用现有 observability 契约验证评估粒度，发现并修正“任务 = trace”的错误；
2. 用成熟系统的在线/离线分工检验产品范围，补上数据集、实验与校准；
3. 用可复现性、统计和安全检验闭环，补上不可变版本、幂等队列、人工门与防评分劫持。

后续评审若改变任何 D1–D13 决策，必须同时更新本 spec、tasks、checklist 和 architecture.html。

### 11.5 实施记录（2026-07-19）

已落地：

- migration 27–38、Drizzle schema、数据库不可变约束、ApplicationSnapshot/case execution、原子预算预留、默认 rubric 与 12 个 train/tune/held-out 中英校准案例；migration 41 兼容已执行旧迁移但缺少自主交付 `revision` 的数据库，迁移按版本号排序执行；
- 提交事务内冻结的 snapshot builder、硬门禁/确定性 evaluator、锚点式无工具 Judge adapter、持久 job/lease token/retry、原子 report/gap/replay；
- closure valid-exit 后异步提交与 `eval.*` proof；
- `/api/eval/runs`、datasets、annotations、experiments、pairwise、reviews、proposals、policy、operations；
- 平台项目内“协作 / 评估”工作模式、paired bootstrap 分层实验、盲测换序、双 Judge 分歧路由与受控 proposal 状态机。

尚未满足 implemented 退出门：

- O1–O4 中与模型、数据外发和人工阈值相关的项目仍需产品负责人确认；当前采用保守默认值；
- 用户已确认当前平台没有权限管理；conversation 归属隔离是本阶段真实边界，统一身份接入属于平台未来能力；
- 第二轮设计审查纠正了五个容易“看起来成熟、实际上不可信”的点：预算改为原子预留；全局数据集的标注按项目隔离；pairwise API 只暴露 opaque subject token；case promotion 生成新 dataset revision 并冻结脱敏证据；回归门要求真实 case runner provenance；
- 第三轮把 runner 收敛为现有 Harness/Daemon 的评估执行模式，接通 ApplicationSnapshot、指定 commit detached worktree、独立 session、显式 Skill revision、执行 proof、EvalRun 与自动 paired aggregation；没有另建执行服务；
- 第四轮把工具“执行成功”与“选择/参数正确”落成两个独立指标，并将评分语义升级为 `eval-bundle-v2 / deterministic-v2`；历史结果不原地改写；
- 第五轮补齐 24-run/4-worker 容量演练、queue-inclusive P95、并发饱和度与预算余量指标，并将 Judge 最坏调用路径约束在 120 秒 SLO 内；
- pairwise 换序分歧的人工裁决会回写 `resolved_winner` / `human_resolved`，proposal 只有在每个 case 都完成一致或人工裁决的盲测、且执行 provenance 已验证时才允许审批或应用；
- held-out 集尚未由两名指定审核者完成真实盲标，Judge 校准不能宣称通过；
- 线上失败晋升审核、SQLite 备份恢复、工作区可访问性扫描与容量/P95 已有自动化证据；生产环境仍需持续积累真实 Provider 延迟分位数。
## 2026-07-19 单操作者提案治理补充

平台当前没有权限管理。经产品确认，change proposal 在本阶段采用“单一平台操作者明确确认”治理：不校验角色或权限，但 approve/apply 请求必须携带显式确认，服务端记录固定平台操作者、时间与回归实验。held-out、执行来源和逐例盲测质量门保持不变。未来接入统一身份后只替换操作者事实源，不改变提案状态机。
