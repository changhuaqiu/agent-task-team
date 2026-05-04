# 07 — 架构图（基于当前代码）

本页不是抽象愿景图，而是根据当前仓库中的真实代码关系整理出的架构图。

对应代码入口：

- 前端入口：`src/app/ClientHome.tsx`
- 状态编排：`src/store/taskHubStore.ts`
- API：`src/pages/api/state.ts`、`src/pages/api/mutations.ts`
- Socket / daemon：`src/pages/api/socketio.ts`、`src/server/daemon.ts`
- Agent backend：`src/server/agent/*`
- 持久化：`src/server/db/*`、`src/server/repositories/*`
- 账号与凭据：`src/server/accounts-file.ts`、`src/server/credentials.ts`

## 7.1 整体分层图

```mermaid
flowchart TB
  subgraph UI["Frontend / Next.js UI"]
    ClientHome["ClientHome"]
    Workspace["ProjectWorkspace"]
    Settings["SettingsDrawer"]
    TaskPanel["TaskDetailPanel"]
    SkillLibrary["SkillLibrary"]
    MiniKanban["MiniKanban"]
  end

  subgraph Store["Store / Orchestration"]
    TaskHubStore["taskHubStore"]
  end

  subgraph API["Next.js API"]
    StateAPI["GET /api/state"]
    MutationAPI["POST /api/mutations"]
    AccountsAPI["/api/accounts*"]
    SocketAPI["/api/socketio"]
    DaemonInit["/api/daemon/init"]
    SkillAPI["/api/skills*"]
  end

  subgraph AppServer["Application Backend"]
    Repos["Repositories"]
    DB["SQLite / Drizzle"]
    Daemon["Socket.io Daemon"]
    BackendFactory["Agent Backend Factory"]
    FileWatcher["TaskFileWatcher"]
    FileService["TaskFileService"]
  end

  subgraph Engines["Execution Backends"]
    OpenCode["OpenCodeBackend"]
    Claude["ClaudeBackend"]
    Codex["CodexBackend"]
    Bridge["Bridge Client Path"]
  end

  subgraph Storage["Storage"]
    SQLite[".ath/data.db"]
    Accounts[".ath/accounts.json"]
    Credentials[".ath/credentials.json"]
    TasksMd[".ath/workspaces/*/TASKS.md"]
  end

  subgraph External["External Runtime"]
    LocalCLI["Local CLI: opencode / claude / codex"]
    OpencodeBridge["opencode-bridge.mjs"]
  end

  ClientHome --> TaskHubStore
  Workspace --> TaskHubStore
  Settings --> TaskHubStore
  TaskPanel --> TaskHubStore
  MiniKanban --> TaskHubStore

  TaskHubStore --> StateAPI
  TaskHubStore --> MutationAPI
  TaskHubStore --> AccountsAPI
  TaskHubStore --> DaemonInit
  TaskHubStore --> SocketAPI
  TaskHubStore --> SkillAPI

  SkillLibrary --> TaskHubStore

  StateAPI --> Repos
  MutationAPI --> Repos
  SkillAPI --> Repos
  AccountsAPI --> Accounts
  AccountsAPI --> Credentials
  Repos --> DB
  DB --> SQLite

  SocketAPI --> Daemon
  Daemon --> Repos
  Daemon --> BackendFactory
  Daemon --> Accounts
  Daemon --> Credentials
  Daemon --> FileWatcher

  FileWatcher --> FileService
  FileService --> TasksMd
  FileWatcher --> Repos
  FileWatcher -->|task.sync| SocketAPI

  BackendFactory --> OpenCode
  BackendFactory --> Claude
  BackendFactory --> Codex
  Daemon --> Bridge

  OpenCode --> LocalCLI
  Claude --> LocalCLI
  Codex --> LocalCLI
  Bridge --> OpencodeBridge
```

## 7.2 页面初始化与持久化链路

这条链路描述“页面打开后如何恢复状态”。

```mermaid
sequenceDiagram
  participant User as User
  participant UI as ClientHome
  participant Store as taskHubStore
  participant StateAPI as /api/state
  participant Repo as Repositories
  participant DB as SQLite
  participant Socket as /api/socketio
  participant Daemon as daemon

  User->>UI: 打开页面
  UI->>Store: loadFromServer()
  Store->>StateAPI: GET /api/state
  StateAPI->>Repo: 读取 conversations/tasks/messages/sessions/invocations/skills
  Repo->>DB: 查询
  DB-->>Repo: 返回结果
  Repo-->>StateAPI: 聚合状态
  StateAPI-->>Store: JSON state
  Store->>Store: rehydrate 前端运行态（含 skillsMap、agentSkillIds）
  UI->>Store: connectDaemon()
  Store->>Socket: 建立 socket 连接
  Socket->>Daemon: 初始化 daemon 通道
```

## 7.3 用户操作与执行链路

这条链路描述“用户从项目里触发一次 agent 执行”的真实路径。

