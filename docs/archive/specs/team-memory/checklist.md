# Team Memory 验收清单

- [x] Agent 可明确 `propose | defer | abstain`，静默不算完成判断。
- [x] `defer/abstain` 不持久化正文，`propose` 必须带来源。
- [x] 跨 Conversation、缺失或非法 source ref 被拒绝。
- [x] 只有 `accepted` 记忆进入团队召回。
- [x] `correction` 不自动接受，human/unknown relationship 在 materialization 前被拒绝。
- [x] Agent 私有记忆不会被其他 Agent 召回或替换。
- [x] FTS 索引可重建，retire/supersede 后读面消失。
- [x] ContextContributor 最多注入 5 条 memory cue 和 2 条 deferred opportunity。
- [x] 注入内容明确声明记忆是历史证据，不是指令。
- [x] 工程关系摘要只来自 A2A/Task/评审事实，不产生好感度或人格推断。
- [x] 记忆工具调用在 ACP 工具列表中真实可用并产生 proof。
- [x] 定向测试、全量测试、类型检查和构建通过。
