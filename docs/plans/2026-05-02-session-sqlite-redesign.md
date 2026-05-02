# 会话系统重构 + SQLite 持久化实施计划

## Summary

重构会话系统，引入 SQLite 作为主存储，实现 per-agent-per-task session 管理、实时消息持久化、串行/广播路由策略。一次到位替换 localStorage。

## Design Decisions (Confirmed)

| 决策 | 选择 | 理由 |
|------|------|------|
| Session 创建时机 | dispatch 时按需创建 | 避免空 session |
| Session seal 时机 | 任务完成时 seal | v0 最简 |
| 消息持久化 | 实时写 SQLite | WAL 模式性能足够 |
| 前端迁移 | 一次性切到 SQLite | 避免双写复杂性 |

## Architecture Overview

```
前端 (Zustand, 纯内存缓存)
  │
  ├── 读: 页面加载 → GET /api/state → SQLite → rehydrate Zustand
  ├── 写: 每个 mutation → Zustand.set() + POST /api/mutations → SQLite
  └── 实时: socket.on('agent:event') → POST /api/messages → SQLite + Zustand

后端 (SQLite via better-sqlite3 + Drizzle)
  │
  ├── .ath/data.db (WAL mode)
  ├── Schema: conversation, task, chat_message, agent_session, invocation, agent_event
  └── 初始化: server startup 时自动 migrate

Daemon (daemon.ts, 改造)
  │
  ├── dispatch 时: 查找/创建 agent_session → 注入 --session → 记录 invocation
  ├── NDJSON 输出: 解析 event → 写入 chat_message + agent_event → socket 广播
  └── 任务完成: seal agent_session
```

## Phases

### Phase 1: SQLite Foundation

**目标**: 引入 better-sqlite3 + Drizzle，建表，验证 CRUD。

**新建文件**:
- `src/server/db/index.ts` — SQLite 连接初始化（WAL mode, foreign keys, busy_timeout）
- `src/server/db/schema.ts` — Drizzle schema 定义（6 张表）
- `src/server/db/migrate.ts` — 迁移执行器

**安装依赖**:
```bash
pnpm add better-sqlite3 drizzle-orm
pnpm add -D @types/better-sqlite3 drizzle-kit
```

**Schema (6 张表)**:

```sql
-- 1. conversation (战役/项目)
CREATE TABLE conversation (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT,
  status TEXT DEFAULT 'active',
  priority TEXT DEFAULT 'p2',
  project_path TEXT,
  participants TEXT,  -- JSON array of agentIds
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. task (任务)
CREATE TABLE task (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',
  agent_id TEXT NOT NULL,
  dependencies TEXT,  -- JSON array
  artifacts TEXT,     -- JSON
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. chat_message (消息)
CREATE TABLE chat_message (
  id TEXT PRIMARY KEY,               -- sortable: ts_pad-seq-rand
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  sender_type TEXT NOT NULL,         -- human/agent/system
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text',  -- text/tool_use/tool_result/error/system/approval
  mentions TEXT,                     -- JSON array
  intent TEXT,                       -- ideate/execute/review/general
  metadata TEXT,                     -- JSON
  visibility TEXT DEFAULT 'public',
  created_at TEXT NOT NULL
);

-- 4. agent_session (per-agent-per-task session chain)
CREATE TABLE agent_session (
  id TEXT PRIMARY KEY,
  cli_session_id TEXT,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  context_health TEXT,               -- JSON
  usage_snapshot TEXT,               -- JSON
  message_count INTEGER DEFAULT 0,
  seal_reason TEXT,
  created_at TEXT NOT NULL,
  sealed_at TEXT,
  UNIQUE(agent_id, task_id, seq)
);

-- 5. invocation (每次 dispatch 的记录)
CREATE TABLE invocation (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  session_id TEXT,                   -- 关联 agent_session.id
  status TEXT NOT NULL DEFAULT 'queued',
  engine TEXT,
  account_id TEXT,
  cli_session_id TEXT,
  prompt TEXT,
  exit_code INTEGER,
  reason_code TEXT,
  usage TEXT,                        -- JSON
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 6. agent_event (事件流)
CREATE TABLE agent_event (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,                      -- JSON
  created_at TEXT NOT NULL
);

-- 索引
CREATE INDEX idx_task_conv ON task(conversation_id);
CREATE INDEX idx_msg_conv ON chat_message(conversation_id);
CREATE INDEX idx_msg_task ON chat_message(task_id);
CREATE INDEX idx_msg_created ON chat_message(created_at);
CREATE INDEX idx_session_agent_task ON agent_session(agent_id, task_id);
CREATE INDEX idx_invocation_agent ON invocation(agent_id);
CREATE INDEX idx_invocation_conv ON invocation(conversation_id);
CREATE INDEX idx_event_conv ON agent_event(conversation_id);
CREATE INDEX idx_event_agent ON agent_event(agent_id);
```

**测试**: CRUD 单元测试，验证 schema 正确、索引生效、外键约束。

---

### Phase 2: Repository Layer

**目标**: 为每张表创建 typed repository，提供业务语义的读写接口。

