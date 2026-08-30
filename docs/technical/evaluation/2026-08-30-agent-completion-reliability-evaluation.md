# Agent Completion Reliability Evaluation

- Change ID: agent-completion-reliability-2026-08-30
- Evaluation level: C
- Status: candidate verified at component/path level
- Code/spec revision: baseline `778b1c6`; candidate implementation `dde652c`
- Evaluator revision: deterministic-v3 baseline; deterministic-v4 candidate

## Why

真实桌面数据库显示 Task `done` 门禁可信，但失败路径不能稳定收敛。若只报告 Task done 比例，
会把“仍在运行”“失败已结算”和“永久卡死”混为同一类未完成，无法定位 Agent 可完成性的真实瓶颈。

## Baseline

采样时间：2026-08-30，桌面数据目录 `local.agenttaskhub.desktop/data.db`。

- Task：4；done 2，in_progress 2。
- 两个 done Task 均存在当前 revision 的 passed Gate；无伪完成。
- Invocation：18 completed、27 failed、2 cancelled、1 starting 且租约已过期。
- active WorkAuthority：22；其中 20 个对应终态 A2A Pass，2 个对应长期 in_progress Task。
- AgentOutcome：25 accepted、11 rejected。
- Platform event delivery：15076 succeeded、14 dead_letter、2 个退役 handler 的 queued。
- Delivery run 0、Project release 0；无法据此评价完整发布路径成功率。

以上是小样本运行事实，不是代表性任务成功率。

## Metrics

| Metric | Definition | Candidate threshold |
| --- | --- | --- |
| Task completion | `done / frozen tasks`，同时列出 blocked/cancelled/active | 不因修复伪增；正常完成 fixture 为 100% |
| Terminal convergence | 已终态 owner/attempt 中 Authority closed 且 Invocation terminal 的比例 | 固定场景 100% |
| Outcome acceptance | `accepted outcomes / all outcomes` | 分开显示，不以重试隐藏 rejected |
| Attempt reliability | completed Invocation / all Invocation | 保留失败原因分布 |
| Handoff settlement | terminal Pass 不保留 active Authority | 固定场景 100% |

## Method

1. 用固定 SQLite fixture 构造正常完成、Runtime 租约过期、Runtime 启动失败、A2A 完成与失败。
2. baseline 以当前实现的确定性查询和真实桌面只读数据记录。
3. candidate 运行相同 fixture，重复执行启动恢复验证幂等。
4. 运行相关集成测试、全量测试、TypeScript 与生产构建。
5. 不将组件指标表述为真实 Agent 成功率提升；E 级结论必须另跑固定 TestSuiteRevision 的成对实验。

## Candidate result

固定回归场景验证：

- 过期 Invocation 被记为 `terminated/failed`，当前 Authority 关闭，Task 仍是 `in_progress`；重复恢复不再产生变更。
- `runtime_start_failed` 终态事件关闭当前 Attempt 的 Authority，不把失败伪装成 Task 完成。
- terminal A2A Pass 和 terminal Task 均关闭所属 Authority，Task 终态不误关 Delivery-scoped Work。
- Deterministic evaluator 可分辨“失败已结算”与“失败仍占有 active Authority”；后者 `path_convergence=fail`。

在真实桌面数据库的 SQLite 一致备份上，使用同一 candidate 执行 migration 111、启动恢复和 handler 世代回收：

| Fact | Baseline | Candidate |
| --- | ---: | ---: |
| Task done / total | 2 / 4 | 2 / 4 |
| terminal Task 缺 `completed_at` | 2 | 0 |
| expired nonterminal Invocation | 1 | 0 |
| active WorkAuthority | 22 | 0 |
| terminal A2A active Authority | 20 | 0 |
| failed/expired current Attempt active Authority | 10 | 0 |
| retired handler queued/running delivery | 2 | 0 |

恢复报告为 `staleInvocationsTerminated=1`、`authoritiesClosed=22`；数据库 `integrity_check=ok`、`foreign_key_check=[]`。Task 完成数没有伪增；Invocation completed 仍是 18/48，AgentOutcome 历史接纳率仍是 25/36，说明本轮修复的是“失败能结算、能重试”，不是将失败数据改写成成功。

验证门：定向 152 项场景通过；全量 1981 项通过、2 项跳过；TypeScript、受影响文件 ESLint 与 Next.js 生产构建通过。全仓 ESLint 仍有 210 个本轮之前就存在的错误，不作为本轮改进结论。

## Decision

通过 C 级组件/路径可靠性门：候选实现在固定场景和真实数据副本上将可自动判定的未收敛路径降为 0，且未修改 Task 结果事实。不通过 E 级任务完成率结论：后续必须在固定 TestSuiteRevision 上运行 baseline/candidate ApplicationSnapshot 成对实验。
