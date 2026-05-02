# CLI 基础设施升级执行计划

> **Status**: ready | **Created**: 2026-05-01
> **参考**: clowder-ai CLI 集成对比分析 + F089/F162 spec
> **原则**: 快速迭代，每步可独立验证，不做大重构

---

## 现状快照

| 文件 | 问题 |
|---|---|
| `src/server/daemon.ts` | 硬编码 `opencode`，无超时，直接 `child.kill()`，stderr 透传 |
| `bridge/opencode-bridge.mjs` | 仅代理 opencode，协议简单（`POST /run {prompt}`） |
| `src/components/task-hub/TerminalView.tsx` | 日志回放器，非真实 PTY |
| `src/store/taskHubStore.ts` | `terminal:exit` 事件处理粗糙，无超时感知 |
| `backend/daemon.js` | CJS 旧版，与 daemon.ts 并存 |

---

## Phase 0: 错误处理标准化（基础设施，~1h）

> 所有后续 Phase 的共同基础。先让错误"可见可分"。

### 0.1 daemon.ts stderr 隔离

**目标**: stderr 不再透传给前端 xterm，改为内部日志 + 结构化错误事件

**改什么**:
- `src/server/daemon.ts` — `child.stderr.on('data')` 改为：
  - 内部 `console.error('[cli:stderr]', ...)` 保留调试
  - 不再 `socket.emit('terminal:data', { data: stderrStr })`
  - 改为 `socket.emit('agent:error', { agentId, message: sanitizedMessage })`（sanitized = 不含 raw stderr）

**验证**: 启动 daemon，运行一个会输出 stderr 的 CLI，确认前端 xterm 不再显示 stderr，但 `agent:error` 事件能触发

### 0.2 标准化错误对象

**目标**: 前后端共享错误类型

**改什么**:
- `src/server/daemon.ts` — 定义错误事件结构：
  ```ts
  // 错误事件结构（与 clowder 的 __cliError / __cliTimeout 对齐）
  interface CliExitEvent {
    __cliError: true;
    exitCode: number | null;
    signal: string | null;
    message: string;        // sanitized, 用户可读
    command: string;
    reasonCode?: string;    // 'timeout' | 'spawn_failed' | 'not_found' | undefined
  }
  ```
- `terminal:exit` 事件补充 `reasonCode` 字段
- 已知错误分类：
  - `ENOENT` → `reasonCode: 'not_found'`
  - 超时 → `reasonCode: 'timeout'`（Phase 1 加入）
  - 非零退出 → `reasonCode: undefined`（普通退出码）

**验证**: 杀掉 opencode 进程，确认 `terminal:exit` 带有正确的 `reasonCode`

### 0.3 前端错误分类显示

**目标**: 不同错误类型不同样式

**改什么**:
- `src/store/taskHubStore.ts` — `socket.on('terminal:exit', ...)` handler 根据 `reasonCode` 更新 Blocker 的 `type`：
  - `'not_found'` → `type: 'execution_failure'`, reason: "CLI 未找到"
  - `'timeout'` → `type: 'timeout'`, reason: "执行超时"
  - 其他 → 保持现有逻辑
- `src/components/task-hub/StatusBadge.tsx` — 可选：超时 blocker 显示黄色

**验证**: 手动触发 ENOENT（设置错误路径），确认 Blocker 正确创建

---

## Phase 1: 进程生命周期管理（~2h）

> 解决"Agent 卡死无人知"的核心问题。

### 1.1 优雅退出（SIGTERM → grace → SIGKILL）

**目标**: 不再直接 `child.kill()`

**改什么**:
- `src/server/daemon.ts` — 替换所有 `child.kill()` 为 `gracefulKill(child)`：
  ```ts
  const KILL_GRACE_MS = 3_000;
  function gracefulKill(child: ChildProcess): void {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    child.on('exit', () => clearTimeout(timer));
  }
  ```
- `terminal:kill` 事件（前端主动取消）也走 `gracefulKill`

