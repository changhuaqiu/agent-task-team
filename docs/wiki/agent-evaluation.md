# Agent 评估当前实现

本文记录仓库中已经运行的评估能力；目标设计与退出门以
[`docs/technical/evaluation/agent-evaluation-system.md`](../technical/evaluation/agent-evaluation-system.md)
和 [`specs/agent-eval-system/`](../../specs/agent-eval-system/) 为准。

## 运行链路

1. closure Agent turn 通过 valid-exit 后，daemon 调用 `agentEvaluation.submit`。
2. 提交事务冻结 cutoff 以内的 Task/A2A/Proof/Observation/Message 事实，并创建 `eval_run + eval_job`；它不调用模型。
3. worker 通过 SQLite lease token 领取 job，只消费持久快照，不再读取可变业务表。
4. 硬门禁和确定性指标先执行；Judge 根据项目 policy 决定是否执行，边界结果按需调用第二 Judge。
5. Judge 不可用、项目禁用或日预算耗尽时，run 为 `partial`，确定性分项仍可查询。
6. 双 Judge 一致才保留边界分数；不一致进入 `eval_review_queue`，不做平均。
7. 分数、attempt、gap、run 与 job 使用 fencing token 在一个事务内完成；重放创建新 run 并直接绑定旧 `snapshot_id`。

## 模块入口

| 能力 | 文件 |
|---|---|
| 深模块接口与 worker | `src/server/evaluation/agent-evaluation.ts` |
| 冻结快照 | `src/server/evaluation/snapshot-builder.ts` |
| 确定性评估 | `src/server/evaluation/deterministic-evaluator.ts` |
| 模型 Judge | `src/server/evaluation/judge.ts` |
| 数据集、实验、提案 | `src/server/evaluation/evaluation-lab.ts` |
| 应用快照与执行状态机 | `src/server/evaluation/application-snapshot.ts` |
| Harness/Daemon 评估调度 | `src/server/evaluation/case-runner.ts` |
| 运行监控与 retention | `src/server/evaluation/operations.ts` |
| 数据模型 | `src/server/db/schema.ts`、migration 26–37 |
| API | `src/pages/api/eval/` |
| 平台内评估工作区 | `src/components/project/ProjectEvaluationWorkspace.tsx` |

## 不变量

- `traceId` 只是证据引用；评估对象是 root task 子树和可选 chain。
- snapshot hash 不包含评估生命周期 proof，避免重放改变自身输入。
- hard gate 的 `fail/unknown` 独立展示；失败门禁会封顶总分。
- 缺证据返回 `unknown/not_applicable`，不使用空分母满分。
- evaluator bundle v2 将工具执行成功率与离线 `expected_labels.toolCalls` 的名称/必需参数匹配分开；没有离线预期时不声称工具调用正确。
- 隐藏推理不进入快照；文本再次经过凭据脱敏和长度限制。
- gap 只能生成 proposal；评估代码不直接修改 RoleCard、Skill 或协作策略。
- 当前平台没有权限管理；评估只做 conversation/project 归属隔离并记录固定平台操作者，不自建 RBAC。
- 全局数据集的 case 可跨项目读取，但 annotation 与一致性统计按 conversation 隔离；审核者名称仅用于校准审计。
- 公开 API 的自填审核者名称标记为未验证，不能通过正式校准门；等待平台统一身份事实源。
- pairwise 响应使用 opaque subject token，不暴露 run id；位置不一致需人工裁决后才形成 `resolved_winner`。
- 但当前没有可验证审核者身份，同一操作者仍可能通过相邻接口解盲；因此公开 pairwise API 暂时返回 `pairwise_blind_integrity_unavailable`，内部算法仅用于开发验证。
- 在线失败晋升创建新 dataset revision，旧 revision 保持不可变，晋升 case 内嵌脱敏冻结证据。
- 平台 runner 已按现有 Harness/Daemon 的评估执行模式接通：服务端从 held-out case 创建 baseline/candidate 执行，使用指定 commit 的 detached worktree 与独立 session；只有 target/observed manifest、invocation、trace 和 EvalRun 均绑定时才写 `execution_verified=1`。
- 真实双人身份与盲审隔离仍未接通，因此 verified 实验可以形成统计结果，但 proposal 审批/apply 仍需每例完成一致或人工裁决的 pairwise 结论；公开 pairwise API 继续 fail-closed。
- 线上失败只有经人工复核后才能进入 train/tune，不能直接进入 held-out。

## 运维

- `/api/eval/operations?conversationId=...` 返回 run/job/Judge token、延迟和解析失败摘要。
- 运维响应同时给出 queue-inclusive run P95（目标 120 秒）、活跃 worker/并发饱和度，以及当日 Judge token 的已用、预留与剩余额度；超限形成稳定 alert code。
- `POST /api/eval/operations` 配合 `action=enforce_retention` 按项目 retention policy 清理旧 run 和孤立快照。
- 恢复演练通过 SQLite backup 后重开数据库、重放 migration、校验数据与外键；工作区用 axe 做自动可访问性扫描。
- 默认 Judge allowlist 为 OpenAI 与 Anthropic，且必须是显式选定、启用的 API Key 账号；不做跨 Provider 自动回退。
