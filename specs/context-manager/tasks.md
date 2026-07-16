# 实施任务拆解 — 上下文管理器

> P1 非破坏先行，P2 迁移 A2A + 身份。每项完成同步 `docs/wiki/01-architecture.md` 上下文章节。
> 域：后端 / TDD（Toad 主责）；前端基本不沾。

## P1 — 统一组装核心 + 项目作用域
- [ ] T1 [schema 排查·只读] 检查 `src/server/db/migrate.ts` 的 `agents` / `agent_binding` / `conversation` 表，确认侦察标记的 ~2 个身份/作用域占位列；记录列名与现状，给出启用 / 替换 / 新增决策。**此任务只读不改**
- [ ] T2 完成 `ContextManager.assembleContext()`：内部复用 `BudgetGuard`，按 system/tool/project + importance 组装并返回 `{ systemPrompt?, userPrompt, report, sessionId }`
- [ ] T3 `PromptComposer.composeUserPrompt` 改为委托 `ContextManager`（保持返回 `string`，调用方不破；既有 PromptComposer 测试须全绿）
- [ ] T4 `project` 升级为 `{ id, name, path }`；`projectLayer` 增加 id 展示
- [ ] T5 history / taskContext / teamPack 层按 `project_id` 过滤；`scopeGuard.ts` 按 scope/private/接收者过滤并拒绝跨项目 source
- [ ] T6 P1 测试：ContextManager / scopeGuard / 各层 project_id 过滤单测；PromptComposer 既有测试不破；build 通过

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
