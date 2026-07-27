# Platform Harness 状态机验收清单

## 架构

- [x] Platform Harness 被定义为整个运行时环境，而不是 Boss Agent。
- [ ] 每个可变事实只有一个明确 owner。
- [ ] 不存在跨领域总状态表或裸 `completed` 协议。
- [x] Process Manager 不直接写领域表或启动 Agent Runtime。

## Agent 自主性

- [x] WorkContract 规定目标、验收、权限、权威版本与结果类型，不规定 Agent 内部步骤。
- [ ] Agent 内部 Todo 不会被自动解释为 Platform Task。
- [x] Agent 跨模块意图通过 invocation-scoped `agent_submit_outcome` 或完整信封 API 提交。
- [ ] 多个 Agent 的内部 Todo 不会被合并成平台级步骤清单。
- [ ] Agent 可以主动提出未预编排但合法的 A2A handoff。
- [x] WorkContract Agent 的 A2A 意图只能通过结构化 `handoff_to_agent` Outcome，
  最终回复中的 `@mention` 不会被解释成控制命令。

## 状态机

- [ ] Task、Inbox、Invocation、Context、A2A、Gate、Effect、Delivery 的状态互不冒充。
- [ ] 所有非法迁移均被 owner 拒绝。
- [x] `waiting_human` 可在配置/决策补齐后通过 Human Command 恢复。
- [ ] 同一事实/策略快照产生相同的有序 ControlAction 集和 action ids。
- [ ] 一个 Work Cell 正在运行时，剩余容量仍可激活其他合法 Work Cell。
- [x] 同一 work 的并发激活使用 WorkAuthority epoch CAS，迟到写入由 fencing 拒绝。
- [ ] wait-for deadlock 与 A2A 循环传球有检测和升级路径。
- [x] A2A 祖先循环与 hop budget 超限由聚合拒绝。
- [x] A2A Command Guard 统一校验 conversation roster 与 Agent communication policy；
  全局 Agent 存在不再等同于当前项目可交接。
- [x] 迟到 Outcome 因 epoch/token 失效而持久化 rejected 诊断，不修改领域事实。

Task 切片证据：

- [x] Task 的规范词汇、迁移表和 completion 语义已冻结。
- [x] Task 非法跳转、陈旧前态、SQL 非规范状态与 SQL 绕过迁移表均有拒绝测试。
- [x] Gate 的 `rejected/test_gate`、Attempt 的 `abandoned`、Task Graph 的 `merged_into`
  不再冒充 Task 状态。
- [x] Invocation 生命周期和 terminal outcome 已分离，终态 Invocation 不能通过重试复活。
- [x] Session binding 与 Invocation outcome 由不同 owner 独立提交，不再互相冒充完成。
- [x] Inbox `admitted` 只证明激活命令已被接纳，不再以 `completed` 冒充 Agent 执行成功。
- [x] Inbox claim 的释放、过期、取消和 admission 均受 lease token 与数据库迁移表保护。
- [x] Envelope `acknowledged` 只证明派发被目标确认；运行结果只来自 Invocation。
- [x] Envelope 终态后 Runtime 失败不会回写或改写派发事实。
- [x] Delivery 生命周期状态和 `current_stage` 已分离，终态不可复活。
- [x] `waiting_human` 不会被周期 reconcile 恢复，只接受显式 `manual_resume`。

## 错误与恢复

- [x] `runtime_profile_missing` 归一为 Invocation preflight blocked，不冒充 Agent 执行失败。
- [x] Process Manager 对该阻塞执行 Human escalation，补配置后 resume，不做盲重试。
- [ ] ACP session 丢失会失效旧 binding，并按策略新建 session。
- [x] transport 降级与 Invocation 终止分离。
- [x] `required_context_missing` 返回结构化缺失项并发布 `context.snapshot.rejected`。
- [x] CLI 原始错误只作为 `runtime.diagnostic.observed` evidence，不直接驱动领域迁移。

## 集成

- [x] ControlDecision 非 wait 动作持久化；claim 校验项目 snapshot cursor、workEpoch、
  slot reservation 和 lease token。
- [x] 同一 decision 的动作集在首条 owner Command 前原子 batch claim，不退化为单动作循环。
- [x] 持久 ControlAction 已接入各领域 owner Command；activate/retry 均持有 slot，并由
  Runtime 生命周期或启动前阻塞事实释放。
- [x] activate/retry 已接 AgentInbox、requestGate 已接 QualityGate、terminate 已做事务内
  Closure 复核；Runtime 生命周期事实可释放 slot reservation。
- [x] production bootstrap 已完全切换到新 Control Process Manager。
- [x] Human 可以通过 WebUI 发送 `manual_resume` Command；WebUI 不自行推进状态。
- [x] Human A2A 从 WebUI 提交服务端 Command，浏览器不直接启动后再补登记协作状态。
- [x] WebUI 自动更新只消费版本化 `project:view / a2a.snapshot` Projection；
  多分支 holder 使用 `currentHolderIds[]`，浏览器不从投影反向派发。
- [ ] 领域事实与 Event Outbox 原子提交。
- [ ] 外部 I/O 经过 Durable Effect Outbox。
- [x] blocking Effect 从 appliesFromRevision 持续适用，只有 succeeded 或显式
  cancelled/superseded 才退出收口检查；dead-letter 仍阻塞并升级给人。
- [ ] correlationId、causationId、idempotencyKey 全链路保留。

## 清理

- [x] 旧 Harness 命名及目录已在所有调用者迁移后删除。
- [x] 重复 A2A 状态机已移除；旧 Orchestrator、scanner、Worklist/Cursor 与五张历史表均已退役。
- [x] 重复 Gate 判定源已移除；Task/Git/Delivery 均由 QualityGate owner 判定。
- [x] A2A 兼容分支、旧 Delivery Action/Attempt 栈与无读者文件均已有删除证据。
- [ ] 设计、spec、代码和测试一致。

## 端到端场景

- [ ] 项目启动只创建一个 DeliveryRun，Lead 提交的合法 Task Graph 原子可见。
- [ ] 两个 Agent 可并行执行独立 Work Cell，冲突写不会静默覆盖。
- [ ] Agent 可主动交接，接球者获得可追溯的新 ContextSnapshot。
- [x] Gate 绑定具体 artifact/evidence revision，旧 revision 的通过不能授权新产物。
- [ ] profile、context、session、transport、process、semantic 六类故障走不同恢复路径。
- [x] Task dependency 的跨 Work Cell wait-for cycle 可检测并升级给人，不盲目重试 Agent。
- [ ] Human 从 WebUI 补齐条件后能恢复原 work correlation。
- [ ] Delivery 只有在 Task、Gate、active work 和 blocking effect 全部满足条件后才完成。
