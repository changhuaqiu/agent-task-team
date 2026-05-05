# 01 — 整体架构

## 1.1 形态与边界

Agent Task Hub 是一个四层结构的多智能体协作平台：

| 层级 | 技术 | 职责 |
|------|------|------|
| **前端工作台** | Next.js + React | 项目切换、作战指挥室、任务详情、风险面板 |
| **状态编排层** | Zustand | UI 状态、Socket 事件、API Rehydrate |
| **应用后端层** | Next.js API + SQLite | 数据持久化、业务逻辑、Repository |
| **执行层** | Socket.io Daemon + Agent Backend | CLI 执行、会话管理、事件流 |

## 1.2 运行时拓扑

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (前端)                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Zustand Store                                            │  │
│  │  - pendingDispatches (按 agentId:conversationId 隔离)     │  │
│  │  - agentStatus / activeRunsByAgent                        │  │
│  │  - chatMessagesByConversation                             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │ Socket.io
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js Server                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ /api/state  │  │ /api/mutat. │  │ /api/socketio (Daemon)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Daemon (src/server/daemon.ts)                          │    │
│  │  - Session 管理 (按 agentId + conversationId)            │    │
│  │  - Invocation 跟踪                                      │    │
│  │  - Account Credential 注入                              │    │
│  │  - Agent Backend 选择                                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  SQLite (better-sqlite3 + Drizzle ORM)                  │    │
│  │  - conversation / task / message                        │    │
│  │  - agent_session / invocation / event                   │    │
│  │  - account / role_card / skill                          │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Backend (执行层)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  OpenCode   │  │  Claude CLI │  │  Codex CLI  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## 1.3 核心数据流

### A) 页面初始化与 Rehydrate

1. `ClientHome.tsx` 调用 `loadFromServer()`
2. `GET /api/state` 从 SQLite 加载：
   - conversations、tasks、recentMessages
   - activeSessions、recentInvocations、skills
3. Store 映射为前端运行态，然后调用 `connectDaemon()`

### B) 用户操作与持久化

1. 用户在工作台操作（创建项目、任务、消息等）
2. Store 先更新本地状态
3. 通过 `POST /api/mutations` 写入 Repository → SQLite

### C) 任务执行链路

```
用户触发任务
    │
    ▼
dispatchToAgent()
    │
    ├─ agentStatus[agentId] === 'busy'?
    │   └─ YES → enqueueDispatch(agentId, conversationId)
    │             存入 pendingDispatches["agentId:conversationId"]
    │
    └─ NO → socket.emit('terminal:start')
                │
                ▼
        Daemon 处理
                │
                ├─ sessionRepo.findActiveByConversation(agentId, conversationId)
                │   └─ 找到 → 使用 cli_session_id (--resume)
                │   └─ 没找到 → 创建新 session
                │
                ├─ createBackend(engine).execute(prompt, opts)
                │   └─ 返回 AsyncGenerator<AgentEvent>
                │
                └─ for await (event of events)
                    ├─ 广播到前端 (agent:event)
                    ├─ 写入 messageRepo / eventRepo
                    └─ event.type === 'done'
                        └─ orchestrator.onAgentDone()
                            └─ dequeueNextPending(agentId, conversationId)
```

### D) 会话隔离机制

**设计目标**：每个项目中每个 Agent 维护一个长期会话，所有对话共享上下文。

| 维度 | 隔离键 | 说明 |
|------|--------|------|
| Session (DB) | `(agent_id, task_id)` | 一个项目中一个 Agent 可有多个 session（按 task 隔离），通过 `findActiveByConversation()` 按 conversation 查询 |
| Daemon 进程锁 | `(agentId, projectId)` | 同一项目中同一 Agent 只能有一个运行进程 |
| 前端队列 | `agentId:conversationId` | 每个项目的排队消息独立，不会互相干扰 |

**Session 生命周期**：
```
项目创建 + Agent 首次派发
    → session created (status: 'active')
    → CLI 返回 cli_session_id → 回写

后续派发（聊天 / 任务）
    → 查找 active session → 复用 cli_session_id
    → CLI --resume <cliSessionId>

项目归档
    → session sealed (status: 'sealed')
```

**关键点**：
- 任务完成（done/rejected）时 **不再** seal session
- 进程退出失败时 **不再** seal session
- Session 跟随项目生命周期

### E) 队列隔离机制

**问题背景**：之前 `pendingDispatches` 按 `agentId` 做 key，导致跨项目的排队消息共享队列，dequeue 时错乱。

**解决方案**：使用复合 key `agentId:conversationId`。

```typescript
// daemonStore.ts
function queueKey(agentId: string, conversationId: string): string {
  return `${agentId}:${conversationId}`;
}

// 入队
const key = queueKey(agentId, conversationId);
state.pendingDispatches[key].push(entry);

// 出队（在 terminal:exit 或 agent:error 后）
const key = `${agentId}:${conversationId}`;
dequeueNextPending(agentId, conversationId);
```

**前端渲染**：`GlobalChatRoom.tsx` 按 `selectedConversationId` 过滤显示当前项目的队列。

### F) 任务文件同步链路

1. Agent 编辑 `.ath/TASKS.md`（修改状态、认领任务、上报风险）
2. `TaskFileWatcher`（chokidar）检测变更，防抖 500ms
3. `TaskFileService.readTasksMd()` 解析文件
4. DB 同步：不存在 → 创建，已存在 → 更新
5. Socket.IO 广播 `task.sync`
6. Store 更新 → UI 刷新

