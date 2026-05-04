# 04 — 后端执行链路（API + SQLite + Daemon）

本项目当前后端链路由三部分组成：

- API 层：加载状态与写入 mutation
- SQLite / Repository 层：持久化业务数据
- Daemon 层：执行 CLI、跟踪会话、转发事件

## 4.1 API 层

### `/api/state`

[`src/pages/api/state.ts`](../../src/pages/api/state.ts) 负责页面初始化时的状态加载。

当前返回：

- `conversations`
- `tasks`
- `recentMessages`
- `activeSessions`
- `recentInvocations`

这条接口已经是页面 hydrate 的主要真相源。

### `/api/mutations`

[`src/pages/api/mutations.ts`](../../src/pages/api/mutations.ts) 提供统一 mutation 入口。

当前支持的 mutation 包括：

- conversation create/update/delete
- task create/update/updateStatus/delete
- message append
- session create/update/seal
- invocation create/updateStatus
- event append

这意味着前端大部分结构化写操作都已经可以写入 SQLite，而不是停留在本地 store。

## 4.2 SQLite 与 Repository 层

当前数据库技术栈：

- `better-sqlite3`
- `drizzle-orm`
- `drizzle-kit`

核心目录：

- [`src/server/db`](../../src/server/db)
- [`src/server/repositories`](../../src/server/repositories)

Repository 当前覆盖的核心对象：

- `conversationRepo`
- `taskRepo`
- `messageRepo`
- `sessionRepo`
- `invocationRepo`
- `eventRepo`
- `role_cards` 表：`id TEXT PK, data TEXT NOT NULL, is_preset INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL`，其中 `data` 列以 JSON 存储完整 RoleCard（含 CapabilityProfile）

这层的职责是：

- 提供业务语义的读写接口
- 隔离 SQL / schema 细节
- 作为 API 与 daemon 的共同数据访问层

## 4.3 Daemon 当前职责

[`src/server/daemon.ts`](../../src/server/daemon.ts) 不再只是 stdout 转发器，而是执行编排中心：

- 接收 `terminal:start`
- 解析 engine / runtime / account 上下文
- 查找或创建 agent session
- 创建 invocation 记录
- 选择 Agent Backend
- 转发与持久化执行事件

关键能力：

- session 跟踪
- invocation 跟踪
- account credential 注入
- timeout 管理
- bridge / tmux / 本地 CLI 多路径支持
- 任务创建经过 DispatchAdvisor 步骤，以编程式匹配将任务分配到 agent（基于 capability profiles、当前负载和 forbidden actions）

## 4.4 Socket 事件协议

### 输入事件：`terminal:start`

当前 payload 已明显扩展：

```ts
{
  projectId?,
  taskId?,
  agentId,
  prompt,
  sessionId?,
  conversationId?,
  allowMockRunner?,
  opencodeBridgeUrl?,
  engine?,
  runtimeId?,
  providerProfileId?,
  channel?,
  authContextId?,
  accountIds?,
  accountId?,
  force?
}
```

其中当前实际起主要作用的字段是：

- `agentId`
- `prompt`
- `taskId`
- `conversationId`
- `engine`
- `accountId`
- `opencodeBridgeUrl`
- `force`

### 输出事件

- `terminal:data`
- `agent:event`
- `agent:session`
- `terminal:exit`
- `agent:error`

## 4.5 Agent Backend 抽象

当前 daemon 已将多引擎逻辑从单体 if/else 中抽离。

核心文件：

- [`src/server/agent/types.ts`](../../src/server/agent/types.ts)
- [`src/server/agent/factory.ts`](../../src/server/agent/factory.ts)
- [`src/server/agent/opencode.ts`](../../src/server/agent/opencode.ts)
- [`src/server/agent/claude.ts`](../../src/server/agent/claude.ts)
- [`src/server/agent/codex.ts`](../../src/server/agent/codex.ts)

当前模式：

1. daemon 根据 `engine` 调用 `createBackend()`
2. backend 输出统一 `AgentEvent`
3. daemon 将 `AgentEvent`：
   - 转为 socket 事件
   - 写入 repo
   - 更新 session / invocation

这样新增引擎只需要：

- 增加一个 backend 文件
- 在 factory 里注册

## 4.6 会话与调用追踪

daemon 当前已经具备会话级跟踪：

- `sessionRepo.findActiveByConversation()`
- `sessionRepo.create()`
- `sessionRepo.updateCliSessionId()`
- `sessionRepo.sealByConversation()`

调用级跟踪：

- `invocationRepo.create()`
- `invocationRepo.updateStatus()`

这使系统能记录：

- 某个项目下某个 agent 的会话链
- 每次执行的输入、状态和退出结果

## 4.7 Bridge / 本地 CLI / Mock

当前执行策略仍保留三类路径：

1. Bridge
   - 当 `opencodeBridgeUrl` 存在时优先使用
2. 本地 CLI
   - 通过不同命令执行 `opencode / claude / codex`
3. Mock
   - 用于开发演示与降级路径

`tmux` 也已经作为可选观察/执行模式接入 daemon。

补充说明：

- `gemini` 当前在工厂中仍回退到 `OpenCodeBackend`
- 它不能被视为与 `opencode / claude / codex` 同等级的独立 backend

## 4.8 当前判断

当前后端应被理解为：

- 一个基于 Next.js API 的轻量应用后端
- 一个以 SQLite 为中心的数据持久化层
- 一个支持多引擎执行的 daemon 编排层

不再是旧文档中“前端维护业务，daemon 只负责桥接”的简单结构。
