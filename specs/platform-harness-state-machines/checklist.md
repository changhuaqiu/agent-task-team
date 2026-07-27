# Platform Harness 状态机验收清单

## 架构

- [ ] Platform Harness 被定义为整个运行时环境，而不是 Boss Agent。
- [ ] 每个可变事实只有一个明确 owner。
- [ ] 不存在跨领域总状态表或裸 `completed` 协议。
- [ ] Process Manager 不直接写领域表或启动 Agent Runtime。

## Agent 自主性

- [ ] WorkContract 规定边界而非内部步骤。
- [ ] Agent 内部 Todo 不会被自动解释为 Platform Task。
- [ ] Agent 跨模块意图通过结构化 Outcome 提交。
- [ ] 多个 Agent 的内部 Todo 不会被合并成平台级步骤清单。
- [ ] Agent 可以主动提出未预编排但合法的 A2A handoff。

## 状态机

- [ ] Task、Inbox、Invocation、Context、A2A、Gate、Effect、Delivery 的状态互不冒充。
- [ ] 所有非法迁移均被 owner 拒绝。
- [ ] `waiting_human` 可在配置/决策补齐后恢复。
- [ ] 同一事实/策略快照产生相同的有序 ControlAction 集和 action ids。
- [ ] 一个 Work Cell 正在运行时，剩余容量仍可激活其他合法 Work Cell。
- [ ] 并发 Work Cell 通过 owner version、lease 或 fencing 解决冲突。
- [ ] wait-for deadlock 与 A2A 循环传球有检测和升级路径。
- [ ] 迟到 Outcome 因 epoch/token 失效而只记录诊断。

Task 切片证据：

- [x] Task 的规范词汇、迁移表和 completion 语义已冻结。
- [x] Task 非法跳转、陈旧前态、SQL 非规范状态与 SQL 绕过迁移表均有拒绝测试。
- [x] Gate 的 `rejected/test_gate`、Attempt 的 `abandoned`、Task Graph 的 `merged_into`
  不再冒充 Task 状态。

## 错误与恢复

- [ ] `runtime_profile_missing` 阻塞并请求 Human，不做盲重试。
- [ ] ACP session 丢失会失效旧 binding，并按策略新建 session。
- [ ] transport 降级与 Invocation 终止分离。
- [ ] `required_context_missing` 返回结构化缺失项。
- [ ] CLI 原始错误只作为 evidence，不直接驱动领域迁移。

## 集成

- [ ] Human 可以通过 WebUI 发送 Command。
- [ ] WebUI 自动更新仍只消费 Projection。
- [ ] 领域事实与 Event Outbox 原子提交。
- [ ] 外部 I/O 经过 Durable Effect Outbox。
- [ ] blocking Effect 从 appliesFromRevision 持续适用，只有显式 cancelled/superseded 才退出收口检查。
- [ ] correlationId、causationId、idempotencyKey 全链路保留。

## 清理

- [ ] 旧 Harness 命名已无调用者后再删除。
- [ ] 重复 A2A / Gate 状态机已移除。
- [ ] 兼容分支、死代码和无读者文件已有清理证据。
- [ ] 设计、spec、代码和测试一致。

## 端到端场景

- [ ] 项目启动只创建一个 DeliveryRun，Lead 提交的合法 Task Graph 原子可见。
- [ ] 两个 Agent 可并行执行独立 Work Cell，冲突写不会静默覆盖。
- [ ] Agent 可主动交接，接球者获得可追溯的新 ContextSnapshot。
- [ ] Gate 绑定具体 evidence revision，返工与 Invocation retry 分离。
- [ ] profile、context、session、transport、process、semantic 六类故障走不同恢复路径。
- [ ] Human 从 WebUI 补齐条件后能恢复原 work correlation。
- [ ] Delivery 只有在 Task、Gate、active work 和 blocking effect 全部满足条件后才完成。
