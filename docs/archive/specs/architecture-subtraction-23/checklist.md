# Acceptance Checklist

- [x] Tier 内容直接以原生 Fragment 进入 Registry。
- [x] prompt 内容顺序、scenario omission、required 与预算相对顺序保持。
- [x] Registry 无 `legacy.*` kind 或专属 owner 映射。
- [x] BudgetGuard 与 ContextReport 无 `priority/p0Intact` 兼容。
- [x] SkillSummary 无未消费 `files` 字段。
- [x] 外部 Contributor、Snapshot 与 runtime transport 契约不变。
- [x] 架构守卫阻止旧适配器与 priority 回流。
- [x] 文档、TypeScript、定向测试、构建与全量测试已记录。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