**新建文件**:
- `src/server/repositories/conversation-repo.ts`
- `src/server/repositories/task-repo.ts`
- `src/server/repositories/message-repo.ts`
- `src/server/repositories/session-repo.ts`
- `src/server/repositories/invocation-repo.ts`
- `src/server/repositories/event-repo.ts`
- `src/server/repositories/sortable-id.ts` — sortable ID 生成器

**关键接口**:

```typescript
// message-repo.ts
export const messageRepo = {
  append(msg: NewMessage): string,                        // 写入 + 返回 ID
  getByConversation(convId, { limit, cursor }): Message[], // 分页查询
  getByTask(taskId): Message[],                            // 任务消息
  getByAgent(agentId, { limit }): Message[],               // agent 消息
};

// session-repo.ts
export const sessionRepo = {
  findActive(agentId, taskId): AgentSession | undefined,   // 查活跃 session
  create(input): AgentSession,                              // 创建新 session
  updateCliSessionId(id, cliSessionId): void,              // 更新 CLI session ID
  seal(id, reason): void,                                   // 封存 session
  sealByTask(agentId, taskId, reason): void,               // 按任务封存
};

// invocation-repo.ts
export const invocationRepo = {
  create(input): Invocation,
  updateStatus(id, status, updates?): void,
  getByAgent(agentId, { limit }): Invocation[],
};
```

**Sortable ID 生成**:
```typescript
// "{timestamp_pad16}-{seq_pad6}-{random_hex8}"
// 例: "0000019248376543-000001-a3f2b1c4"
function generateSortableId(): string {
  const ts = Date.now().toString().padStart(16, '0');
  const seq = (++globalSeq).toString().padStart(6, '0');
  const rand = crypto.randomBytes(4).toString('hex');
  return `${ts}-${seq}-${rand}`;
}
```

**测试**: 每个 repo 的 CRUD 测试。

---

### Phase 3: API Routes (Read + Write)

**目标**: 创建 REST API routes，前端通过 API 读写 SQLite。

**新建文件**:
- `src/pages/api/state.ts` — GET: 加载全部状态（初始化用）
- `src/pages/api/mutations.ts` — POST: 通用 mutation 入口
- `src/pages/api/sessions/route.ts` — Session CRUD

**改造文件**:
- `src/pages/api/accounts/index.ts` — 复用已有的 accounts API 模式

**State API 返回结构**:
```typescript
GET /api/state → {
  conversations: Conversation[],
  tasks: Task[],
  recentMessages: Record<string, ChatMessage[]>,  // 每个会话最近 50 条
  activeSessions: Record<string, AgentSession[]>,  // 每个 agent 的活跃 sessions
  events: Record<string, AgentEvent[]>,            // 每个会话的事件
}
```

**Mutation API**:
```typescript
POST /api/mutations { type: 'createConversation', payload: {...} }
POST /api/mutations { type: 'updateTaskStatus', payload: {...} }
POST /api/mutations { type: 'appendMessage', payload: {...} }
// ... 统一入口，后端路由到对应 repo
```

---

### Phase 4: Daemon Integration

**目标**: daemon.ts 接入 SQLite，dispatch 时管理 session，NDJSON 输出写消息。

**改造文件**: `src/server/daemon.ts`

**关键改造点**:

1. **dispatch 时 session 查找/创建**:
```typescript
// 在 terminal:start handler 中
let session = sessionRepo.findActive(accountId, taskId);
if (!session) {
  session = sessionRepo.create({
    conversationId, agentId, taskId, seq: 0,
  });
}
const cliSessionId = session.cliSessionId; // 可能为 undefined（首次）
const invocation = invocationRepo.create({...});

// buildArgs 注入 --session
const primaryArgs = engineDef.buildArgs(prompt || '', cliSessionId);
```

2. **NDJSON sessionID 捕获**:
```typescript
// handleJsonLine 中，捕获 sessionID 后
if (parsedSessionId && session && !session.cliSessionId) {
  sessionRepo.updateCliSessionId(session.id, parsedSessionId);
}
```

3. **消息写入**:
```typescript
// handleJsonLine 中，每个事件写入 chat_message + agent_event
if (type === 'text') {
  messageRepo.append({ conversationId, taskId, senderType: 'agent', senderId: agentId, content: text, contentType: 'text' });
  eventRepo.append({ conversationId, taskId, agentId, type: 'agent.text', payload: { text } });
}
```

4. **退出处理**:
```typescript
child.on('close', (code) => {
  invocationRepo.updateStatus(invocation.id, code === 0 ? 'succeeded' : 'failed', { exitCode: code });
  // 不在这里 seal session，等任务状态变更时再 seal
});
```

5. **任务完成时 seal**:
```typescript
// 前端 updateTaskStatus → mutation API → sealByTask
```

---

### Phase 5: Frontend Migration

**目标**: 移除 Zustand persist，改为从 API 加载。

**改造文件**: `src/store/taskHubStore.ts`

**关键改造**:

1. **移除 persist middleware**:
```typescript
// 删除: persist(create<Store>(...), { name: 'agent-task-hub-store-clean', ... })
// 改为: create<Store>(...)
```

