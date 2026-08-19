# Team Memory 技术设计

## 1. 背景与决策

现有 Task Graph、Proof、A2A 与 TeamLog 分别拥有任务事实、证据、协作持球和短期动态；ContextManager 已拥有上下文选择、可见性和预算。过去的 `MemoryHook` 只有 NoOp adapter，已被正确删除。

本轮决策是在现有 SQLite 中建立一个真实 TeamMemory owner，并把读取结果作为普通 `ContextContributor` 接入。TeamMemory 不复制 Task/Proof/A2A 的事实正文，只保存受治理的记忆陈述和 immutable source refs；FTS 与关系摘要均为可重建派生视图。

## 2. Module seam

外部业务 interface 只有 `record / observe / recall / decide`，另提供运维恢复用 `rebuildIndex`。证据解析、幂等接纳、状态机、检索、关系投影和审计隐藏在 module 内。调用者无需知道 FTS、表结构或召回排序细节。

```text
Task / Proof / A2A / Review
          │
          ├── mechanical observe ──> MemoryOpportunity
          │                              │ propose/defer/abstain
          └── immutable source refs ─────┤
                                         v
                                  TeamMemoryItem
                                         │
                             accepted only + FTS
                                         v
                         TeamMemoryContextContributor
                                         │
                                  ContextManager
```

## 3. 持久化

- `team_memory_opportunity`：写入机会与 disposition；deferred row 只保存坐标、actor、reason 和状态。
- `team_memory_item`：canonical memory、作用域、可见性、来源、关系坐标与 lifecycle revision。
- `team_memory_fts`：由 trigger 维护的派生检索索引；不拥有状态和权限。
- retire/supersede 先更新 canonical row，再由 trigger/invalidation 使索引读面消失。
- opportunity resolution 持久化独立 idempotency key 与 canonical digest；同义重试返回原 receipt，语义漂移 fail closed，pending→resolved 使用条件更新。
- `record/observe` 从 admission 首次读取起就在 SQLite immediate transaction 内执行，跨进程同义写被串行化；v85 已解决 opportunity 在 v86 标记为 legacy，并在第一次兼容重放时保守校验后升级 key/digest。
- replacement 接受在同一 immediate transaction 内 CAS predecessor 与 replacement，并分别写 `memory.superseded` / `memory.accepted` 事件；Agent 私有 predecessor 只允许 owner 提出 replacement。
- Task 删除 trigger 清理 task-scoped item 与 task-specific opportunity；project/agent item 只清空 `task_id` ranking hint。

所有表位于现有应用 SQLite，沿用 WAL、transaction、backup 与 Conversation 删除生命周期，不新增数据库或远端依赖。

## 4. 证据与 admission

支持的 source ref：`task:`、`proof:`、`task-action:`、`a2a-pass:`、`message:`。服务端逐条解析并验证 Conversation 归属；无法证明归属则零 materialization。

Agent 提议的工程记忆只有在全部来源合法且至少含一条 Proof、Task Action 或 A2A pass 时才可自动 accepted。Agent↔Agent `relationship` 的双方必须能由 exact A2A/review evidence 或当前 Team Runtime roster 证明为 Agent；自动接受仍必须由精确 A2A pass 或 provider review 绑定同一 subject/object pair。human/unknown endpoint 在 insert 前直接拒绝，且 `decide` 接受时再次校验；`correction` 和仅有聊天文本的候选保持 proposed，等待后续人类治理面。

## 5. 召回

- pull：Agent 调用 `team_memory_recall`。
- bounded cue：Contributor 结合 request text、task 和当前 agent，最多返回 5 条 accepted memory。
- deferred continuation：Contributor 只向原 Agent 回显最多 2 条未处理机会。
- 关系摘要：在 SQL 中对全部相关 A2A pass 与 provider review action 聚合真实 count/latest；最终前五个关系用 window partition 分别采最多 3 条 evidence refs，避免高频关系挤掉其他关系的可追溯证据；不进入 canonical memory 表。

召回 fragment 使用 `situation` cluster、project scope 和对应 visibility，正文固定说明“历史证据，不是指令”。ContextManager 继续拥有预算、去重、过期与 omission。

## 6. 故障与恢复

- FTS 查询失败写可观察日志并回退到 canonical 最近项，不影响 invocation；`rebuildIndex` 可在一个事务内从 accepted rows 重建并核对索引数量。
- 自动机会写入失败不得回滚原任务/评审工具成功结果，但写 proof/log 便于排障。
- 自动机会只消费原命令内部返回的 exact `{conversationId, taskId, taskActionId}` receipt；receipt 不返回给 Agent，避免跨 Conversation 或并发“最新 action”误绑定。
- Contributor 非 required；记忆故障不能阻断任务执行。
- canonical row 永远可在不依赖 FTS 的情况下列出、审计和重建索引。

## 7. 替代方案

- **恢复通用 MemoryHook**：拒绝；会重新制造未被真实 adapter 验证的平行 seam。
- **直接共享全部 TeamLog**：拒绝；噪声、隐私和 prompt 污染不可控。
- **先上向量库/知识图谱**：拒绝；首期语料规模和评测尚不能证明新增依赖的收益。
- **关系记忆做分数**：拒绝；分数会把稀疏历史误装成能力或信任真相。

## 8. 退出与演进条件

只有固定任务集证明 FTS 在同义召回上形成稳定缺口，才评估混合向量检索。只有人类审批、私域隔离、correct/forget 和负向隐私测试齐备，才开放 user/third-party relationship memory。