```mermaid
sequenceDiagram
  participant User as User
  participant UI as TaskDetailPanel / Chat UI
  participant Store as taskHubStore
  participant Socket as /api/socketio
  participant Daemon as daemon
  participant Accounts as accounts.json / credentials.json
  participant SessionRepo as sessionRepo
  participant InvRepo as invocationRepo
  participant Factory as createBackend()
  participant Backend as AgentBackend
  participant CLI as Local CLI / Bridge
  participant MsgRepo as messageRepo + eventRepo

  User->>UI: 点击运行 / 派发任务
  UI->>Store: dispatchToAgent() / simulateCliExecution()
  Store->>Store: 根据账号绑定推导 engine/accountId，ComposeOptions.skills 注入 skill 指令
  Store->>Socket: emit terminal:start
  Socket->>Daemon: terminal:start
  Daemon->>Accounts: 读取账号与凭据
  Daemon->>SessionRepo: 查找或创建 agent_session
  Daemon->>InvRepo: 创建 invocation
  Daemon->>Factory: createBackend(engine, config)
  Factory-->>Daemon: backend 实例
  Daemon->>Backend: execute(prompt, opts)
  Backend->>CLI: spawn 本地 CLI 或调用 Bridge
  CLI-->>Backend: stdout / stderr / stream
  Backend-->>Daemon: AgentEvent 流
  Daemon->>MsgRepo: 持久化消息 / 事件
  Daemon-->>Socket: agent:event / terminal:data / agent:session / terminal:exit
  Socket-->>Store: socket 事件
  Store->>Store: 更新聊天 / 终端 / 状态
  Store-->>UI: 重渲染
```

## 7.3.1 任务文件同步链路

这条链路描述"Agent 编辑 TASKS.md 后看板自动刷新"的路径。

```mermaid
sequenceDiagram
  participant Agent as Agent CLI
  participant FS as .ath/TASKS.md
  participant FW as TaskFileWatcher
  participant TFS as TaskFileService
  participant Repo as taskRepo
  participant Socket as Socket.IO
  participant Store as taskHubStore
  participant UI as MiniKanban

  Agent->>FS: 编辑 TASKS.md（改状态/认领/加风险）
  FW->>FS: chokidar 检测变更（防抖 500ms）
  FW->>TFS: readTasksMd()
  TFS-->>FW: { tasks, blockers }

  loop 每个解析出的任务
    FW->>Repo: getById(taskId)
    alt DB 中不存在
      FW->>Repo: create(task)
    else DB 中已存在
      FW->>Repo: updateStatus / update
    end
  end

  FW->>Socket: emit task.sync { conversationId, tasks, blockers }
  Socket-->>Store: task.sync 事件

  loop 每个同步的任务
    alt store 中不存在
      Store->>Store: 加入 tasks[]
    else store 中已存在
      Store->>Store: 更新 status / agentId
    end
  end

  Store->>Store: openBlocker() 处理新风险
  Store-->>UI: 重渲染看板 + 风险面板
```

## 7.4 存储拓扑

当前项目有两类存储，不应混为一谈：

- 业务主数据：SQLite
- 账号与凭据：JSON 文件

```mermaid
flowchart LR
  subgraph Business["业务数据"]
    Conversations["conversation"]
    Tasks["task"]
    Messages["chat_message"]
    Sessions["agent_session"]
    Invocations["invocation"]
    Events["agent_event"]
    Skills["skill"]
    SkillFiles["skill_file"]
    AgentSkills["agent_skill"]
  end

  subgraph DB["SQLite"]
    DataDB[".ath/data.db"]
  end

  subgraph AccountStorage["账号文件存储"]
    AccountsFile[".ath/accounts.json"]
    CredentialsFile[".ath/credentials.json"]
  end

  subgraph ProjectFiles["项目文件存储"]
    Workspaces[".ath/workspaces/<convId>/.ath/"]
    TasksMdFile["TASKS.md — 任务看板"]
    ProjectMd["PROJECT.md — 项目元数据"]
    ProtocolsMd["PROTOCOLS.md — 流转协议"]
    RolesMd["ROLES.md — 角色定义"]
  end

  Conversations --> DataDB
  Tasks --> DataDB
  Messages --> DataDB
  Sessions --> DataDB
  Invocations --> DataDB
  Events --> DataDB
  Skills --> DataDB
  SkillFiles --> DataDB
  AgentSkills --> DataDB

  Workspaces --> TasksMdFile
  Workspaces --> ProjectMd
  Workspaces --> ProtocolsMd
  Workspaces --> RolesMd
```

## 7.5 当前架构要点

- 前端不是直接读 localStorage，而是先经由 `GET /api/state` rehydrate
- `taskHubStore` 是运行态编排层，不是唯一真相源
- daemon 不只是终端桥接器，还承担 session、invocation、事件落库和 backend 选择
- `opencode / claude / codex` 是当前独立 backend
- `gemini / mock` 仍不是独立 backend
- Bridge 仍可用，但不是当前前台主配置入口
- 账号与凭据当前走文件存储，不走 SQLite
- **Skill System**：正交于 RoleCard 的能力模块层，通过 SkillLayer（Layer 2）注入 systemPrompt，支持 Git 导入与 agent 绑定
- **TaskFileWatcher**：文件驱动同步管道的核心——Agent 写 MD → watcher 解析 → DB 创建/更新 → Socket 广播 → store 刷新。这是"文件即真相源"架构的关键桥梁
- **工具双写**：`task_create` / `task_update_status` 同时写 SQLite 和 TASKS.md，保证两条数据源始终一致
