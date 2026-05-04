# 项目级 Agent Session 复用 — 实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 agent session 粒度从 `(agentId, taskId)` 改为 `(agentId, conversationId)`，实现同一项目中同一 agent 始终复用一个 CLI session。

**Architecture:** Daemon 端 session 查找改为按 conversationId，移除任务完成时的 seal 调用，客户端 dispatchToAgent 传递真实 conversationId 并注入任务上下文到 prompt。

**Tech Stack:** SQLite (drizzle-orm), Socket.io, Zustand

---

### Task 1: Session Repository 新增 `findActiveByConversation`

**Files:**
- Modify: `src/server/repositories/session-repo.ts:19-26`

- [ ] **Step 1: Add `findActiveByConversation` method**

在 `session-repo.ts` 的 `sessionRepo` 对象中，`findActive` 方法之后（line 26 后），添加新方法：

```typescript
findActiveByConversation(agentId: string, conversationId: string): AgentSessionRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM agent_session WHERE agent_id = ? AND conversation_id = ? AND status = ? ORDER BY seq DESC LIMIT 1',
    )
    .get(agentId, conversationId, 'active') as AgentSessionRow | undefined;
},
```

- [ ] **Step 2: Modify `create` to accept optional taskId**

将 `create` 方法签名中的 `taskId: string` 改为 `taskId?: string`（line 38），INSERT 语句中 `task_id` 改为 `COALESCE(?, '')`：

```typescript
create(input: {
  id: string;
  conversationId: string;
  agentId: string;
  taskId?: string;
  seq?: number;
}): AgentSessionRow {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO agent_session (id, conversation_id, agent_id, task_id, seq, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    )
    .run(input.id, input.conversationId, input.agentId, input.taskId ?? '', input.seq ?? 0, now);
  return sessionRepo.getById(input.id)!;
},
```

- [ ] **Step 3: Commit**

```bash
git add src/server/repositories/session-repo.ts
git commit -m "feat: add findActiveByConversation to session repo, make taskId optional"
```

---

### Task 2: Daemon session 查找改为按 conversationId

**Files:**
- Modify: `src/server/daemon.ts:133-193` (terminal:start handler session logic)

当前 daemon 的 `terminal:start` handler（line 168-193）用 `if (taskId && accountId)` 包裹 session 逻辑，按 `(agentId, taskId)` 查找。

- [ ] **Step 1: Extend `TerminalStartPayload` type**

在 `daemon.ts` line 22-37 的 `TerminalStartPayload` type 中添加 `conversationId` 字段：

```typescript
// 在 sessionId?: string; 之后添加
conversationId?: string;
```

- [ ] **Step 2: Rewrite session logic in terminal:start handler**

替换 `daemon.ts` lines 164-193（`// --- Session & Invocation tracking (SQLite) ---` 到 invocation 创建结束）为：

```typescript
// --- Session & Invocation tracking (SQLite) ---
// Use conversationId for session scoping (project-level session per agent)
const sessionConvId = conversationId || projectId || 'default';
let agentSession: AgentSessionRow | undefined;
let invocation: InvocationRow | undefined;

if (accountId) {
  agentSession = sessionRepo.findActiveByConversation(agentId, sessionConvId);

  if (!agentSession) {
    const newSessionId = generateSortableId('ses');
    agentSession = sessionRepo.create({
      id: newSessionId,
      conversationId: sessionConvId,
      agentId,
      taskId: taskId || undefined,
      seq: 0,
    });
  }

  const invocationId = generateSortableId('inv');
  invocation = invocationRepo.create({
    id: invocationId,
    conversation_id: sessionConvId,
    task_id: taskId || '',
    agent_id: agentId,
    session_id: agentSession.id,
    engine,
    account_id: accountId,
    prompt: prompt || '',
  });
}
```

关键变化：
- `if (taskId && accountId)` → `if (accountId)` — 不再需要 taskId 才创建 session
- `findActive(agentId, taskId)` → `findActiveByConversation(agentId, sessionConvId)`
- session 的 conversationId 使用实际对话 ID，不再使用 `'default'`

- [ ] **Step 3: Commit**

```bash
git add src/server/daemon.ts
git commit -m "feat: daemon session lookup by conversationId instead of taskId"
```

---

### Task 3: 移除 Store 端的 seal 调用

**Files:**
- Modify: `src/store/taskHubStore.ts:1459-1468` (updateTaskStatus seal)
- Modify: `src/store/taskHubStore.ts:1808-1815` (terminal:exit seal)