**验证**: 启动一个长时间运行的 CLI，前端点取消，确认先 SIGTERM 再 SIGKILL（观察 stderr 日志）

### 1.2 超时控制

**目标**: CLI 运行超过配置时间自动终止

**改什么**:
- `src/server/daemon.ts` — 在 `terminal:start` handler 中加入超时：
  ```ts
  const TIMEOUT_MS = Number(process.env.CLI_TIMEOUT_MS || 300_000); // 5min default
  let timeoutTimer: ReturnType<typeof setTimeout>;
  const resetTimeout = () => {
    clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      gracefulKill(child);
      socket.emit('agent:error', { agentId, message: `执行超时 (${Math.round(TIMEOUT_MS/1000)}s)` });
    }, TIMEOUT_MS);
  };
  // 每次收到 stdout/stderr 数据时 resetTimeout()
  ```
- Store 新增 `opencodeBridge.timeoutMs` 配置项（Settings 中可调）

**验证**: 设置 `CLI_TIMEOUT_MS=10000`（10s），启动 CLI，确认 10s 后自动终止并 emit 错误

### 1.3 前端超时计时器

**目标**: 用户能看到 Agent 已运行多久

**改什么**:
- `src/store/taskHubStore.ts` — `activeRunsByAgent` 扩展：
  ```ts
  activeRunsByAgent: Record<string, {
    runId: string;
    taskId?: string;
    conversationId: string;
    startedAt: string;       // ISO timestamp
  } | undefined>;
  ```
- `src/components/task-hub/TaskCard.tsx` 或 `AgentTaskGroup.tsx` — busy Agent 显示运行时长（如 "运行中 2:35"）
- `terminal:exit` 事件 → 清除计时

**验证**: 启动 Agent，确认卡片上显示递增计时器

---

## Phase 2: CLI 引擎抽象（~2h）

> 解耦 opencode 硬编码，为多 CLI 支持打基础。

### 2.1 CliEngine 配置

**目标**: Agent 可配置使用哪个 CLI 引擎

**改什么**:
- `src/store/taskHubStore.ts` — Agent 接口扩展：
  ```ts
  interface Agent {
    // ... existing fields
    cliEngine?: 'opencode' | 'claude' | 'codex' | 'mock';  // 默认 'opencode'
  }
  ```
- `AGENT_ROSTER` 中每个 Agent 可配 `cliEngine`
- Settings Drawer 新增全局默认引擎选择

### 2.2 daemon.ts 引擎路由

**目标**: `terminal:start` 根据 engine 字段选择不同的命令和参数

**改什么**:
- `src/server/daemon.ts` — 新增引擎映射：
  ```ts
  const ENGINE_MAP: Record<string, { command: string; buildArgs: (prompt: string, sessionId?: string) => string[] }> = {
    opencode: {
      command: 'opencode',
      buildArgs: (p, s) => ['run', p, '--format', 'json', ...(s ? ['--session', s] : [])],
    },
    claude: {
      command: 'claude',
      buildArgs: (p, s) => ['-p', p, '--output-format', 'stream-json', ...(s ? ['--resume', s] : [])],
    },
    codex: {
      command: 'codex',
      buildArgs: (p) => ['-q', p, '--full-auto'],
    },
    mock: {
      command: process.execPath,
      buildArgs: (p) => [join(process.cwd(), 'backend', 'mock-opencode.js')],
    },
  };
  ```
- `terminal:start` payload 新增 `engine` 字段
- `dispatchToAgent` 传递 `engine` 从 Agent 配置

### 2.3 Bridge 协议升级

**目标**: Bridge 支持多引擎

**改什么**:
- `bridge/opencode-bridge.mjs` — `POST /run` body 新增 `engine` 字段
- Bridge 端也使用 ENGINE_MAP 路由
- `GET /health` 返回已安装的引擎列表

