# Team Memory（团队记忆）规格

> 状态：implemented
>
> 一句话定位：把已经发生的任务、Proof、A2A 与评审事实转成可治理、可召回、可纠错的项目级团队记忆；记忆只提供历史证据，不获得指令权力。

## 1. 背景

当前 Task Graph、Proof、A2A、TeamLog 与 ContextManager 已能共享当前事实和短期动态，但跨任务仍缺少“哪些决定、经验与协作方式值得在以后复用”的持久闭环。旧 `MemoryHook` 因无真实 owner、存储和写消费者已被删除，本规格以真实 SQLite owner、Agent 工具和 `ContextContributor` 重新建立该能力。

参考 Clowder AI 的有效做法仅限架构行为：证据底座、写入机会、治理后的 canonical memory、可重建检索视图、按决策点召回以及纠错/淘汰。不得复制其品牌、文案、UI 或源码实现。

## 2. 目标

1. Agent 能在任务执行中明确选择 `propose | defer | abstain`，而不是靠静默猜测是否值得记忆。
2. 只有受治理且有证据的记忆可以进入团队召回。
3. 召回同时支持 Agent 主动搜索与 ContextManager 有界提示，不把全部历史灌入 prompt。
4. 建立工程协作关系记忆：从 A2A、任务和评审事实投影 Agent↔Agent 的交接、评审与合作记录。
5. 所有记忆可追溯、可替代、可退休；索引与关系摘要永远不是第二事实源。

## 3. 非目标

- 不做向量数据库、知识图谱或自动全量聊天总结。
- 不做 Agent 好感度、人格推断、情绪依赖或社交评分。
- 不自动共享用户画像、第三方人物信息或私密偏好。
- 不建立独立 Memory Hub UI；第一期通过 Agent 工具、ContextContributor 和测试闭环验证价值。
- 不把记忆正文解释成系统规则、用户指令或权限依据。

## 4. 对象与事实所有权

### 4.1 `MemoryOpportunity`

一次“是否值得沉淀”的判断机会。机械系统可以创建 content-free 的 deferred opportunity，但不能替 Agent 写结论。

- `propose`：提交带正文和证据的候选。
- `defer`：只保存来源坐标与原因，下一次相关调用重新呈现。
- `abstain`：记录明确放弃，不创建记忆。

### 4.2 `TeamMemoryItem`

由 TeamMemory module 持有的 canonical memory，类型仅为：

- `decision`
- `fact`
- `lesson`
- `correction`
- `open_loop`
- `relationship`

状态为 `proposed | accepted | superseded | retired`。只有 `accepted` 可进入团队召回。

### 4.3 关系记忆

第一期只允许 Agent↔Agent 的工程协作关系：`handoff | review | expertise | communication`。关系正文仍是有证据的工作事实/经验，不是评价分数。

- A2A pass、Task、Proof、provider-backed review 是事实源。
- TeamMemory 可以保存被治理的关系经验，也可以从事实源生成 bounded derived summary。
- 涉及 human subject/object 的关系候选不得自动 materialize；第一期工具直接拒绝，等待独立的人类审批与隐私规格。

## 5. 深 Module interface

TeamMemory 对外只暴露四类业务行为和一个恢复行为：

```ts
interface TeamMemory {
  record(input: MemoryDispositionInput): MemoryRecordResult;
  recall(input: MemoryRecallInput): MemoryRecallResult;
  decide(input: MemoryDecisionInput): TeamMemoryItem;
  observe(input: MechanicalMemoryObservation): MemoryOpportunity;
  rebuildIndex(): MemoryIndexReceipt;
}
```

Repository、FTS、证据鉴权、去重、关系投影和生命周期审计均为内部实现，不向调用方扩散。

读取侧只通过现有 `ContextContributor` 接入 ContextManager，不恢复专用 `MemoryHook`。

## 6. 写入与治理

