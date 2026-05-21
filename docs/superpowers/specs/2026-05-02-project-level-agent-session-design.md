# 项目级 Agent Session 复用设计

## 背景

当前 agent session 按 `(agentId, taskId)` 创建和管理。每个任务产生独立 session，任务完成即 seal。这导致：

- 聊天中 @agent 时（无 taskId），不经过 session 跟踪，每次都是全新 CLI 进程
- 不同任务创建不同 session，agent 的上下文被碎片化
- 同一项目里多次 @agent，agent 无法记住之前的对话

用户期望：**同一项目中同一 agent 始终复用一个 CLI session，所有对话和任务共享上下文。**

## 目标

1. Session 粒度改为 `(agentId, conversationId)` — 一个项目里每个 agent 只有一个长期 session
2. Session 生命周期跟随项目：创建时生成，归档时 seal
3. 任务派发复用 session，通过 prompt 注入任务上下文
4. 聊天中 @agent 也复用 session（不再每次新建）

## 数据模型变更

### agent_session 表

```sql
-- 现有 unique index
-- uq_session_agent_task_seq ON (agent_id, task_id, seq)

-- 改为
-- uq_session_agent_conversation ON (agent_id, conversation_id) WHERE status = 'active'
```

`task_id` 变为可选字段（`NULL` when no task context）。

### Session 状态生命周期

```
项目创建 + agent 首次派发
  → session created (status: 'active')
  → CLI 输出 cli_session_id → 回写

后续派发（聊天 / 任务）
  → 查找 active session → 复用 cli_session_id
  → CLI --resume <cliSessionId>

项目归档
  → session sealed (status: 'sealed')
```

**不再在以下时机 seal：**
- 任务完成（done/rejected）
- 任务阻塞（blocked）
- 进程退出失败

## 派发流程

### Session 查找（daemon 端）

```
terminal:start → { agentId, conversationId, taskId?, ... }
  → findActiveByConversation(agentId, conversationId)
  → 找到 → 使用 session.cli_session_id
  → 没找到 → 创建新 session (status: 'active')
  → spawn CLI (--resume <sessionId> if exists)
```

移除 `if (taskId && accountId)` 的 guard。只要 `accountId` 存在就创建/查找 session。

### 任务上下文注入

有 taskId 时，prompt 前缀拼入任务信息：

```
[任务: TASK-005 数据库 Schema 设计]
{用户原始 prompt}
```

让 agent 知道当前在做什么任务，同时通过 `--resume` 保持完整上下文。

### Prompt 模板

```typescript
function buildPrompt(rawPrompt: string, task?: Task, phase?: Phase): string {
  if (!task) return rawPrompt;
  const parts = [`[任务: ${task.id} ${task.title}]`];
  if (phase) parts.push(`[阶段: ${phase.title}]`);
  if (task.description) parts.push(task.description);
  parts.push(rawPrompt);
  return parts.join('\n');
}
```

## Store 变更

### dispatchToAgent

- 始终传递 `conversationId`
- 有 `referencedTaskId` 时查找对应 task 和 phase，拼入 prompt

### updateTaskStatus

- **移除** `session.sealByTask` 调用（done/rejected/blocked 时不再 seal）

### triggerBreakdown

- 不变（已经传递 conversationId）

## Daemon 变更

### terminal:start handler

1. Session 查找改为 `findActiveByConversation(agentId, conversationId)`
2. 移除 `if (taskId && accountId)` guard — 改为 `if (accountId)`
3. `task_id` 存入 session 行（可选），但不作为查找键

### 2026-05-17 会话隔离修正

一次新建项目复用旧项目 CLI session 的问题暴露出两个边界：

1. 前端所有 session cache 读取和写入都必须以本次派发的 `conversationId` 为准，不能退回当前选中的 `selectedProjectId`。当用户在旧项目仍处于选中状态时发起新项目派发，旧项目的 cached session 不应进入新项目的 `terminal:start` payload。
2. Daemon 在已经找到或创建 `(agentId, conversationId)` 对应的数据库 session 行后，不能再把客户端传来的 `sessionId` 当作兜底值。如果该 conversation 的数据库 session 尚未回写 `cli_session_id`，本次启动必须按新 session 处理，等待 CLI 输出自己的 session id 后再回写。
3. `agent:session` 和带 `sessionId` 的 `agent:event` 广播必须携带并使用实际运行的 `conversationId`。前端 upsert session 时应优先使用事件中的 `conversationId`，只在兼容旧事件时才退回 `projectId`。

这条约束保证 session 复用只发生在同一个 `(agentId, conversationId)` 内，避免新项目继承旧项目的上下文。

### 2026-05-17 后台子 Agent 活动修正

OpenCode 可能在主 CLI 进程中派出子 agent 或子任务。此时本地父进程退出不等于 project session 已完成：子 agent 的结果仍可能回写到同一个 `cli_session_id`，页面如果只监听 `terminal:exit` 就会误判 agent 空闲，并且过早把任务推进 `in_review`。

修正后的状态模型：

1. `terminal:exit` 只代表本地进程结束，不能单独作为 session 完成信号。
2. Daemon 在看到 `Agent` / `Task` 工具调用时广播 `agent:activity { status: 'awaiting_children' }`，并把本轮 `terminal:exit` 标记为 `activity: 'awaiting_children'`。
3. 前端收到 `awaiting_children` 后将 agent 标记为 `background`，保留 `activeRunsByAgent`，停止 stream watchdog 自动收尾，并阻止新的派发进入该 agent。
4. 当 `terminal:exit` 发生且 activity 仍是 `awaiting_children` 时，不写 `run.finished`，不清空 active run，不自动把任务推进 `in_review`。
5. 后续 session reconciler 或 runtime watcher 应在确认子 agent 结果已同步后广播 `agent:activity { status: 'idle' }`，此时页面才收尾。

这条约束把进程生命周期和 session 活动生命周期拆开，避免后台子 agent 仍在工作时 UI 显示为空闲。

### terminal:exit handler

- **移除** `session.sealByTask` 调用（进程失败时不再 seal）

### Session repository

新增方法：
```typescript
findActiveByConversation(agentId: string, conversationId: string): AgentSession | undefined
// WHERE agent_id = ? AND conversation_id = ? AND status = 'active' ORDER BY seq DESC LIMIT 1
```

## 不在范围内

- Session chaining（上下文窗口满时自动 fork 新 session + 摘要衔接）— 后续
- 多 agent 共享上下文 — 不做，每个 agent 独立 session
- Session 内子话题管理 — 不做，依赖 CLI 自身的上下文管理

## 文件清单

| 操作 | 文件 | 改动 |
|---|---|---|
| Modify | `src/server/daemon.ts` | session 查找逻辑、移除 guard、移除 seal 调用 |
| Modify | `src/server/repositories/session-repo.ts` | 新增 findActiveByConversation |
| Modify | `src/store/taskHubStore.ts` | dispatchToAgent prompt 注入、移除 seal 调用 |