- [ ] **Step 1: Remove seal in updateTaskStatus**

删除 `taskHubStore.ts` lines 1459-1468，即整个 `if (status === 'done' || status === 'rejected' || status === 'blocked')` 块：

```typescript
// 删除这整段
if (status === 'done' || status === 'rejected' || status === 'blocked') {
  const task = get().tasks.find((t) => t.id === taskId);
  if (task) {
    fetch('/api/mutations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'session.sealByTask', payload: { agentId: task.agentId, taskId, reason: `task_${status}` } }),
    }).catch((err) => console.error('[mutation] session.sealByTask failed:', err));
  }
}
```

- [ ] **Step 2: Remove seal in terminal:exit handler**

删除 `taskHubStore.ts` lines 1808-1815，即 terminal:exit 中的 seal 块：

```typescript
// 删除这整段
const task = store.tasks.find((t) => t.id === taskId);
if (task) {
  fetch('/api/mutations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'session.sealByTask', payload: { agentId: task.agentId, taskId, reason: `exit_${code}` } }),
  }).catch(() => {});
}
```

- [ ] **Step 3: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: remove session.sealByTask calls on task completion and process exit"
```

---

### Task 4: dispatchToAgent 传递 conversationId + 注入任务上下文

**Files:**
- Modify: `src/store/taskHubStore.ts:1237-1302` (dispatchToAgent)

- [ ] **Step 1: Add task context injection and pass conversationId**

在 `dispatchToAgent` 函数中，修改 prompt 构建逻辑。在 role card context 之后（line 1274 后），添加任务上下文注入：

```typescript
// Build role card context prefix (existing code, lines 1260-1274)
let effectivePrompt = prompt;
if (agent?.roleCardId) {
  const rc = get().roleCards.find((c) => c.id === agent.roleCardId);
  if (rc) {
    const parts: string[] = [`[Role: ${rc.displayName}]`];
    if (rc.responsibilities.length) parts.push(`Responsibilities: ${rc.responsibilities.join(', ')}`);
    if (rc.nonResponsibilities.length) parts.push(`NOT responsible for: ${rc.nonResponsibilities.join(', ')}`);
    if (rc.outputFormat !== 'freeform') parts.push(`Output format: ${rc.outputFormat}`);
    if (rc.requiresEvidence) parts.push('Must provide evidence/references');
    if (rc.forbiddenActions.length) parts.push(`Forbidden: ${rc.forbiddenActions.join(', ')}`);
    parts.push('---');
    effectivePrompt = `${parts.join('\n')}\n${prompt}`;
  }
}

// Inject task context if referencedTaskId exists
if (referencedTaskId) {
  const task = get().getTaskById(referencedTaskId);
  if (task) {
    const phase = task.phaseId ? get().phases.find((p) => p.id === task.phaseId) : undefined;
    const contextParts: string[] = [`[任务: ${task.id} ${task.title}]`];
    if (phase) contextParts.push(`[阶段: ${phase.title}]`);
    if (task.description) contextParts.push(task.description);
    contextParts.push(effectivePrompt);
    effectivePrompt = contextParts.join('\n');
  }
}
```

- [ ] **Step 2: Pass conversationId in terminal:start payload**

修改 `socket.emit('terminal:start', ...)` 调用（line 1291），添加 `conversationId` 字段：

```typescript
socket.emit('terminal:start', {
  projectId,
  taskId: referencedTaskId,
  conversationId,  // 新增：传递真实对话 ID
  agentId,
  prompt: effectivePrompt,
  sessionId,
  allowMockRunner: get().enableMockRunner,
  opencodeBridgeUrl: get().opencodeBridge.enabled ? get().opencodeBridge.url : undefined,
  engine: resolvedEngine,
  accountIds: effectiveIds,
  accountId: resolvedBinding?.accountId ?? '',
});
```

- [ ] **Step 3: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: pass conversationId to daemon, inject task context into prompt"
```

---

### Task 5: 验证

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 2: Manual test flow**

Run: `pnpm dev`

测试步骤：
1. 创建项目，@jean 触发拆解 → 观察 CLI session ID 被捕获
2. 再次 @jean 发消息 → 确认 CLI 使用 `--resume` 复用 session
3. 确认任务拆解后，agent 仍记得之前的对话
4. 确认任务完成时 session 不被 seal（检查 SQLite agent_session 表 status 仍为 active）