**验证**:
1. Settings 中选择不同引擎
2. 给不同 Agent 配不同引擎
3. Bridge 模式下切换引擎正常工作

---

## Phase 3: MCP Server 雏形（~3h）

> 独立包，零侵入主应用，让外部 AI 工具可以操作看板。

### 3.1 项目结构

```
mcp-server/
  package.json          # @agent-task-hub/mcp-server, bin: "ath-mcp"
  tsconfig.json
  src/
    index.ts            # 入口, StdioServerTransport
    tools/
      task-tools.ts     # create_task, update_status, list_tasks, get_task
      agent-tools.ts    # invite_agent, dismiss_agent, get_status
      conversation-tools.ts  # list_conversations, get_messages
    transport.ts        # HTTP callback transport (调 Hub API)
```

### 3.2 工具定义

**Task Tools** (优先):
| 工具 | 参数 | 行为 |
|---|---|---|
| `create_task` | `{ title, description, agentId, priority }` | POST Hub API 创建任务 |
| `update_task_status` | `{ taskId, status }` | POST Hub API 更新状态 |
| `list_tasks` | `{ status?, agentId? }` | GET Hub API 查询任务 |
| `dispatch_to_agent` | `{ agentId, prompt, taskId? }` | POST Hub API 派发任务 |

**Agent Tools**:
| 工具 | 参数 | 行为 |
|---|---|---|
| `invite_agent` | `{ agentId }` | POST Hub API |
| `list_active_agents` | `{}` | GET Hub API |

### 3.3 Transport 层

**目标**: MCP Server 通过 HTTP 调 Hub 的 Next.js API routes

**方案**:
- MCP Server 是独立进程（`npx @agent-task-hub/mcp-server --hub-url=http://localhost:3000`）
- 所有工具通过 `fetch(`${hubUrl}/api/mcp/...`)` 调用 Hub
- Hub 端新增 `/api/mcp/*` routes（thin wrapper，复用现有 store 逻辑）

### 3.4 Hub API Routes

**改什么**:
- `src/app/api/mcp/tasks/route.ts` — POST 创建任务, GET 列表
- `src/app/api/mcp/tasks/[taskId]/route.ts` — PATCH 更新状态
- `src/app/api/mcp/agents/route.ts` — POST invite, GET list
- `src/app/api/mcp/dispatch/route.ts` — POST 派发

> 注意：当前 Hub 是纯 Zustand (客户端状态)，没有服务端持久化。MCP routes 需要：
> 1. 要么在 server-side 用 Zustand 的 initial state（不可行，数据在客户端 localStorage）
> 2. 要么 MCP 直接操作 Socket.IO（调 daemon 的 `terminal:start`）
>
> **推荐 Phase 3 简化方案**: MCP Server 通过 Socket.IO client 直连 daemon，不经过 Hub API。这样完全零侵入。

### 3.5 简化后的 Transport

```
mcp-server (stdio) ← Claude/Codex CLI
    ↓ Socket.IO client
daemon.ts (port 4000)
    ↓ emit 'terminal:start'
opencode/claude/codex
```

MCP 工具行为：
- `dispatch_to_agent` → `socket.emit('terminal:start', {...})`
- `list_tasks` / `list_agents` → Hub 暂不可查（返回 "not available"），后续 Hub 加服务端持久化后补全
- `create_task` → 同上，Phase 3 只做 dispatch 能力

**验证**:
1. `npx @agent-task-hub/mcp-server --daemon-url=http://localhost:4000`
2. 在 Claude Code 中挂载该 MCP server
3. `dispatch_to_agent({ agentId: "jean", prompt: "hello" })` → 看板 Agent Jean 开始运行

---

## Phase 4: tmux 终端集成（~4h，参考 F089）

> 这是最大的改动，依赖 Phase 1-2 完成。

### 4.1 TmuxGateway 基础

