# Checklist

- [x] `applied` Task Graph Outcome 不依赖稍后可能死信的首次业务提交。
- [x] malformed proposal 不消费 WorkContract 唯一退出槽。
- [x] 所有暴露 proposal 工具的 contract 冻结并向 MCP 注入 Task Graph revision，owner 再次校验冻结值。
- [x] proposal 可以给已有 ready/proposed WorkItem 绑定 Project Agent。
- [x] proposal 不能重写 in-progress、review、blocked 或 terminal Task。
- [x] standalone ready Task 在 proposal receipt 返回前已经进入 AgentInbox。
- [x] durable proposal replay 幂等且只承担历史恢复，包括缺 authority/result 的 v1 数据。
- [x] standalone continuation accepted 后存在下一 epoch 的 durable Inbox command，并保留 stage、subject 与 Possession。
- [x] standalone continuation 预算耗尽时在 admission 前拒绝。
- [x] Delivery continuation 与 Task ownership 行为无回归。
- [x] MCP 生命周期工具提供字段级 Schema 与错误定位。
- [x] 规格、长期设计、测试、类型检查与构建证据一致：ESLint、TypeScript、269 个测试文件（1941 passed / 2 skipped）与 desktop service build 通过；三轮独立审查最终无 Critical/Important。