## 1.4 UI 信息架构

三栏工作台布局：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Header                                   │
│  [项目标题]                                    [+新建] [设置]   │
├──────────┬──────────────────────────────────────┬───────────────┤
│          │                                      │               │
│  项目    │         作战指挥室                    │   Mini        │
│  列表    │  ┌─────────────────────────────────┐ │   Kanban      │
│          │  │ 项目目标 / 拆解状态              │ │               │
│  ──────  │  ├─────────────────────────────────┤ │   代办        │
│          │  │ Agent 条带 (Mario / Coder /     │ │               │
│  项目 A  │  │ Reviewer)                       │ │   ──────      │
│  项目 B  │  ├─────────────────────────────────┤ │               │
│  项目 C  │  │ 聊天区域                        │ │   风险        │
│          │  │ - 用户消息                      │ │   阻塞        │
│          │  │ - Agent 流式响应                │ │               │
│          │  │ - 工具调用事件                  │ │               │
│          │  └─────────────────────────────────┘ │               │
│          │                                      │               │
├──────────┴──────────────────────────────────────┴───────────────┤
│                     Pending Queue (按项目隔离)                   │
└─────────────────────────────────────────────────────────────────┘
```

辅助层：
- 任务详情抽屉
- 新建任务弹窗
- Agent Roster 弹窗
- 设置抽屉（账号、角色卡、Skill）

## 1.5 后端职责

### API 层

| 端点 | 方法 | 职责 |
|------|------|------|
| `/api/state` | GET | 加载全量状态 |
| `/api/mutations` | POST | 写入所有变更 |
| `/api/daemon/init` | GET | 初始化 Socket.IO Daemon |
| `/api/socketio` | WS | WebSocket 通信 |

### Repository 层

| Repository | 职责 |
|------------|------|
| `conversationRepo` | 项目/对话 CRUD |
| `taskRepo` | 任务 CRUD + 状态流转 |
| `messageRepo` | 聊天消息追加 |
| `sessionRepo` | Agent Session 生命周期 |
| `invocationRepo` | 执行记录跟踪 |
| `eventRepo` | 事件日志追加 |
| `dispatchRepo` | Dispatch 队列持久化 |
| `skillRepo` | Skill CRUD + 绑定 |

### Daemon 职责

1. **Session 查找/创建**：`findActiveByConversation(agentId, conversationId)`
2. **Invocation 跟踪**：记录每次执行的状态和 token 用量
3. **Credential 注入**：从 Account 读取 API Key 注入环境变量
4. **Backend 选择**：根据 engine 选择对应的 Agent Backend
5. **事件广播**：统一处理 session/invocation/socket 广播

## 1.6 核心业务对象

| 对象 | 说明 | 持久化 |
|------|------|--------|
| `Conversation` | 项目/战役级上下文 | SQLite |
| `Task` | 执行任务，带 conversationId、phaseId、agentId | SQLite |
| `ChatMessage` | 对话消息，支持 streaming/tool/progress | SQLite |
| `Blocker` | 风险与阻塞项（从 task 数据派生，非独立持久化表） | 运行时 |
| `Account` | 账号与执行认证 | SQLite |
| `RoleCard` | 工程型角色卡，含 CapabilityProfile | SQLite |
| `Skill` | 可复用能力模块 | SQLite |
| `AgentSession` | 会话级执行上下文 | SQLite |
| `Invocation` | 单次执行记录 | SQLite |

## 1.7 架构演进主线

### A) 项目工作台化

从任务板视图演进到"项目 > 指挥室 > 风险面板"三栏工作流。

### B) SQLite 真相源

从 localStorage 主导演进到 SQLite 主导，前端 Store 变成运行时缓存。

### C) Agent Backend 抽象

统一的 Backend 接口，新增引擎只需实现接口：

```typescript
interface AgentBackend {
  execute(prompt: string, opts: ExecuteOptions): AgentRun;
}

interface AgentRun {
  events: AsyncGenerator<AgentEvent>;
  result: Promise<AgentResult>;
  kill: () => void;
}
```

### D) 会话级隔离

Session 粒度从 `(agentId, taskId)` 演进到 `(agentId, conversationId)`：
- 一个项目中一个 Agent 只有一个长期 Session
- 任务派发复用 Session，通过 prompt 注入任务上下文
- 队列使用复合 key `agentId:conversationId` 隔离

### E) Skill 系统

RoleCard（身份）+ Skill（能力）正交设计：
- SQLite 存储：skill、skill_file、agent_skill
- PromptComposer 集成：SkillLayer 注入到 system prompt
- Git 仓库导入

### F) 智能任务分发

DispatchAdvisor 基于 CapabilityProfile 进行匹配：
1. 域关键词匹配
2. 技能匹配
3. 负载感知
4. 禁止动作检查

## 1.8 当前状态

| 状态 | 模块 |
|------|------|
| ✅ 已完成 | 项目工作台 UI、SQLite 持久化、Agent Backend、账号模型、Skill 系统、会话隔离、队列隔离 |
| 🚧 进行中 | 统一集成配置中心、多 runtime 信息架构 |
| 📋 规划中 | 安全与权限边界、渠道/provider/routing policy |

## 1.9 关联文档

- [产品愿景](../../VISION.md)
- [研发路线图](../../ROADMAP.md)
- [规格目录](../../specs/)
- [文档导航](../README.md)
- [架构图](./07-architecture-diagrams.md)
- [决策记录](../../decisions/)
