# 验收清单 — 上下文管理器

## P1 — 统一组装 + 作用域
- [ ] `ContextManager.assembleContext()` 存在，内部复用 `BudgetGuard`，返回完整 `AssembledContext`
- [x] 主循环与 harness 直接调用 ContextManager；`PromptComposer` 兼容包装经零调用/零公共导出审计后删除
- [ ] `project` 含 `id`；`projectLayer` 展示 id
- [ ] history / taskContext / teamPack 按 `project_id` 过滤
- [ ] `scopeGuard` 组装前按 project_id、scope、private 和接收者执行可见性过滤
- [x] 仍有效的 role/team/collaboration/user-message/behavior layer 行为测试已迁入同目录测试；ContextManager / scopeGuard / 过滤单测绿
- [x] build 通过（2026-07-22 复验）

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

## P4 — Team Log Projection

- [x] message/proof 可稳定推导 TeamLogEntry，audience/category/task/chain 字段正确
- [x] `.ath/team-log.md` 可从 DB 重建，hot ≤50 且 ≤24h，warm 按日分桶并只保留 7 天文件
- [x] envelope 仅包含可见未消费条目、最多 5 条且 ≤150 token；handoff/wakeup 按 task 过滤
- [x] agent 完成后只消费到本轮 `upToEntryId`，执行期间新增消息不会被误消费
- [x] historyLayer 只包含 agent 自身历史，用户本轮输入与 A2A packet 不丢失
- [x] active workdir 在 dispatch 前具备 `.ath/team-log.md`，文件丢失后可重建
- [x] migration、repository、ContextManager、Harness/daemon、全量测试及 build 通过

## P5 — Team Harness Context Snapshot

- [x] 调用方仍只通过 `ContextManager.assembleContext()` 组装上下文
- [x] 新模块可通过 `ContextContributor` 注入 fragment，无需修改 ContextManager 主流程
- [x] Fragment 在 Registry 边界统一归一化为六维 `ContextArtifact`
- [x] 现有 Tier 与 Memory 来源也进入统一 fragment 选择和 Snapshot 管线
- [x] project/global scope、agent/role/team visibility 与 freshness 被机械过滤
- [x] 重复 fragment 只保留确定性的最新版本，并报告被替换项
- [x] Contributor 同步/异步失败被隔离并可观察，不吞掉其他上下文或泄露原始错误
- [x] Snapshot 能区分实际加载、预算裁剪、策略省略、过期、越域和必需上下文缺失
- [x] 必需上下文被场景或预算裁掉时 fail closed
- [x] planning/execution/review/verification/recovery/escalation 等场景可显式选择
- [x] Harness plan 可携带本轮 ContextSnapshot
- [x] 新增 ContextManager seam 测试、相关回归测试与类型检查通过
- [x] 无 `conversationId` 的历史消息与跨项目消息均 fail closed
- [x] required Contributor 未注册、返回空结果或伪造 producer 时均 fail closed
- [x] assembly snapshot 哈希包含 kind/semantic，Daemon 生成覆盖最终 Runtime 输入的 runtime snapshot
- [x] OpenCode system context 仅通过 instructions 投递一次