**改什么**:
- 新增 `src/server/tmux-gateway.ts` — 参考 clowder 的 `TmuxGateway`，但精简：
  - `ensureServer(worktreeId)` — 创建/检查 tmux server
  - `createPane(worktreeId, opts)` — 创建 pane
  - `sendKeys(worktreeId, paneId, text)` — 发送命令
  - `capturePane(worktreeId, paneId)` — 捕获内容
  - `killPane(worktreeId, paneId)` — 终止 pane
  - `destroyServer(worktreeId)` — 销毁 server

### 4.2 Agent 在 tmux 里跑

**改什么**:
- `src/server/daemon.ts` — `terminal:start` 改为：
  1. `tmuxGateway.createPane(worktreeId, { command: cliCommand })`
  2. node-pty attach 到该 pane → WebSocket → xterm.js（人类侧）
  3. pipe-pane tee → FIFO → NDJSON 解析（机器侧，复用现有 handleJsonLine）
- 新增 `src/app/api/terminal/[worktreeId]/[paneId]/ws/route.ts` — WebSocket 端点

### 4.3 前端 TerminalView 升级

**改什么**:
- `src/components/task-hub/TerminalView.tsx` — 从日志回放改为 WebSocket attach：
  - 连接 `ws://host/api/terminal/${worktreeId}/${paneId}/ws`
  - 使用 `@xterm/addon-attach` 直接 attach WebSocket
  - 去掉 `terminalLogs` 依赖（不再需要 Zustand 中转）

### 4.4 Pane 列表 + 崩溃现场

**改什么**:
- 新增 `AgentPaneList` 组件 — 显示所有 tmux pane（agent + 用户 shell）
- 点击 pane → 切换 TerminalView attach 到该 pane
- `remain-on-exit` 保留崩溃现场

**验证**:
1. 启动 Hub，确认 tmux server 创建成功
2. 派发任务，确认 Agent 在 tmux pane 里运行
3. 浏览器终端看到实时输出
4. 杀掉 CLI，确认 pane 保留现场（`remain-on-exit`）

---

## 执行顺序与依赖

```
Phase 0 (错误处理) ─────────────────────────────┐
                                                 ├─→ Phase 2 (引擎抽象) ──→ Phase 4 (tmux)
Phase 1 (进程生命周期) ──────────────────────────┘
                                                 └─→ Phase 3 (MCP)
```

- **Phase 0 + Phase 1 可并行**（无依赖）
- **Phase 2 依赖 Phase 1**（超时逻辑需要生命周期基础设施）
- **Phase 3 依赖 Phase 2**（MCP dispatch 需要引擎抽象）
- **Phase 4 依赖 Phase 2**（tmux 路由需要引擎映射）

## 快速迭代节奏

| Sprint | 内容 | 预估 | 交付物 |
|---|---|---|---|
| Sprint 1 | Phase 0 全部 | 1h | stderr 隔离 + 错误分类 + 前端样式 |
| Sprint 2 | Phase 1.1-1.2 | 1h | 优雅退出 + 超时控制 |
| Sprint 3 | Phase 1.3 + Phase 2.1-2.2 | 2h | 计时器 + 引擎抽象 + 路由 |
| Sprint 4 | Phase 2.3 + Phase 3 | 3h | Bridge 升级 + MCP Server 雏形 |
| Sprint 5 | Phase 4 | 4h | tmux 终端集成 |

**Sprint 1-2 可以当天完成，Sprint 3 第二天，Sprint 4-5 后续迭代。**

---

## 不做的事（明确排除）

1. **不做 tmux 的进程树可视化**（F089 Phase 3 `pidtree` + `pidusage`）— 复杂度高，收益低，后续按需
2. **不做 Hub 服务端持久化** — MCP Server 先直连 daemon，不经过 Hub API
3. **不做 Windows 兼容** — 当前项目 macOS/Linux 优先
4. **不做 `livenessProbe` CPU 采样** — clowder 的 F118 过度工程化，超时 + 心跳足够
5. **不做 stdin 双向通信** — F089 Phase 4 远期，不在本轮
