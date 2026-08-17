# 实施任务拆解 — 上下文管理器

> P1 非破坏先行，P2 迁移 A2A + 身份。每项完成同步 `docs/wiki/01-architecture.md` 上下文章节。
> 域：后端 / TDD（Toad 主责）；前端基本不沾。

## P1 — 统一组装核心 + 项目作用域
- [ ] T1 [schema 排查·只读] 检查 `src/server/db/migrate.ts` 的 `agents` / `agent_binding` / `conversation` 表，确认侦察标记的 ~2 个身份/作用域占位列；记录列名与现状，给出启用 / 替换 / 新增决策。**此任务只读不改**
- [ ] T2 完成 `ContextManager.assembleContext()`：内部复用 `BudgetGuard`，按 system/tool/project + importance 组装并返回 `{ systemPrompt?, userPrompt, report, sessionId }`
- [x] T3 主循环统一委托 `ContextManager`；迁移期 `PromptComposer` 包装在生产代码与公共导出零调用后删除（2026-07-22），有效 layer 行为测试迁入同目录测试文件
- [ ] T4 `project` 升级为 `{ id, name, path }`；`projectLayer` 增加 id 展示
- [x] T5 仓储查询与 ContextManager intake 按 `project_id` 失败关闭；P5 Context Registry 按 project/global scope 与 agent/role/team visibility 过滤。未接线的 `scopeGuard.ts` 在 Round 16 删除
- [x] T6 P1 测试：ContextManager intake / Context Registry / 各层 project_id 过滤与独立 layer 单测通过；build 通过（Round 16 复验）

## P2 — A2A 协议化 + 跨项目身份
- [ ] T7 `a2a/context-builder.ts`：`renderDispatchPrompt` 退役；改为构造 `a2aHandoff` source（含交接包 + `remainingBudget` 元数据）
- [ ] T8 `daemon.ts` A2A 派发点改调 `ContextManager`（`triggerSource=a2a_handoff`）
- [ ] T9 A2A 等价性测试：降级后 prompt 覆盖降级前关键段（指令 / 约束 / 相关任务 / 编辑互斥 / 增量消息）
- [ ] T10 跨项目身份契约：`IdentitySnapshot`（全局只读）与 `ScopedContext`（per project）类型；组装时只读身份、不写回（先写测试：身份段跨项目一致、项目段隔离）
- [ ] T11 按 T1 决策迁移占位列（启用 / 替换 / 新增），写迁移脚本 + 回滚
- [ ] T12 P2 测试：跨项目 history/task 不串话；同 agent 多项目身份段一致；A2A 派发走 ContextManager；build 通过

## 收尾
- [ ] T13 `specs/README.md` 状态由草案推进到有效（实现完成后）
- [ ] T14 `docs/wiki/01-architecture.md` 上下文章节同步（ContextManager / 作用域 / 身份 / A2A 协议化）

## P3 — 场景化注入策略 MVP

- [x] T15 实现场景解析、角色原型映射、完整策略矩阵与协议提示段
- [x] T16 `ContextManager` 按信息簇执行 include/omit，并在 report 暴露 scenario、archetype 与簇决策
- [x] T17 TaskWakeup、harness plan、terminal payload 透传 wakeup metadata 与已解析 scenario
- [x] T18 autonomy guard 读取 task graph，发现完整终态子树并通过 control proof event 持久去重后唤醒 planner
- [x] T19 daemon 在完整输出聚合后记录 `no_valid_exit`；A2A orchestrator 对缺失 action 记录 `missing_action`，两者均不阻断
- [x] T20 完成策略、场景边界、closure、持久幂等、A2A audit 与主循环回归测试，并同步长期技术文档

## P4 — Team Log Projection

- [x] T21 新增 `agent_log_cursor` migration/schema/repository，并支持 message/proof 混合源二元游标
- [x] T22 实现 TeamLogEntry 推导、audience/category、hot/warm/cold 物化和只读文件格式
- [x] T23 message/proof append 接入投影；daemon 注册真实 workdir、完成后按 envelope 快照更新游标
- [x] T24 ContextManager 注入 ≤150 token envelope，handoff/wakeup 按 task 过滤，history 退化为 self-only
- [x] T25 覆盖分类、可见性、游标、归档、文件重建、场景注入与回归测试，更新长期架构文档

## P5 — Team Harness Context Snapshot

- [x] T26 定义 ContextFragment / ContextArtifact / ContextQuery / ContextSnapshot / ContextContributor 契约
- [x] T27 在 ContextManager 内实现 Contributor Registry、失败隔离、去重、作用域、可见性与 freshness 选择
- [x] T28 将现有 Tier 输出和业务 Contributor 接入统一 Fragment → Artifact 管线，不新增平行 Prompt 出口；只有 NoOp 实现的 MemoryHook 在 Round 24 删除
- [x] T29 收敛 Agent 输出契约：禁止身份/计划/工具复述，WorkContract 只经结构化 outcome 推进；角色特定层只补岗位差异，不重复跨角色行为规则
- [x] T29 扩展完整 Team Harness 场景，并保留 init/iterate/wakeup 兼容解析
- [x] T30 AssembledContext、ContextReport 与 Harness plan 暴露 snapshot id、fragment refs、omission 和 missing-required
- [x] T31 通过 ContextManager 外部 seam 覆盖跨项目、私有、角色、过期、重复、Contributor 失败和预算裁剪测试
- [x] T32 BudgetGuard 落实 required floor，防止可选上下文挤掉 required Project Context
