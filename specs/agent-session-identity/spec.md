# Agent Session Identity

> 状态：active
> 关联 Issue：[#7](https://github.com/changhuaqiu/agent-task-team/issues/7)、[#8](https://github.com/changhuaqiu/agent-task-team/issues/8)

## 1. 目标

平台必须保证一个项目中的每个角色 Agent 拥有独立、稳定的逻辑 Session；新项目不得继承旧项目上下文，同一项目正常续聊不得静默更换 runtime session。

当前产品模型暂以 `conversation` 作为项目容器，因此本规格中的 `projectId` 在现阶段等于 `conversationId`。未来若拆分 Project 与 Conversation，Session scope 必须迁移到真实 `projectId`，不得继续依赖名称混用。

## 2. 核心对象

### Logical Agent Session

平台持有的 Session binding，由 server repository 作为唯一事实源：

```ts
interface LogicalAgentSession {
  id: string;
  projectId: string;
  agentId: string;
  generation: number;
  runtimeId: string;
  accountId?: string;
  runtimeSessionId?: string;
  status: 'provisioning' | 'active' | 'sealed' | 'broken';
  sealReason?: string;
}
```

现有 `agent_session` 表承载该对象；本次允许沿用 `conversation_id`、`cli_session_id` 字段名以控制迁移范围，但代码语义统一称 `project scope` 与 `runtime session id`。

### Runtime Session

底层 ACP agent 管理的会话，以 `runtimeSessionId` 标识。新建使用 `session/new`，续聊使用 `session/load`。它不是 Invocation，也不能被每轮执行静默替换。

### Invocation

一次执行尝试。Invocation 必须引用 Logical Agent Session，并记录本轮实际使用的 runtime session id；Invocation 无权修改 Session identity。

## 3. 强制不变量

1. 任一时刻 `(projectId, agentId)` 最多有一个 active Logical Agent Session。
2. 新项目中每个 Agent 的首次执行必须使用 ACP `session/new`。
3. 同项目同 Agent 已绑定 `runtimeSessionId` 时，后续执行必须使用 ACP `session/load`。
4. 不同项目、不同 Agent 的 runtime session id 必须相互独立。
5. runtime 返回或通知的 session id 必须等于本轮绑定值；不一致时返回 `acp_session_identity_changed`，不得覆盖 DB 或前端缓存。
6. ACP agent 未声明 `loadSession` 或加载失败时，返回可定位错误；不得自动降级为 `session/new`。
7. 已有成功 Invocation 确认的 runtime session 在 timeout、cancel、adapter 退出后不轮换；下一轮仍尝试恢复同一 runtime session。
8. 新 runtime session 只有在至少一个 Invocation 成功完成后才视为 confirmed。首次 Invocation 失败、取消或超时时，该 binding 属于 unconfirmed，可以通过 compare-and-clear 释放；下一次执行重新 `session/new`，不得尝试加载未落盘的 resource。
9. daemon 异常退出可能遗留 unconfirmed binding；下一次 dispatch 若确认该逻辑 Session 存在历史 Invocation 但从未成功，必须在创建新 Invocation 前清除该 binding。
10. runtime/account 变化需要显式 rotate generation；本次不提供自动 rotate。
11. 浏览器 Session 状态只用于展示；服务端缺值时不得使用 localStorage 值恢复执行。
12. 禁止 `default` scope 参与正式项目 dispatch；缺少 project/conversation id 时必须拒绝。

## 4. ACP 执行契约

`AcpBackend` 在 initialize 后读取真实 `agentCapabilities.loadSession`：

- 无 `resumeSessionId`：发送 `session/new`，使用返回的 session id。
- 有 `resumeSessionId` 且 capability 为 true：发送 `session/load`，绑定该 id；加载期间产生的历史 replay update 不转发给当前聊天。
- 有 `resumeSessionId` 但 capability 为 false：失败，reason code 为 `acp_resume_unsupported`。
- `session/load` 失败：失败，reason code 为 `acp_session_load_failed`。
- 当前 prompt 的所有 `session/update` 必须匹配绑定 id。

三个 Catalog runtime 当前实测均声明 `loadSession: true`：OpenCode 1.14.35、Claude adapter 0.59.0、Codex adapter 1.1.2。

## 5. Server Session 事实源

- daemon 只从 `sessionRepo.findActiveByConversation(agentId, projectId)` 获取 resume id。
- client payload 中的 `sessionId` 不参与 ACP 正式路径的恢复决策。
- 第一次 runtime session id 通过 compare-and-set 绑定；已绑定后再次收到不同值必须失败。
- `/api/state` 返回服务端 active binding；前端 hydration 直接替换 Session 展示缓存，不与 persisted Session 合并。
- socket event 可以刷新展示，但只能接受 server 已确认的 binding。

## 6. 数据约束与迁移

- migration 在创建唯一索引前审计重复 active `(conversation_id, agent_id)`。
- 对历史重复 active 行保留最新一条，其余 seal 为 `migration_duplicate_active`。
- 创建 partial unique index：`UNIQUE(conversation_id, agent_id) WHERE status = 'active'`。
- repository 的 Session 创建采用事务；唯一冲突时读取已存在 active binding，不制造第二条 active row。
- runtime session id 绑定采用 compare-and-set：仅允许 `NULL -> value` 或相同值重放。
- unconfirmed runtime session id 释放采用 compare-and-clear：仅当当前值仍等于目标 id 且该逻辑 Session 至少有一次 Invocation、但没有成功 Invocation 时，才允许恢复为 `NULL`。

## 7. 非目标

- 本次不拆分独立 Project 表与 Conversation 表。
- 本次不自动跨 runtime/account 迁移上下文。
- 已确认 Session 的 load 失败后不自动创建新 session；仅允许从未成功完成 Invocation 的 unconfirmed binding 在下一次 dispatch 前安全释放并重新 provision。
- 本次不实现用户侧 Session 管理 UI。

## 8. 验收

1. 两个项目、两个 Agent、每个三轮：组内 id 稳定，四组 id 相互不同。
2. 浏览器和 daemon 重启后继续恢复原 session。
3. timeout/cancel/进程退出后下一轮仍 load 原 id。
4. 并发首次唤醒不能产生两个 active binding。
5. resume capability 缺失、load 失败、identity mismatch 都有稳定 reason code。
6. DB、invocation、socket 展示的 runtime session id 一致。
7. 相关单元测试、集成测试、类型检查和构建通过。
8. 首次 Invocation 被取消后，下一次 dispatch 不 load 未落盘 id，而是重新执行 `session/new`。
