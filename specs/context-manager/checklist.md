# 验收清单 — 上下文管理器

## P1 — 统一组装 + 作用域
- [ ] `ContextManager.assembleContext()` 存在，内部复用 `BudgetGuard`，返回完整 `AssembledContext`
- [ ] `PromptComposer.composeUserPrompt` 委托 ContextManager，仍返回 `string`（调用方不破）
- [ ] `project` 含 `id`；`projectLayer` 展示 id
- [ ] history / taskContext / teamPack 按 `project_id` 过滤
- [ ] `scopeGuard` 组装前按 project_id、scope、private 和接收者执行可见性过滤
- [ ] PromptComposer 既有测试全绿；新增 scopeGuard / 过滤单测绿
- [ ] build 通过

## P2 — A2A 协议化 + 身份
- [ ] `renderDispatchPrompt` 自建 prompt 已退役（不再被调用）
- [ ] A2A 派发经 `ContextManager`（triggerSource=a2a_handoff + a2aHandoff source）
- [ ] A2A 派发与主循环共享同一 `ContextBudget` 与层优先级
- [ ] 降级后 prompt 覆盖降级前关键段（指令 / 约束 / 相关任务 / 编辑互斥 / 增量消息）
- [ ] `IdentitySnapshot`（全局只读）与 `ScopedContext`（per project）类型落地
- [ ] 组装时只读身份、不写回；身份段跨项目一致
- [ ] T1 标记的占位列已决策并迁移（含回滚脚本）

## 跨项目隔离（核心验收）
- [ ] agent 在项目 A 的 history 不出现在项目 B 的 prompt
- [ ] agent 在项目 A 的 task 不出现在项目 B 的 prompt
- [ ] 同一 agent（如 mario）在 N 个项目，身份段一致、项目段隔离

## 不破坏
- [ ] `a2a-possession-contract/` 持球 / 交接 / 反回声语义不变
- [ ] `BudgetGuard` 使用 system/tool/project + importance；旧 priority 仅保留兼容，不再驱动新记录
- [ ] `acp-runtime-integration/` 的执行协议边界不受影响
- [ ] build 通过；现有 A2A / context 测试不破

## 文档
- [ ] `specs/README.md` 状态更新
- [ ] `docs/wiki/01-architecture.md` 上下文章节同步（ContextManager / 作用域 / 身份 / A2A 协议化）

## P3 — 场景化注入策略 MVP

- [x] 首次 handoff、首次系统 wakeup、closure resume、普通 resume、init 与 iterate 均按固定优先级正确识别
- [x] `5 scenario × 3 archetype × 6 cluster` 策略完整且 ContextReport 可观测 include/omit
- [x] handoff/wakeup/closure 协议提示段正确，init/iterate 不追加特殊提示
- [x] workflow/review/test/system wakeup 不再因无 active session 被误判为 user turn
- [x] closure 仅在根未终态、后代非空且全部终态时触发；partial 元数据正确；跨 tick 一次且仅一次
- [x] `no_valid_exit` 与 `chain_closure_dispatched` 写 control proof log；`missing_action` 写 A2A audit log；均不阻断原流程
- [x] 现有 context、harness、autonomy guard、A2A 测试通过，build 通过
