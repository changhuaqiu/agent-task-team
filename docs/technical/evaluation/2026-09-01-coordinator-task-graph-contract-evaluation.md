# Coordinator Task Graph Contract Evaluation

- Change ID: `coordinator-task-graph-contract-2026-09-01`
- Evaluation level: C (Comparison)
- Status: measured, candidate component gate accepted
- Code/spec revision: `codex/mario-coordination-contract`, baseline `main@7f04164`
- Evaluator/benchmark revision: Vitest 4.1.5; deterministic contract fixture 2026-09-01

## Why

基线中马里奥的 Agent Definition 只有一句“拆解、协调”说明，旧数据不会随默认配置升级。更关键的是，Coordinator 的 planning WorkContract 同时允许 `propose_task_graph` 和直接 `handoff_to_agent`，验收条件只要求任意结构化计划、分配或转交。于是 Agent 可以跳过 Task Graph，未分配根 Task 仍留在 `ready`，平台无法基于 owner 和依赖自动调度，也无法判断“统筹完成”是否真实发生。

## What changed

- planning admission 遇到 Coordinator 和未分配 `proposed/ready` Task 时，WorkContract 冻结 `task_graph_first` 协调义务及完整 Task ID 列表。
- 该契约移除直接 handoff 出口，保留 bounded continuation、Task Graph proposal、结构化 blocker 和必要人工决策。
- Task Graph Outcome owner 在任何持久化前验证 proposal 覆盖全部冻结 Task；遗漏时原子拒绝。
- accepted proposal 继续复用现有 Task Graph owner 与 Collaboration Kernel，原子提交后自动派发依赖已满足的 owner。
- 冻结的 assigned `proposed` Task 在同一提交事务中晋升为 `ready`；Coordinator outcome recovery 继续冻结剩余未分配 Task，不恢复 direct handoff。
- 默认 Agent/TeamPack 文案明确拆解、分配、追踪和收口职责；migration 112 只升级空值或旧默认值，保留用户自定义 instructions。

回退该提交即可恢复旧行为。migration 的 instructions 更新可由用户编辑覆盖，不涉及 Task 或 Artifact 数据迁移。

## Industry evidence

本次没有新增外部行业事实主张。设计沿用本仓库已经确立的 Task Graph authority、structured outcome、scheduler owner 和 immutable WorkContract 边界；相关外部产品的 Project/Issue 分层证据记录在 `2026-08-31-project-workitem-path-evaluation.md`。本记录评估的是内部权限路径是否闭合，不用外部产品文案替代本地数据。

## Method

固定 fixture 在同一个 Project 中建立一个 `ready` 且未分配的根 Task，并以 responsibility=`coordinator` 发出 planning admission。

指标与阈值：

| Metric | Baseline | Candidate threshold |
| --- | ---: | ---: |
| 未分配根 Task 被写入冻结协调义务 | 0/1 | 1/1 |
| 协调必需时允许直接 handoff | 1 | 0 |
| 遗漏冻结根 Task 的 proposal 被接受 | 1 | 0 |
| 正确 proposal 后根 Task 获得 owner | 不保证 | 1/1 |
| 正确 proposal 后 ready owner 获得 durable inbox dispatch | 不保证 | 1/1 |
| 冻结的 proposed 根/依赖 Task 晋升 ready | 不保证 | 2/2 |
| Coordinator outcome recovery 暴露 direct handoff | 1 | 0 |
| 旧默认 Mario instructions 自动升级 | 0 | 1 |
| 自定义 Mario instructions 被覆盖 | 0 | 0 |

复现命令：

```powershell
pnpm exec vitest run src/server/work-contract/dispatch-contract.test.ts src/server/repositories/task-graph-outcome-process-manager.test.ts src/server/db/agentQueries.test.ts src/server/db/index.test.ts src/__tests__/data/presetTeamPacks.test.ts
pnpm exec tsc --noEmit
```

## Baseline vs candidate

候选固定契约用例证明：冻结列表为 `['task-unassigned-root']`，allowed outcomes 不含 `handoff_to_agent`，每轮不可裁剪的 WorkContract instruction 明确 Task Graph、平台自动派发与 Coordinator 非实现边界。Outcome 集成用例先提交遗漏根 Task 的 proposal，得到 `task_graph_coordination_tasks_missing` 且 graph revision/inbox 均未变化；同一有效 authority 随后提交覆盖 proposed 根 Task 与 proposed 依赖 Task 的修正版，两者原子晋升为 `ready`，只有依赖已满足的根 Task 产生唯一 durable inbox dispatch。恢复用例证明 Coordinator outcome recovery 仍只暴露协调出口，不重新获得 `work_handoff`。迁移用例证明旧默认值升级为新契约，自定义值二次运行后保持不变。

初版目标测试为 5 files / 84 tests 全通过；独立审查随后发现 proposed Task 未晋升和 outcome recovery 重新暴露 handoff 两个 Important 问题，候选已修正。修正后相关路径 3 files / 39 tests 通过；全量回归为 271 files 通过、2 skipped，1986 tests 通过、2 skipped；TypeScript 全量检查、相关路径 lint 和 Next.js production build 通过。全路径 lint 仍只命中 `src/store/agentStore.ts` 三处既有 `no-explicit-any` 历史问题，本次修改行未新增 lint 错误。独立复审最终为 0 Critical / 0 Important，Ready to merge。

main 推送后完成 Tauri release 重建，Renderer/Service build identity 唯一为 `desktop-build-00f16f4d2c5c1947e84cb635d14b0c15`；EXE 中该标识只出现 1 次，SHA-256 为 `17BF481FADACCC8D109CDD29E365009C160C3FD0A6D919AE096B1E39DF8D956E`。

新 EXE 启动后，桌面真实数据库只读核验显示 schema version 为 112，既有 Mario 行的 responsibility 为 `coordinator`，instructions 已升级为 Task Graph-first 契约；桌面 Host PID 38720、release service PID 11832，服务从 `src-tauri/target/release/service/server.js` 启动并在随机 loopback 端口返回 HTTP 200。

## Decision

接受该候选进入全量回归和桌面验证。它关闭了可确定复现的“Coordinator 可以不落 Task Graph 就完成规划”路径，并把提示词要求落实为 owner authority 校验。

这是 C 级组件/路径结论，不声称马里奥在代表性真实任务上的完成率、拆解质量或平均路径长度已经提升。默认 instructions 与 TeamPack 文案属于配套兼容层，不作为独立 Prompt 候选宣称效果；若要得出 Agent 质量结论，必须冻结 TestSuiteRevision 和 baseline/candidate ApplicationSnapshot，至少覆盖单任务、并行拆解、依赖链、架构门禁、重规划与不可推断人工决策，并执行逐例 paired experiment。
