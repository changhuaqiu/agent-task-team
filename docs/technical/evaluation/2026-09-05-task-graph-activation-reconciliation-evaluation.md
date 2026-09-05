# Task Graph Activation Reconciliation Evaluation

- Change ID: task-graph-activation-reconciliation-2026-09-05
- Evaluation level: C
- Status: accepted
- Code/spec revision: implementation `aa20879`, evidence `53ff3ef`, desktop build `desktop-build-2f3fa565f236254212a139d63d9eff51`
- Evaluator/benchmark revision: Vitest 4.1.5, live desktop DB observed 2026-09-05

## Why

真实桌面任务“优化项目结构及UX”的 Coordinator Outcome 已被接纳，Task Graph handler 也记录为 succeeded，但新增且已分配的下游 Task 仍为 `proposed`。调度器只扫描 `ready`，所以第一项完成后没有派发任何后续 Agent。Project UI 同时只显示状态图标和 A2A“已确认接纳”，用户无法区分回执成功、任务激活和真实执行。

## What changed

候选设计把 accepted Coordinator graph 的“执行资格”和“依赖可运行性”拆开：已分配 Task 全部激活为 `ready`，依赖仅决定何时派发。Task Graph Outcome owner 同时负责历史重放恢复，只修复仍由对应 accepted Outcome 最新拥有的 assigned/proposed Task。WorkItem 详情展示文字状态、依赖阻塞和不一致告警。

## Industry evidence

- Kubernetes Controllers（访问于 2026-09-05）将控制器定义为持续比较期望状态与当前状态并使其靠拢的控制循环；本变更采用“accepted graph 是期望状态、Task 是观测状态”的幂等对账方式，而不是把 handler 单次成功当成业务完成。
- Multica Runs 与 Daemon 文档（访问于 2026-09-05）分离 Issue 状态与每次 Run，并使用队列认领、心跳/轮询作为恢复后盾；本项目对应分离 Task 资格、依赖调度、Invocation 与回执，不将 Run/ACK 成功冒充 Task 完成。
- Temporal 文档（访问于 2026-09-05）强调持久状态、执行历史、任务队列和失败后恢复；本变更使用版本化 durable handler 重放已有 Outcome，并保留幂等身份。

不可直接照搬：本项目是本地桌面多 Agent 系统，Task Graph commit、WorkContract fencing、Gate 和 SQLite 事件投递已有独立事实源，不能引入另一套云队列或外部工作流状态机。

## Method

计划使用确定性集成测试和真实桌面数据库各一组证据：

1. 显式提交 children `initialStatus=proposed` 的 accepted coordinator graph；测量 accepted 后 ready 比例、依赖前误派发数、依赖完成后的唯一派发数。
2. 构造已有旧 commit 的历史 accepted Outcome；测量版本化重放后的安全激活数、重复重放新增 Inbox 数、后续重规划被误改数。
3. 在真实“优化项目结构及UX”WorkItem 上记录升级前后 Task 状态、Inbox/Invocation 和界面状态/依赖可见性。
4. 真实恢复若在 Agent lane 排队阶段触发 Autonomy Guard，记录同一 Task 的 pending Inbox 数，并验证候选把 pending Inbox 纳入 active-dispatch 判定。

## Baseline vs candidate

| Metric | Baseline | Candidate | Threshold |
| --- | ---: | ---: | ---: |
| accepted graph assigned Task ready ratio (deterministic fixture) | 2/3 | 3/3 | 100% |
| dispatch before dependency satisfaction | 0 | 0 | 0 |
| duplicate dispatch after identical handler replay | unknown | 0 | 0 |
| newer graph Tasks overwritten by old replay | unknown | 0 | 0 |
| WorkItem rows with textual status (UI fixture) | 0/4 | 4/4 | 100% |
| duplicate `owner_ready` dispatch while Inbox pending | 1 live occurrence | 0 in candidate regression | 0 |

真实 baseline 为一个 accepted graph：t1 已完成，而 t2–t6 共 5 个已分配节点仍为 `proposed`，没有下游 Inbox。候选 v3 handler 于 2026-09-05 07:01:49Z 将 5 个节点恢复为 `ready`；t2 与 t3 分别生成并接纳唯一 Outcome-owned Inbox，t4 在 DK lane 后排队，t5/t6 因依赖未完成未派发。t2 随后进入 `in_review` 并生成 reviewer Invocation，t3 的 DK Invocation 进入 running。

首轮真实运行在 t4 的 Outcome-owned Inbox 尚为 `enqueued` 时产生 1 个 `owner_ready` 重复项，证明旧 Autonomy Guard 的 active-dispatch 集合缺少 Inbox gap。该项已精确取消并记录 `duplicate_dispatch_reconciled`；候选新增 pending Inbox fixture 后为 0 次 wakeup。最终定向集合 5 files / 52 tests 通过；全量套件首次运行仅有一个与本变更无关的 Project Context 15 秒超时，单独重跑该文件 22/22 通过。TypeScript、相关 ESLint、Next.js production build 通过。

## Decision

接受候选。组件证据与真实旧任务共同证明 accepted→ready→dependency dispatch 路径恢复，历史重放具备 owner/fencing 保护，Project UI 能区分 Task、依赖和 A2A 回执；真实发现的 Inbox gap 重复派发也已进入同一修复与回归。若未来改变 Task Graph commit identity、Inbox pending 状态或 Autonomy Guard active-dispatch 定义，必须重跑本记录。

该 C 级结论不声称真实 Agent 任务完成率具有统计显著提升；这仍需要固定 TestSuiteRevision、baseline/candidate ApplicationSnapshot 与逐例 paired experiment。
