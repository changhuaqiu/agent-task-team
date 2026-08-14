# 实施任务 — Agent 评估系统

> Canonical contract: [`spec.md`](./spec.md)
> 状态：实施中。任务按依赖顺序执行；设计与实现变更必须同步更新长期文档。

> 2026-07-19 实施审计：用户确认平台当前没有权限管理，评估按平台内建项目能力落位，不新增 RBAC。双 Judge、换序复测、分层统计、线上案例晋升、容量/P95、备份恢复、可访问性扫描、平台内评估工作区以及单一平台操作者 proposal 批准/apply 已有代码与自动化证据；真实人工盲标校准与可验证盲审身份尚未完成，因此本清单不整体标记完成。

## 已确认的 P0 产品语义收敛

- [ ] 将现有 12 条合成数据明确命名为 Rubric/Judge 校准集，并与可执行核心回归集分开。
- [ ] 在线评估绑定根任务执行；项目只承担容器和聚合概览。
- [x] 结果页以结论、原因、表现和下一步为首屏，完整评分与证据渐进展开。
- [x] 门禁/证据不足优先于综合分；不完整评估只显示“已评维度得分”。
- [x] 将当前 `efficiency` 用户标签纠正为“工具执行成功率”。

## P1 · 可信诊断 MVP（T1–T14）

### 契约与数据

- [ ] **T1 事实边界与术语冻结**
  - [ ] 核对 Task Graph、A2A、proof、observation 的实际 repository/API 和关联键
  - [ ] 定义 `EvalSubject`、任务类型/难度最小枚举、reason code 与平台项目归属边界
  - [ ] 确认 Judge Provider allowlist、数据外发和人工校准 owner
- [ ] **T2 Schema 与 migration**
  - [ ] 新增 `eval_rubric`、`eval_rubric_revision`
  - [ ] 新增 `eval_subject_snapshot`、`eval_run`、`eval_score`、`eval_judge_attempt`
  - [ ] 新增 `eval_gap`、`eval_dataset`、`eval_case`、`eval_annotation`
  - [ ] 建立 FK、唯一幂等键、查询索引和 retention 所需时间索引
- [ ] **T3 Repository 与事务**
  - [ ] 实现 rubric、snapshot、run/score/attempt、dataset/case/annotation、gap repositories
  - [ ] snapshot + run 创建、run 聚合完成使用 SQLite 事务
  - [ ] 覆盖分页、项目归属、按 rootTask/chain/status 查询
- [ ] **T4 默认 Rubric 与最小校准集**
  - [ ] seed 不可变 `default-dev-task-v1` revision，包含 hard gate、适用性与等级锚点
  - [ ] 建立不少于 12 个脱敏案例，覆盖好/坏/边界/证据不足/长链路/中文与英文
  - [ ] 训练/调参案例与 held-out 校准 split 分开

### 快照、评分与运行

- [ ] **T5 `EvalSnapshotBuilder`**
  - [ ] 以 `projectId + conversationId + rootTaskId + chainId? + cutoffAt` 聚合多 trace 证据
  - [ ] 冻结 `traceIds/taskIds/passIds/proofEventIds/messageIds` 和配置 revisions
  - [ ] 生成 `snapshotHash`、数据完整性/截断报告；迟到事件不得改变旧快照
- [ ] **T6 `DeterministicEvaluator`**
  - [ ] hard gates：任务终态、valid-exit、交付证据、安全/权限、交接 receipt
  - [x] metrics：结果分布、工具执行、离线工具选择/参数匹配、交接可靠性、返工、耗时/token/重试
  - [ ] 正确处理 `not_applicable` 与 `insufficient_evidence`，禁止空分母返回满分
- [ ] **T7 `JudgeRunner`**
  - [ ] 按维度选择最小脱敏证据包，并把证据当不可信数据隔离
  - [ ] 复用 account/credential 注入，Judge 无工具权限
  - [ ] 使用结构化输出；记录模型 snapshot、参数、prompt digest、token、latency
  - [ ] 校验分数范围与证据引用，失败返回稳定 reason code
- [ ] **T8 `EvalOrchestrator` 与持久 job**
  - [ ] 状态机：`queued → running → completed|partial|failed|cancelled`
  - [ ] 数据库 job/outbox、指数退避、最多 3 次、可人工重放
  - [ ] 并发和 token/日预算；确定性结果可在 Judge 失败时形成 partial
- [ ] **T9 `EvalReportBuilder`**
  - [ ] 聚合 gate status、维度、coverage、data quality、可选 overall score
  - [ ] 关键门失败/未知不得被总分掩盖
  - [ ] 生成有证据的 gap；证据不足不生成武断建议

### 触发、API 与体验

- [ ] **T10 在线触发与 proof**
  - [ ] closure proof commit 后只提交幂等 job，不等待 Judge
  - [ ] 记录 `eval.queued/started/completed/partial/failed/replayed`
  - [ ] 重启、重复 closure、限流与 Provider 失败均不影响主链
- [ ] **T11 Pages Router API**
  - [ ] `/api/eval/runs`、`runs/:id`、`runs/:id/replay`
  - [ ] `/api/eval/datasets`、`annotations`
  - [ ] 参数 schema、项目归属、服务端审计身份、分页、idempotency、稳定错误码
- [ ] **T12 项目“评估”视图**
  - [ ] 列表展示通过状态、coverage、data quality、时间
  - [ ] 报告按“关键门 → 维度 → 总分”排序
  - [ ] 证据下钻到 task/span/pass/proof，复用 observability drill-down
  - [ ] 差距只生成建议；重评明确创建新 run

