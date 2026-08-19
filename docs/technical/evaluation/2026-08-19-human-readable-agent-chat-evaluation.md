# Human-readable Agent Chat Evaluation

- Change ID: `agent-chat-human-language-v1`
- Evaluation level: E
- Status: inconclusive
- Code/spec revision: baseline `64bf90e`; candidate `codex/human-readable-agent-chat`（提交前工作树）
- Evaluator/benchmark revision: `human-readable-chat-fixtures-v1`

## Why

真实交付 `conv-1787068887227-6076d2e31d87d` 中，Agent 已完成工作并写入最终消息，但用户仍看到持续跳动的空白气泡；同时最终正文混入 Gate、rev、grep、平台接纳、P0/P1/P2 等内部汇报语言。后端事实显示最新调用 `inv-0001787097781164-046127-faf7b015` 已于 `2026-08-19T00:03:28.777Z` 正常结束，最终正文也已持久化，证明空白气泡不是 Agent 仍在执行，而是浏览器临时投影没有正确收尾。

## What changed

- 增加所有角色共用、不可由角色人格覆盖的用户可见回复契约：第一行给结果，普通回复 1–5 句，必要说明最多三项，内部术语和工具流水进入 Trace/调试。
- 预设统筹、实现、质量和架构角色不再鼓励技术细节堆叠或角色表演；结构化输出格式仅约束工作产物，不约束聊天回执。
- 临时流式消息和重连恢复的运行状态改为按 Invocation 相关性收尾；同一 Agent 开始新 Invocation 时不会复用旧气泡，迟到的旧正文、工具、完成、警告、空闲或退出事件不会夺回或关闭新回复。
- Invocation 活动时保留最新聚合正文，避免把工具前落库的进度段误当结论；临时气泡为空时以持久化正文兜底，终态后展示完整持久化正文，工具记录与正文也不会互相吞掉。

回退方式：移除 `userVisibleResponseLayer` 注入并恢复旧角色卡；流式修复可独立回退，不改变服务端 Invocation 或消息事实。

## Industry evidence

研究范围为 [Clowder AI](https://github.com/zts212653/clowder-ai) 的真实提示词与消息呈现实现，检查日期 `2026-08-19`。可迁移原则是：角色身份负责人格，用户可见 turn 与内部调用上下文分离，活动用一句语义摘要并允许展开详细信息。没有复制其源码、品牌、角色资产或文案；本项目继续使用自身 ContextManager、Invocation 投影和 Trace 组件。

## Method

固定测试集：

1. 完成：实现和测试已通过，无用户动作。
2. 阻塞：缺一个外部权限。
3. 需要决定：两个范围方案会改变交付成本。
4. 评审未通过：存在一个可定位的回归。
5. 事件乱序：上一 Invocation 完成事件晚于下一 Invocation 首个事件。
6. 终态对账：空白或只有部分正文的临时气泡与同 Invocation 的完整持久化正文并存。
7. 迟到事件：旧 Invocation 或无关联编号的警告/退出到达新 Invocation。

确定性组件指标：回复契约在首次/后续/wakeup 上下文中恰好注入一次；角色格式不覆盖聊天契约；事件乱序不串泡；完整持久化正文不被空白或部分临时气泡隐藏。原始证据由相关 Vitest 用例和 `/api/state` 的 Invocation/Message 事实生成。

真实 Agent 质量指标计划为：首句是否直接回答、用户正文中的内部术语数、非用户要求下的工具/命令流水数、正文句数、唯一必要问题数。成功阈值为四个语义场景全部满足契约，且无事实遗漏。

## Baseline vs candidate

| 场景 | Baseline | Candidate component result | Live paired Agent result |
| --- | --- | --- | --- |
| 完成回复 | 真实样本包含“任务已收口、Gate、rev5、grep、P0/P1”等内部汇报 | 契约明确禁止并提供完成句式 | 未执行 |
| 阻塞/决定 | 旧规则只有笼统“最小问题” | 分开给出阻塞和决定白话句式，只允许一个必要问题 | 未执行 |
| 相邻 Invocation | 临时消息以 Agent 为主键，旧完成事件可误关新回复 | 新调用先关闭旧投影，完成事件校验 Invocation | Vitest 通过 |
| 持久化终态 | 空临时气泡可遮住最终正文 | 空临时气泡让位于持久化正文 | Vitest 通过 |

组件结论不能冒充 Agent 任务质量。本轮没有向用户正在运行的真实交付注入合成测试消息，因此尚无 baseline/candidate ApplicationSnapshot 的真实模型 paired output。

## Decision

保留确定性的流式投影修复。用户可见回复契约作为受测产品规则保留，但“Agent 实际回复质量已经提升”的 E 级结论仍为证据不足；下一次干净的真实任务应按上述四个语义场景建立 baseline/candidate ApplicationSnapshot paired experiment。若出现事实被过度压缩、必要技术细节丢失或角色无法完成结构化 outcome，则回退提示词层，不回退流式修复。