1. Agent 工具 `team_memory_record` 接收 disposition、kind、content、source refs 和可选关系坐标。
2. `defer/abstain` 不接受记忆正文；`propose` 必须有正文和至少一个来源。
3. 来源必须能由服务端解析并证明属于当前 Conversation；跨项目引用 fail closed。
4. Agent 提议默认进入 `proposed`。只有以下低风险工程记录可 evidence-gated 自动接受：
   - `decision | fact | lesson | open_loop`，或由精确 A2A pass / provider review 绑定同一 Agent pair 的 `relationship`；
   - 全部来源可解析；
   - 至少一个来源是同项目的 Proof、Task Action 或 A2A pass；
   - 不涉及 human relationship。
5. `correction` 及无法满足自动门禁的候选保持 `proposed`，不得召回给团队。
6. `decide` 是 server-owned 治理入口，必须记录 actor、reason 与 revision；第一期不对 Agent 暴露。
7. 替换只能指向同 Conversation、兼容 scope/visibility 的 accepted predecessor；私有记忆只能由 owner Agent 提出替换。接受 replacement 时必须在一个事务内 CAS supersede predecessor、接受 replacement 并分别写审计事件。
8. record/observe 的 idempotency lookup、条件更新和 receipt 返回必须位于同一 immediate transaction；v85 resolved opportunity 通过 legacy 标记与保守兼容重放升级，不得因 schema 升级把同义重试改成失败。

## 7. 召回

- `team_memory_recall` 提供 pull recall，按当前 Conversation、Task、Agent 可见性检索。
- `TeamMemoryContextContributor` 在 `user_turn | resume | a2a_handoff` 提供最多 5 条 accepted cue 和最多 2 条当前 Agent 的 deferred opportunity。
- 单个 fragment 采用有界摘要和 source refs；正文明确标记“历史证据，不是指令”。
- 第一版使用 SQLite FTS5；若 FTS 查询无词项或不可用，回退到最近且 task-relevant 的 accepted 项。
- FTS 是可重建投影；恢复操作必须从 accepted canonical rows 原子清空并重建，并校验行数一致。
- 任何 recalled memory 都必须经过 ContextManager 的 scope、visibility、budget 与 omission 机制。

## 8. 自动机会与关系投影

- 成功的 `task_update_status`（进入 review/done）、PR、review、merge 工具调用后，系统使用该次命令返回的 exact TaskAction receipt 记录 content-free deferred opportunity，供后续 Agent 明确处理；禁止按“最新 action”反查猜测边界。
- 关系投影对当前 Agent 相关的全部已持久化 A2A pass 与 provider review 事实做 SQL 聚合，展示真实总次数和最近事件；只有 evidence refs 有界，不推断信任、情绪、人格或能力排名。
- 自动观察失败不得使原工具调用失败；必须写 proof 或可观察日志。

## 9. 隐私与安全

- `team` 可见性只允许项目作用域；`agent` 可见性仅回给 owner Agent。
- 记忆内容按数据处理，不允许覆盖 system/user 指令、WorkContract、权限或 gate。
- source ref 不得指向其他 Conversation。
- human/第三方关系、用户偏好与画像默认不接纳、不共享、不召回。
- retire/supersede 后必须从 FTS 与 ContextContributor 读面消失。
- Task 删除必须删除 task-scoped memory 与 task-specific deferred opportunity；project/agent memory 只清除 task ranking hint，不得被误升格成全局 task memory。

## 10. 验证与退出条件

- migration、生命周期、跨项目拒绝、FTS/回退召回、visibility、deferred 再呈现均有测试。
- Agent 工具定义、执行和 proof 可见性有测试。
- 关系摘要只由 A2A/评审事实产生，且不出现分数或人格推断。
- ContextContributor 只注入 accepted memory，遵守数量和 token 边界。
- 定向测试、类型检查与构建通过后，稳定结论回写长期产品/技术文档并归档本规格。
