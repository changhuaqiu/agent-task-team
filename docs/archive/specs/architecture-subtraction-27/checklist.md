# Acceptance Checklist

- [x] `submitSocketTerminalStart()` 不查询 DeliveryRun、不提前返回 policy outcome。
- [x] `legacy_proposal.suppressed` 专属 Proof 生产写入不存在。
- [x] `legacyProposal` 仍原样穿过 browser/mutation/Inbox/Scheduler/Planner。
- [x] Planner 仍以持久化 DeliveryRun 拒绝自主项目的旧 proposal。
- [x] 真实 socket adapter → Coordinator → Planner 测试证明 Runtime 不执行。
- [x] 普通非自主项目 proposal 行为保持。
- [x] 架构守卫、文档、TypeScript、定向测试和构建通过；全量测试已执行，并精确记录 1 个既有基线失败。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