2. **onRehydrate 替换为 loadFromServer**:
```typescript
// 初始化时
async function loadFromServer() {
  const res = await fetch('/api/state');
  const data = await res.json();
  // 批量 set 到 Zustand
  set({
    conversations: data.conversations,
    tasks: data.tasks,
    ...
  });
}
```

3. **每个 mutation 双写**:
```typescript
dispatchToAgent: (...) => {
  // 1. Zustand 内存更新（保持 UI 响应速度）
  set(state => ({ agentStatus: { ...state.agentStatus, [agentId]: 'busy' } }));
  // 2. SQLite 写入（异步，不阻塞 UI）
  fetch('/api/mutations', { method: 'POST', body: JSON.stringify({ type: 'createInvocation', payload: {...} }) });
  // 3. Socket emit（不变）
  socket.emit('terminal:start', {...});
}
```

4. **Socket 事件处理改造**:
```typescript
// 之前: 直接写 Zustand
socket.on('agent:event', (event) => {
  useTaskHubStore.getState().addChatMessage({...});
});
// 之后: 写 SQLite + Zustand
socket.on('agent:event', (event) => {
  useTaskHubStore.getState().addChatMessage({...});  // 内存
  fetch('/api/mutations', { method: 'POST', body: JSON.stringify({ type: 'appendMessage', payload: {...} }) }); // SQLite
});
```

5. **Session 存储迁移**:
```typescript
// 之前: agentSessions[projectId][agentId] = 'ses_xxx' (per-agent-per-project)
// 之后: 从 /api/state 加载 activeSessions，key 变为 agent_session 表记录
// daemon 不再依赖前端传 sessionId，自己从 SQLite 查
```

---

### Phase 6: Routing

**目标**: 实现串行和广播路由。

**新建文件**:
- `src/server/routing/mention-parser.ts` — @mention 解析器
- `src/server/routing/agent-router.ts` — 路由决策

**路由逻辑**:
```typescript
function resolveTargets(message: string, participants: string[]): {
  strategy: 'serial' | 'broadcast';
  targets: string[];
} {
  const mentions = parseMentions(message); // 提取 @jean, @qiqi 等

  if (mentions.length === 0 || mentions.includes('all')) {
    return { strategy: 'broadcast', targets: participants };
  }

  return { strategy: 'serial', targets: mentions };
}
```

**Serial 执行**: 在 daemon 层面，连续 emit 多个 `terminal:start`，每个等前一个 `terminal:exit` 后再发下一个。或者前端串行调用 `dispatchToAgent`。

**v0 简化**: 路由在前端完成（store 里已经做 @mention 解析），后端只负责执行。串行 = 前端按序调用 dispatchToAgent。

---

## File Map

### New Files (16)
```
src/server/db/index.ts                    — SQLite 连接
src/server/db/schema.ts                   — Drizzle schema
src/server/db/migrate.ts                  — 迁移执行器
src/server/repositories/sortable-id.ts    — ID 生成
src/server/repositories/conversation-repo.ts
src/server/repositories/task-repo.ts
src/server/repositories/message-repo.ts
src/server/repositories/session-repo.ts
src/server/repositories/invocation-repo.ts
src/server/repositories/event-repo.ts
src/pages/api/state.ts                    — 初始化加载
src/pages/api/mutations.ts               — 通用 mutation
src/server/routing/mention-parser.ts      — @mention 解析
src/server/routing/agent-router.ts        — 路由决策
src/server/db/index.test.ts               — DB 基础测试
src/server/repositories/repos.test.ts     — Repo CRUD 测试
```

### Modified Files (4)
```
src/server/daemon.ts          — 接入 session repo + invocation repo + 消息写入
src/store/taskHubStore.ts     — 移除 persist, 加 loadFromServer, 双写 mutations
src/pages/api/socketio.ts     — DB 初始化
package.json                  — 新增 better-sqlite3, drizzle-orm
```

## Execution Order

```
Phase 1 (SQLite Foundation)     ← 无依赖，先做
  ↓
Phase 2 (Repository Layer)      ← 依赖 Phase 1 schema
  ↓
Phase 3 (API Routes)            ← 依赖 Phase 2 repos
  ↓
Phase 4 (Daemon Integration)    ← 依赖 Phase 2 repos, 可与 Phase 3 并行
  ↓
Phase 5 (Frontend Migration)    ← 依赖 Phase 3 + 4
  ↓
Phase 6 (Routing)               ← 依赖 Phase 5, 可独立开发
```

## Risk & Mitigation

| 风险 | 缓解措施 |
|------|---------|
| better-sqlite3 native addon 在 Vercel 部署失败 | 我们是自托管/本地运行，不部署 Vercel |
| SQLite WAL 文件增长 | 设置 `journal_size_limit = 64MB` |
| localStorage 迁移数据丢失 | 首次启动时检测 localStorage 数据 → 迁移到 SQLite → 清除 |
| Zustand 双写一致性 | 写入顺序: SQLite 先写 → Zustand 后写；读取始终从 Zustand |
| 并发写入冲突 | better-sqlite3 同步 API + WAL 模式已处理 |
