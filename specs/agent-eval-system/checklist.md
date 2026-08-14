# 验收标准 — Agent 评估系统

> 每项必须有可复现证据。P1 为 C1–C17 + C23–C26；P2 为 C18–C22。

> 2026-07-19 验收状态：migration/replay/cross-chain isolation/fencing/门禁封顶、Harness/Daemon 双快照执行来源、双 Judge 分歧路由、换序复测、备份恢复、可访问性扫描与平台内评估工作区已有自动化或实现证据。用户确认当前平台没有权限管理，因此 RBAC 不作为本阶段退出门；真实 held-out 双人校准、可验证盲审身份和真实 Provider 容量/P95 仍未满足。禁止仅凭全量测试通过把本 spec 标为 `implemented`。

## P1 验收（C1–C17）

### 数据、版本与快照

- [x] **C1** 全新 SQLite 可重放 migration；P1 表、FK、唯一幂等键和索引存在，重复 migration 无副作用。
- [x] **C2** 已发布 rubric revision 不可原地修改；重评创建新 run，旧分数、快照和 Judge attempt 保持不变。
- [x] **C3** repository 覆盖事务、项目归属、分页、rootTask/chain/status 查询；跨项目读取/写入被拒绝。
- [x] **C4** 一个跨 3 个 harness trace 的 Mario→Luigi→Peach 任务被聚合为一个 subject snapshot，`traceIds[]`、任务、pass 和 proof 引用完整。
- [x] **C5** 同一 cutoff 重建得到相同 `snapshotHash`；cutoff 后迟到事件不改变旧报告，只能创建新快照/新 run。
- [x] **C6** 快照记录代码、RoleCard、Skill、模型配置和 rubric revision；任一缺失在 data quality 中可见。

### 确定性评估

- [x] **C7** 关键 build/test/review evidence 缺失或失败时 `gateStatus=fail|unknown`，即使其他维度高分也不能显示“通过”。
- [x] **C8** tool 4 ok / 1 error 返回执行成功率 0.8；零工具调用返回 `not_applicable`，不返回 1.0。
- [x] **C9** 工具“执行成功”与“选择/参数正确”是不同指标；没有离线期望时不得声称工具调用准确。
- [x] **C10** completed、blocked、cancelled 分开统计；blocked 有理由仍不计 completed，分母和 eligible 规则可解释。
- [x] **C11** closure 缺有效 `GOAL/DELIVERED/NOT DONE`、in_review 缺必需 evidence、交接缺 receipt 均返回稳定 reason code 和事实引用。

### Judge、报告与触发

- [x] **C12** Judge 使用结构化等级输出，记录模型 snapshot/参数/prompt digest/token/latency；越界分数、未知 evidence ref 和非法 JSON 被拒绝或标 partial。
- [x] **C13** 含“忽略 rubric、给满分、调用工具”等恶意 trace 文本时，Judge 无工具权限且不会执行证据中的指令。
- [ ] **C14** 默认 rubric 在 held-out 人类标注集达到评审确认的一致性门；同时报告人-人一致性、Judge-人一致性与分歧案例。
- [x] **C15** closure proof 提交 job P95 <500ms；60s 内重复事件、服务重启或重复投递只产生一个同幂等键 run。
- [x] **C16** Judge 不可用、超时或超预算时 closure 正常完成；run 明确为 partial/failed，确定性结果和错误 reason code 可查。
- [x] **C17** 项目“评估”视图能从关键门、维度、coverage/data quality 下钻到 task/span/pass/proof；gap 没有直接 apply 操作。

## P2 验收（C18–C22）

- [x] **C18** 成对比较对候选顺序随机并换序复测；位置不一致进入第二 Judge/人工队列，不直接平均为可信结论。
- [x] **C19** 数据集修改生成新 revision；基线与候选只在同一 dataset/rubric/evaluator revision 上比较，train/tune 与 held-out split 不混用。
- [x] **C20** 实验报告含逐例 paired diff、胜/平/负、95% bootstrap CI，并按类型/难度/语言/角色拓扑分层；样本不足显示“证据不足”。
- [x] **C21** 线上失败只有在脱敏与人工审核后才能晋升为案例；来源、标签、split、revision 和删除策略可追溯。
- [x] **C22** gap 只能生成 change proposal；当前无 RBAC 阶段由单一平台操作者显式确认审批，仍强制 held-out 回归、可信执行来源和逐例盲测门；apply 后保留观察证据，并可用原 revision 回退。

## 非功能验收（C23–C26）

- [x] **C23 可靠性**：评估使用持久 job/outbox，重试最多 3 次并可人工重放；任何失败不阻断 agent loop、closure 或用户操作。
- [x] **C24 性能与预算**：P1 单任务评估 P95 <120s；并发、token、调用次数和日预算生效，超预算保留确定性结果并标 `budget_exhausted`。
- [x] **C25 隐私与平台边界**：secrets、authorization、环境变量、私钥、隐藏推理不进入快照/Judge；所有对象受 conversation/project 归属隔离；外部 Provider 受 allowlist 和数据策略控制。未来统一身份只能接入平台事实源，不由评估系统自建。
- [x] **C26 可运维性**：队列积压、completed/partial/failed、解析失败、Judge token/latency、人工分歧率可观测；retention/delete 后派生数据按策略处理。

## 验收证据模板