### 验证

- [ ] **T13 自动测试与校准**
  - [ ] repositories、snapshot、多 trace、迟到事件、幂等与事务测试
  - [ ] hard gate/空分母/N/A/证据不足/恶意 trace 文本测试
  - [ ] Judge schema、引用校验、预算、重试、partial 测试
  - [ ] 两名人工审核者盲标 held-out 集，计算一致性和 Judge 对人一致性
- [ ] **T14 端到端与故障演练**
  - [ ] 跑 Mario → Luigi → Peach 的跨 trace 研发任务并产生完整报告
  - [ ] 演练重复 closure、服务重启、LLM 失败、超预算、payload 缺失和删除
  - [ ] 完成类型检查、相关测试、生产构建和文档同步

## P2 · 回归实验与治理（T15–T20）

- [ ] **T15 Judge 校准与分歧路由**
  - [ ] 等级锚点、成对盲评、候选顺序随机与换序复测
  - [ ] 主 Judge 边界/分歧案例才调用第二 Judge
  - [ ] 人工仲裁队列；跟踪 kappa/alpha、顺序一致性与漂移
- [ ] **T16 数据集与批量实验**
  - [ ] `eval_experiment` / `eval_experiment_item`
  - [ ] dataset revision、split、基线/候选 application manifest
  - [ ] 线上失败经脱敏、审核后晋升案例；支持导入导出
- [ ] **T17 统计比较与回归门**
  - [ ] 逐例 paired diff、胜/平/负、均值/中位数、95% bootstrap CI
  - [ ] 按类型/难度/语言/角色拓扑分层
  - [ ] 最小有意义提升、不可退化门与样本不足结论
- [ ] **T18 在线监测与运营**
  - [ ] 项目级采样、预算、队列积压、partial/failed/解析失败告警
  - [ ] 高风险/分歧/证据不足进入人工审核队列
  - [ ] 保留、删除、去标识和 Provider 数据策略
- [ ] **T19 受控反馈闭环**
  - [ ] `eval_change_proposal`：假设、目标 revision、风险、审批
  - [ ] apply 前在 held-out 集回归；apply 后线上观察；支持 revert
  - [ ] 禁止评估服务直接写 RoleCard/Skill/Policy
- [ ] **T20 平台内评估工作区与发布门**
  - [ ] 数据集、实验、逐例 diff、标注队列和提案视图
  - [ ] 把回归门接入候选发布流程，但 Judge/平台故障采用明确 fail-open/fail-closed 策略
  - [x] 完成容量、成本、安全、备份恢复与可访问性验收（24-run/4-worker 容量演练、预算余量/SLO 指标、恢复与自动可访问性扫描均有证据；生产环境继续积累真实 Provider 分位数）

## 依赖图

```text
T1 → T2 → T3 → T4
          ├─ T5 → T6 ─┐
          └────── T7 ─┼→ T8 → T9 → T10 → T11/T12
                       └──────────────→ T13 → T14

P2: T15 + T16 → T17 → T18/T19 → T20
```

## 文件边界

- 不改变 Task Graph、A2A、proof、observation 的事实源地位。
- 不把 `ProjectObservationProjection` 直接扩成评估业务层；可复用其底层 repository/DTO，但 `EvalSnapshotBuilder` 单独拥有冻结语义。
- 不在 `daemon.ts` 内执行 Judge；主链只提交 job。
- API 使用当前项目的 `src/pages/api/` 约定；写代码前必须阅读仓库内对应 Next.js 指南。
- 实现中若改变 D1–D13 任一决策，先更新 spec、长期设计与架构图。

## 第二轮可信性审查后的剩余任务

- [x] **T21 可信边界硬化**
  - [x] Judge 日预算改为数据库原子 reservation，并为租约续期、模型输出设置上限
  - [x] 全局数据集 annotation 按 conversation 隔离；公开 API 接受审核者名称以支持双人校准
  - [x] pairwise 使用 opaque subject token；人工裁决回写权威 winner
  - [x] case promotion 生成不可变的新 dataset revision、冻结脱敏 evidence 并受 retention 保护
- [ ] **T22 平台 case runner 与发布门**
  - [x] 明确 runner 是现有 Harness/Daemon 的评估执行模式，不新增独立服务
  - [x] 持久化不可变 `ApplicationSnapshot` 与 `EvalCaseExecution` 状态机
  - [x] 由平台服务端从 held-out `input_payload` 发起 baseline/candidate 的真实执行
  - [ ] 接入可验证审核者身份，使实验创建者与盲评者可被平台事实源区分
  - [x] 生成绑定 case、application manifest、run、snapshot 与服务端 proof event 的不可伪造 execution provenance
  - [x] 只有 provenance 验证通过时写入 `execution_verified=1`
  - [ ] 以上两项完成后新增公开 pairwise route
  - [ ] 完成每个 case 的盲测/换序复测后，才允许 proposal 审批与 apply
- [ ] **T23 工作区操作闭环**
  - [x] 在平台内“评估”工作区完成 case promotion 审批与 Judge 分歧裁决
  - [x] 支持从 gap 生成 draft、提交、单操作者批准/apply 与回退；不满足可信回归门时服务端拒绝批准/apply
  - [x] proposal 批准/apply 按产品确认采用单一平台操作者显式确认；统一身份接入后替换操作者事实源
  - [x] 所有动作复用当前项目上下文，不新增独立项目选择器、登录或 RBAC