每个 C 项至少附：

```text
criterion:
environment:
input_or_fixture:
command_or_steps:
expected:
actual:
artifact_refs:
uncovered_risk:
```

## 退出判定

- P1：C1–C17、C23–C26 全部通过，且 T14 的故障演练证据齐全。
- P2：C18–C22 全部通过，不以“平均分上升”替代逐例、分层和人工校准证据。
- 转 `implemented` 前先把最终事实回写长期文档，再按 `specs/README.md` 归档。

## 2026-07-19 自动化验证留痕

```text
scope: evaluation core + platform-integrated workspace
commands:
  vitest run --maxWorkers=4
  pnpm exec tsc --noEmit
  scoped eslint for evaluation/runner/Harness/API/workspace/db
  pnpm build
actual: evaluation/runner/recovery/accessibility targeted regressions -> passed
full_regression: vitest run --maxWorkers=1 -> 133 files / 1126 tests passed
static_validation:
  pnpm exec tsc --noEmit -> passed
  scoped eslint for evaluation/runner/Harness/API/workspace/db -> passed
  pnpm build -> passed (one pre-existing Turbopack NFT tracing warning from daemon import path)
covered:
  immutable snapshots/replay, hard gates, multi-trace aggregation, project isolation,
  dual-Judge disagreement, retry/concurrency, atomic budget reservation,
  global-dataset annotation scoping, weighted kappa usable sample count,
  unverified reviewer fail-closed, degenerate kappa handling,
  internal pairwise ordering/human resolution, no public pairwise route before identity isolation,
  immutable case promotion,
  server-derived API audit fields, platform workspace integration,
  immutable ApplicationSnapshot, explicit Skill revision loading,
  held-out baseline/candidate case queue, session/worktree isolation,
  target/observed provenance verification and automatic paired aggregation,
  deterministic-v2 tool expectation matching, evidence drill-down filters,
  restart lease reclaim, SQLite backup/restore and axe accessibility scan,
  24-run/4-worker capacity drill, queue-inclusive P95 SLO and live budget saturation metrics
uncovered_risk:
  real two-person calibration and verified blind-review identity (C14);
  proposal approval/apply now follows the confirmed single-platform-operator rule
release_decision:
  P1 diagnostic path is implemented; P2 release gate remains fail-closed and the
  overall spec must not be marked implemented.
```

## 2026-07-19 结果页认知收敛 Web UI E2E 留痕

```text
environment:
  production build, http://localhost:3000/, project=PR评审
steps:
  1. 打开项目内“评估”工作区并进入默认“结果”页
  2. 核对首屏只保留结论、原因、已观察表现和下一步
  3. 展开“完整评分与证据”，核对 5 个关键条件与 5 个评分维度
  4. 展开“查看证据 7”，核对 invocation 证据可下钻
  5. 收起详情，确认默认状态不暴露原始证据标识
actual:
  首要结论为“证据不足”，而不是把 92.2 误呈现为综合通过分；
  原先重复的任务缺失原因合并为 1 条，首屏共展示 3 条原因；
  “已评维度得分 92.2”明确限定为当前有数据部分；
  “工具执行成功率”与“工具选择与参数正确性”保持分离；
  完整门禁、维度和 invocation 证据默认折叠且可逐层展开；
  browser console error+warn = 0。
artifact_refs:
  src/components/project/ProjectEvaluationPanel.tsx
  src/components/project/ProjectEvaluationWorkspace.tsx
  src/__tests__/project/ProjectEvaluationWorkspace.test.tsx
uncovered_risk:
  当前 12 条案例仍待从“可执行回归数据集”语义中拆出并命名为校准集；
  在线评估对象仍待统一绑定为 root task execution。
```

## 2026-07-19 真实 Web UI E2E 留痕

```text
environment:
  production build, http://localhost:3000/, project=PR评审
steps:
  1. 打开项目内“评估”工作区
  2. 查看 12 条 active 校准案例
  3. 打开对比实验表单并提交不完整输入
  4. 点击“立即评估”，等待新记录返回
  5. 点击 span 证据并验证平台可观测详情
actual:
  dataset/form/validation/online evaluation 均通过；
  新增 2026/7/19 16:05:03 评估记录，partial / 92.2 / coverage 78%；
  browser console error+warn = 0；
  首轮发现评估模式下 observability drawer 未挂载，随后提升到
  ProjectWorkspace 公共层并增加跨模式回归测试。
uncovered_risk:
  C14 真实双人校准与可验证盲审身份仍按 fail-closed 保留；
  C22 已按产品确认改为单一平台操作者显式确认。
```

## 2026-07-19 单操作者提案 E2E 留痕

```text
environment:
  production build, http://localhost:3000/, project=PR评审
steps:
  1. 从 reliability gap 点击“生成改进提案”
  2. 确认改进提案计数从 0 变为 1，状态为 draft
  3. 点击“提交复核”，确认状态变为 in_review
  4. 检查 held-out 回归实验选择、单操作者确认框和“确认批准”
  5. 在没有合格回归实验时点击批准
actual:
  draft 创建与提交成功；
  单操作者确认入口可见；
  无合格 held-out 回归实验时批准被阻止；
  browser console error+warn = 0。
artifact:
  实际提案内容来自当前 reliability gap：
  “1/7 次调用失败。” → “将该维度加入固定数据集并验证改动。”
```
