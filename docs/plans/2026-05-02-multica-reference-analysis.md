# Multica 项目参考分析 & 学习规划

## Summary

对 [multica-ai/multica](https://github.com/multica-ai/multica) 进行全面架构分析，识别与我们项目（Agent Task Hub）的差距和可借鉴点，规划选择性引入策略。

---

## 一、Multica 项目概况

**定位**：开源 AI Agent 管理平台，核心理念 *"Your next 10 hires won't be human"*——将 AI Agent 当作真正的团队成员管理。

**核心能力**：
- 分配 Issue 给 Agent（像分配给同事一样）
- 自主追踪 Agent 进度
- 可复用 Skills 积累（知识复利）
- 支持 10+ 种 Agent 后端（Claude Code, Codex, OpenCode, Gemini, Cursor Agent 等）

**技术栈**：
| 层 | 技术 |
|----|------|
| 前端 | Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui |
| 状态管理 | Zustand (client) + TanStack Query (server) |
| 后端 | Go (Chi router) |
| 数据库 | PostgreSQL 17 + pgvector + SQLc |
| 实时通信 | WebSocket + Redis pub/sub |
| 构建 | Turborepo monorepo (5 packages) |
| 桌面端 | Electron |
| 测试 | Playwright (E2E) + Vitest + Go testing |

---

## 二、架构亮点（5 大学习点）

### 1. 三层包架构（ui → core → views）

```
packages/
├── ui/       → 设计系统原语（shadcn 组件）
├── core/     → 纯业务逻辑（stores, queries, API client）
└── views/    → 功能组件（core + ui 的组合）
```

- Next.js 路由层极薄（2-7 行），直接 export views 包的组件
- Web / Desktop (Electron) 完全复用 views 层
- **与我们的差距**：我们的 `src/components/` 是扁平 domain 划分，缺少 core/views/ui 分层

### 2. 事件驱动架构（Go 后端）

```
Event Bus → WebSocket Hub → Redis Pub/Sub (多节点)
```

- Handler 产生事件 → Bus 广播 → 多 Listener 独立响应
- Redis Relay 支持多节点部署
- 前端双层 handler：全局 fallback (invalidate cache) + 特定 handler (精确更新)
- **与我们的差距**：我们用 Socket.io 直接广播，缺少事件总线抽象

### 3. Skills 系统（知识复利）⭐ 重点学习

- Skills = 带结构化元数据的 Markdown 提示词
- 可从 GitHub URL 导入或本地创建
- 执行时注入 Agent prompt
- 双平面架构：Service Plane (CRUD + 绑定) + Daemon Plane (解析 + 注入)
- **与我们的差距**：我们没有类似 Skills 的知识积累机制

### 4. 生产级任务队列

- 优先级队列（urgent=4, high=3, medium=2, low=1）
- per-agent 并发限制 (max_concurrent_tasks)
- 原子 Claim（SQL unique index 防止重复领取）
- Auto-retry（runtime_offline, timeout 等自动重试）
- Lease/retry（孤儿任务回收）
- **与我们的差距**：我们缺少优先级、并发控制和自动重试

### 5. 极致设计系统 ⭐ 重点学习

- 500+ 行 `docs/design.md`，极严格约束
- 颜色：OKLCh + 语义 Token，禁止硬编码
- 字体：仅 3 种字号 (xs/sm/base)、2 种字重
- 间距：4px 网格，语义化间距
- 理念：*"Restraint is premium"*
- **与我们的差距**：我们有 Tailwind 但缺乏严格设计约束

---

## 三、对比矩阵

| 维度 | Agent Task Hub (我们) | Multica | 评价 |
|------|----------------------|---------|------|
| 前端框架 | Next.js 16 + React 19 | Next.js 16 + React 19 | ✅ 同等 |
| 包管理 | 单体 src/ | Turborepo monorepo (5 packages) | Multica 更模块化 |
| 状态管理 | Zustand 集中 store (1400+ 行) | Zustand + TanStack Query 分层 | Multica 关注点分离更好 |
| 后端 | Node.js (Express 5) | Go (Chi) | Go 并发性能更优 |
| 数据库 | SQLite + Drizzle | PostgreSQL + SQLc + pgvector | Multica 更适合生产部署 |
| 实时通信 | Socket.io | WebSocket + Redis pub/sub | Multica 支持多节点扩展 |
| Agent 调度 | Store 层 dispatch | 独立 Task Queue Service | Multica 有优先级/并发/重试 |
| 设计系统 | Tailwind 自由使用 | 严格 Token 约束 (500+ 行规范) | Multica 一致性更强 |
| 知识积累 | 无 | Skills 系统 | 关键差距 |
| Agent 抽象 | Store 耦合 | Interface 解耦 (Go interface) | Multica 架构更干净 |
| 跨平台 | 仅 Web | Web + Desktop (Electron) | 架构差异 |

---

## 四、规划方向

### P0 - 短期可引入（1-2 周）

#### 4.1 Skills 系统 v1
- **目标**：让 Agent 具备可复用的知识/指令模板
- **参考**：Multica 的 Markdown-based Skills + 双平面架构
- **我们的适配**：
  - Skills 作为 Markdown 文件存储（可在 role-card 基础上扩展）
  - Agent dispatch 时自动注入 skill prompt
  - 支持 import/export
- **详细分析**：见第五节

#### 4.2 设计系统 Token 化
- **目标**：建立严格的 UI Token 约束，防止视觉漂移
- **参考**：Multica 的 500 行 design.md + "克制即高级"
- **我们的适配**：
  - 定义语义色 Token（禁止直接用 Tailwind 色值）
  - 收敛字号/字重/间距到固定 set
  - 写入 `design/design-system.md` 并强制执行
- **详细分析**：见第六节

### P1 - 中期可引入（1-2 月）

#### 4.3 状态管理分层
- Zustand 拆分：client state (Zustand) vs server state (TanStack Query)
- 减少 taskHubStore.ts 的 1400 行集中式状态

#### 4.4 Agent 接口抽象
- 从 Store 中抽出 Agent Engine Interface
- 统一调度入口，解耦 Agent 类型选择与执行逻辑

#### 4.5 任务队列增强
- 优先级支持
- per-agent 并发限制
- 失败自动重试

### P2 - 长期考虑

#### 4.6 Monorepo 重构
- ui → core → views 三层分离
- 为 Desktop/CLI 复用做准备

#### 4.7 事件总线
- 抽象 EventEmitter 层
- 解耦 UI 更新、日志、通知等副作用

---

## 五、Agent 厂商无关接口 深入分析

### 5.1 核心 Interface 设计

Multica 用一个极简的 Go interface 统一了 10+ 种 Agent 后端：

```go
// server/pkg/agent/agent.go
type Backend interface {
    Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}
```

**统一入参** `ExecOptions`：
```go
type ExecOptions struct {
    Cwd                       string
    Model                     string
    SystemPrompt              string
    MaxTurns                  int
    Timeout                   time.Duration
    SemanticInactivityTimeout time.Duration
    ResumeSessionID           string          // 恢复上次会话
    ExtraArgs                 []string        // daemon 级默认参数
    CustomArgs                []string        // per-agent 自定义参数
    McpConfig                 json.RawMessage // MCP server 配置
}
```

**统一出参** `Session`（双 channel 模式：流式消息 + 最终结果）：
```go
type Session struct {
    Messages <-chan Message // 流式事件
    Result   <-chan Result  // 最终结果
}

type Message struct {
    Type      MessageType // "text", "thinking", "tool_use", "tool_result", "status", "error", "log"
    Content   string
    Tool      string
    CallID    string
    Input     map[string]any
    Output    string
    SessionID string
}

type Result struct {
    Status     string // "completed", "failed", "aborted", "timeout", "cancelled"
    Output     string
    Error      string
    DurationMs int64
    SessionID  string
    Usage      map[string]TokenUsage
}
```

### 5.2 工厂模式 + 多 Provider 实现

```go
func New(agentType string, cfg Config) (Backend, error) {
    switch agentType {
    case "claude":    return &claudeBackend{cfg: cfg}, nil
    case "codex":     return &codexBackend{cfg: cfg}, nil
    case "opencode":  return &opencodeBackend{cfg: cfg}, nil
    case "openclaw":  return &openclawBackend{cfg: cfg}, nil
    case "hermes":    return &hermesBackend{cfg: cfg}, nil
    case "gemini":    return &geminiBackend{cfg: cfg}, nil
    // ... 更多
    }
}
```

### 5.3 三种传输协议对比

| Provider | 传输协议 | 协议格式 | 自动审批 |
|----------|---------|---------|---------|
| **Claude** | CLI args + stdin/stdout | `--output-format stream-json` 流式 JSON | `--permission-mode bypassPermissions` |
| **Codex** | JSON-RPC 2.0 over stdio | `initialize` → `thread/start` → `turn/start` | Server-request handler 自动批准 |
| **OpenCode** | CLI args + stdout | `--format json` 单向 JSON 输出 | 环境变量 `OPENCODE_PERMISSION={"*":"allow"}` |

### 5.4 Claude 实现（流式 JSON）

```go
// 关键：协议级 flag 硬编码，用户自定义 args 会被过滤
args := []string{
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
}
cmd := exec.CommandContext(runCtx, execPath, args...)

// stdin 写入 prompt（JSON 格式）
prompt := map[string]any{
    "type": "user",
    "message": map[string]any{
        "role": "user",
        "content": []map[string]string{{"type": "text", "text": prompt}},
    },
}
json.NewEncoder(stdin).Encode(prompt)

// stdout 逐行解析
scanner := bufio.NewScanner(stdout)
for scanner.Scan() {
    var msg claudeSDKMessage
    json.Unmarshal([]byte(scanner.Text()), &msg)
    switch msg.Type {
    case "assistant": handleAssistant(msg, msgCh, &output, usage)
    case "result":    finalStatus = msg.IsError ? "failed" : "completed"
    }
}
```

**关键设计**：
- MCP config 写入临时文件，通过 `--mcp-config` 传入
- Stderr 尾部捕获（V8 abort / Bun panic 等崩溃上下文）
- Blocked args 过滤：防止用户自定义参数破坏 daemon↔agent 通信协议

### 5.5 Codex 实现（JSON-RPC 2.0 双向协议）

```go
// 启动 app-server（stdio 传输）
cmd := exec.CommandContext(runCtx, execPath, "app-server", "--listen", "stdio://")

// 1. 握手
c.request(runCtx, "initialize", map[string]any{
    "clientInfo": map[string]any{"name": "multica-agent-sdk", "version": "0.2.0"},
})

// 2. 创建/恢复 Thread
if opts.ResumeSessionID != "" {
    c.request(runCtx, "thread/resume", ...)
} else {
    c.request(runCtx, "thread/start", ...)
}

// 3. 发送 Turn
c.request(runCtx, "turn/start", map[string]any{
    "threadId": threadID,
    "input":    []map[string]any{{"type": "text", "text": prompt}},
})

// 4. 流式接收 notification
for scanner.Scan() {
    if method := raw["method"]; ok {
        c.handleNotification(method, raw["params"])
    }
}
```

**关键设计**：
- 完整 JSON-RPC 客户端（request/response 关联）
- Server-request handler 自动批准 exec/patch
- Thread 多路复用守卫（忽略非当前 subagent 的 notification）
- 语义活跃度超时（检测 Agent 是否停止推进）
- Fallback：扫描 Codex session JSONL 日志获取 token 用量

### 5.6 OpenCode 实现（单向 JSON）

```go
args := []string{"run", "--format", "json"}
if opts.Model != "" { args = append(args, "--model", opts.Model) }
if opts.SystemPrompt != "" { args = append(args, "--prompt", opts.SystemPrompt) }
cmd.Env = append(env, `OPENCODE_PERMISSION={"*":"allow"}`)

// 解析 JSON 事件
for scanner.Scan() {
    switch event.Type {
    case "text":        handleTextEvent(event, ch, &output)
    case "tool_use":    handleToolUseEvent(event, ch)
    case "step_finish": usage.InputTokens += event.Part.Tokens.Input
    case "error":       finalStatus = "failed"
    }
}
```

### 5.7 Agent 发现机制

Daemon 启动时通过 `exec.LookPath` 发现可用 Agent CLI：

```go
// server/internal/daemon/config.go
agents := map[string]AgentEntry{}

claudePath := envOrDefault("MULTICA_CLAUDE_PATH", "claude")
if _, err := exec.LookPath(claudePath); err == nil {
    agents["claude"] = AgentEntry{Path: claudePath, Model: os.Getenv("MULTICA_CLAUDE_MODEL")}
}
// ... 同理检测 codex, opencode, openclaw, hermes, gemini, pi, cursor, copilot, kimi, kiro

if len(agents) == 0 { return Config{}, fmt.Errorf("no agent CLI found") }
```

发现后注册到 Server：

```go
func (d *Daemon) registerRuntimesForWorkspace(ctx context.Context, workspaceID string) {
    for name, entry := range d.cfg.Agents {
        version, _ := agent.DetectVersion(ctx, entry.Path)
        agent.CheckMinVersion(name, version)  // 版本兼容性检查
        runtimes = append(runtimes, map[string]string{
            "name": displayName, "type": name, "version": version, "status": "online",
        })
    }
    d.client.Register(ctx, map[string]any{
        "workspace_id": workspaceID, "daemon_id": d.cfg.DaemonID,
        "runtimes": runtimes,
    })
}
```

### 5.8 Daemon 任务执行流

```
                    ┌─ ClaimTask (per-agent 并发检查)
                    │
Poll Loop ──────────┼─ handleTask ─────┬─ ReportStart
   ↑ semaphore      │                  ├─ agent.New(provider, config) → Backend
   │ 控制并发       │                  ├─ backend.Execute(prompt, opts) → Session
   │                │                  ├─ executeAndDrain: 流式转发 Message → Server
   │                │                  └─ CompleteTask / FailTask
   │                │
   └─ sleep if no slot
```

`executeAndDrain` 关键逻辑（批量转发流式消息）：

```go
func (d *Daemon) executeAndDrain(ctx, backend, prompt, opts, taskID) {
    session, _ := backend.Execute(ctx, prompt, opts)

    go func() {
        var batch []TaskMessageData
        for msg := range session.Messages {
            batch = append(batch, TaskMessageData{TaskID: taskID, Seq: seq.Add(1), ...})
            if len(batch) >= 20 {
                d.client.ReportTaskMessages(ctx, batch)  // 批量发送（每 20 条）
                batch = batch[:0]
            }
        }
    }()

    result := <-session.Result  // 阻塞等待最终结果
    return result
}
```

### 5.9 关键设计模式总结

| 模式 | 实现 |
|------|------|
| **统一消息流** | 所有 Provider 的私有协议 → 归一化为 `Message{text/thinking/tool_use/tool_result/status/error/log}` |
| **Session 恢复** | Claude: `--resume`；Codex: `thread/resume`；OpenCode: `--session` |
| **错误上下文增强** | Stderr 尾部捕获（崩溃时附加最后 N bytes） |
| **Blocked Args** | 过滤协议关键 flag，防止用户自定义参数破坏通信 |
| **语义活跃度检测** | Codex 专属：检测 Agent 是否停止推进（而非仅超时） |
| **批量消息转发** | 每 20 条一批发送到 Server，减少网络开销 |

### 5.10 对我们的适配建议

我们当前的 Agent Engine 耦合在 Zustand store（`taskHubStore.ts` 1400+ 行），建议：

```typescript
// 1. 定义统一的 Agent Backend Interface
interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): Promise<AgentSession>;
}

interface ExecOptions {
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  timeout?: number;
  resumeSessionId?: string;
  customArgs?: string[];
}

interface AgentSession {
  messages: AsyncIterable<AgentMessage>;  // 流式消息
  result: Promise<AgentResult>;           // 最终结果
}

// 2. 各 Provider 实现
class ClaudeBackend implements AgentBackend { ... }
class OpenCodeBackend implements AgentBackend { ... }
class MockBackend implements AgentBackend { ... }

// 3. 工厂创建
function createBackend(engine: string, config: AgentConfig): AgentBackend {
  switch (engine) {
    case 'claude':    return new ClaudeBackend(config);
    case 'opencode':  return new OpenCodeBackend(config);
    case 'mock':      return new MockBackend(config);
    default:          throw new Error(`Unknown engine: ${engine}`);
  }
}
```

**收益**：
- Store 只负责状态管理，不再关心 "怎么执行"
- 新增 Agent 类型只需实现 `AgentBackend` 接口
- 测试时可用 `MockBackend` 替代真实 Agent
- 为后续 Daemon 架构留出扩展空间

---

## 六、任务队列系统 深入分析

### 6.1 数据模型

```sql
CREATE TABLE agent_task_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    runtime_id UUID,           -- 目标执行 runtime

    -- 状态机
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled')),
    priority INT NOT NULL DEFAULT 0,

    -- 时间戳
    dispatched_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 结果
    result JSONB,
    error TEXT,

    -- Lease & Retry (055 迁移) --
    attempt INT NOT NULL DEFAULT 1,
    max_attempts INT NOT NULL DEFAULT 2,
    parent_task_id UUID REFERENCES agent_task_queue(id),  -- 重试链回指
    failure_reason TEXT,
    last_heartbeat_at TIMESTAMPTZ,

    -- 恢复上下文 --
    session_id TEXT,           -- Agent session ID（用于 resume）
    work_dir TEXT,             -- 工作目录
    force_fresh_session BOOLEAN DEFAULT FALSE,
    trigger_comment_id UUID,
    trigger_summary TEXT,

    -- 关联 --
    chat_session_id UUID,
    autopilot_run_id UUID
);
```

**唯一约束（防止重复排队）**：
```sql
CREATE UNIQUE INDEX idx_one_pending_task_per_issue_agent
    ON agent_task_queue (issue_id, agent_id)
    WHERE status IN ('queued', 'dispatched');
```

### 6.2 状态机

```
queued ──→ dispatched ──→ running ──→ completed
              │              │
              │              └──→ failed ──→ (auto-retry?) ──→ queued (子任务)
              │
              └──→ cancelled
```

| 操作 | 状态转换 | 触发方 |
|------|---------|--------|
| `EnqueueTaskForIssue` | → queued | 用户/Agent/Autopilot |
| `ClaimTask` | queued → dispatched | Daemon poll |
| `StartTask` | dispatched → running | Daemon 开始执行 |
| `CompleteTask` | running → completed | Daemon 执行成功 |
| `FailTask` | dispatched/running → failed | Daemon 执行失败 |
| `MaybeRetryFailedTask` | failed → queued (子任务) | 自动（基础设施错误） |
| `CancelTask` | → cancelled | 用户手动 |

### 6.3 优先级出队（Claim）

```sql
-- ClaimAgentTask: 原子领取
UPDATE agent_task_queue
SET status = 'dispatched', dispatched_at = now()
WHERE id = (
    SELECT atq.id FROM agent_task_queue atq
    WHERE atq.agent_id = $1 AND atq.status = 'queued'
      AND NOT EXISTS (
          -- 同一 agent 在同一 issue 上不能有正在执行的任务
          SELECT 1 FROM agent_task_queue active
          WHERE active.agent_id = atq.agent_id
            AND active.status IN ('dispatched', 'running')
            AND active.issue_id = atq.issue_id
      )
    ORDER BY atq.priority DESC, atq.created_at ASC   -- 优先级高的先出队
    LIMIT 1
    FOR UPDATE SKIP LOCKED                             -- 无锁竞争
)
RETURNING *;
```

**三个关键设计**：
1. **优先级排序**：`ORDER BY priority DESC, created_at ASC`
2. **per-(issue, agent) 串行化**：同一 Agent 在同一 Issue 上不能并行
3. **SKIP LOCKED**：允许多 Daemon 并行 Claim，无锁等待

**优先级映射**：
```go
func priorityToInt(p string) int32 {
    switch p {
    case "urgent": return 4
    case "high":   return 3
    case "medium": return 2
    case "low":    return 1
    default:       return 0
    }
}
```

### 6.4 并发控制

```go
func (s *TaskService) ClaimTask(ctx, agentID) {
    agent, _ := s.Queries.GetAgent(ctx, agentID)
    running, _ := s.Queries.CountRunningTasks(ctx, agentID)

    if running >= int64(agent.MaxConcurrentTasks) {
        return nil, nil  // 没有容量
    }

    task, _ := s.Queries.ClaimAgentTask(ctx, agentID)  // 原子 Claim
}
```

Agent 表定义默认并发数：
```sql
CREATE TABLE agent (
    max_concurrent_tasks INT NOT NULL DEFAULT 1,  -- 默认 1，可配置
);
```

### 6.5 Auto-Retry 机制

**重试分类学**（只重试基础设施错误，不重试 Agent 逻辑错误）：

```go
var retryableReasons = map[string]bool{
    "runtime_offline":  true,   // Daemon 挂了
    "runtime_recovery": true,   // Daemon 重启时孤儿任务恢复
    "timeout":          true,   // 任务超时
    // 不重试："agent_error"（编译失败、模型拒绝等业务错误）
}
```

**重试逻辑**：

```go
func (s *TaskService) MaybeRetryFailedTask(ctx, parent) {
    if parent.Status != "failed" { return nil }
    if !retryableReasons[parent.FailureReason] { return nil }  // 非可重试
    if parent.Attempt >= parent.MaxAttempts { return nil }      // 次数耗尽

    child, _ := s.Queries.CreateRetryTask(ctx, parent.ID)
    return child, nil
}
```

**SQL: 创建重试子任务**：
```sql
INSERT INTO agent_task_queue (
    agent_id, runtime_id, issue_id, status, priority,
    session_id, work_dir,          -- 继承恢复上下文
    attempt, max_attempts, parent_task_id
)
SELECT
    p.agent_id, p.runtime_id, p.issue_id, 'queued', p.priority,
    p.session_id, p.work_dir,   -- 关键：继承上次 session，下次可 resume
    p.attempt + 1, p.max_attempts, p.id
FROM agent_task_queue p
WHERE p.id = $1
RETURNING *;
```

**关键设计**：
- 子任务继承 `session_id`/`work_dir` → 下次执行时可以 resume 上次对话
- `attempt` 递增，`max_attempts` 继承
- `parent_task_id` 回指 → 形成重试链
- Autopilot 任务排除（有自己的重试语义）

### 6.6 Lease 机制（孤儿恢复）

**Daemon 启动时恢复**：

```go
func (h *Handler) RecoverOrphanedTasks(w, r) {
    rows, _ := h.Queries.RecoverOrphanedTasksForRuntime(ctx, runtimeID)
    // 统一走 HandleFailedTasks → MaybeRetryFailedTask
    retried := h.TaskService.HandleFailedTasks(ctx, rows)
}
```

```sql
-- 恢复孤儿任务
UPDATE agent_task_queue
SET status = 'failed', completed_at = now(),
    error = 'daemon restarted while task was in flight',
    failure_reason = 'runtime_recovery'
WHERE runtime_id = $1 AND status IN ('dispatched', 'running')
RETURNING *;
```

**超时清扫器**：

```sql
-- 定时清理超时任务
UPDATE agent_task_queue
SET status = 'failed', completed_at = now(), error = 'task timed out',
    failure_reason = 'timeout'
WHERE (status = 'dispatched' AND dispatched_at < now() - @dispatch_timeout_secs)
   OR (status = 'running' AND started_at < now() - @running_timeout_secs)
RETURNING *;
```

### 6.7 幂等状态转换

**CompleteTask**（竞争安全）：

```sql
-- WHERE status = 'running' 守卫：防止重复完成
UPDATE agent_task_queue
SET status = 'completed', completed_at = now(), result = $2, session_id = $3, work_dir = $4
WHERE id = $1 AND status = 'running'
RETURNING *;
```

```go
func (s *TaskService) CompleteTask(ctx, taskID, result, sessionID, workDir) {
    err := s.runInTx(ctx, func(qtx) {
        t, err := qtx.CompleteAgentTask(ctx, ...)
        // ...
    })
    if err != nil {
        // 幂等：如果已经 finalize，返回已存在的记录
        if existing, lookupErr := s.Queries.GetAgentTask(ctx, taskID); lookupErr == nil {
            if errors.Is(err, pgx.ErrNoRows) {
                return &existing, nil  // 已完成，不报错
            }
        }
    }
}
```

**FailTask**（同样幂等）：
```sql
-- WHERE status IN ('dispatched', 'running') 守卫
UPDATE agent_task_queue
SET status = 'failed', completed_at = now(), error = $2,
    failure_reason = COALESCE($3, 'agent_error'),
    session_id = COALESCE($4, session_id),   -- 崩溃时保留已有 session_id
    work_dir = COALESCE($5, work_dir)
WHERE id = $1 AND status IN ('dispatched', 'running')
RETURNING *;
```

### 6.8 Session 恢复（崩溃上下文保持）

**执行中 Pin Session**：
```sql
-- Agent 执行中上报 session_id 和 work_dir
UPDATE agent_task_queue
SET session_id = COALESCE($2, session_id),
    work_dir = COALESCE($3, work_dir),
    last_heartbeat_at = now()
WHERE id = $1 AND status IN ('dispatched', 'running');
```

**重试时查询上次 Session**：
```sql
-- 找到该 agent 在该 issue 上最近一次完成的 session
SELECT session_id, work_dir FROM agent_task_queue
WHERE agent_id = $1 AND issue_id = $2
  AND status IN ('completed', 'failed')
  AND session_id IS NOT NULL
ORDER BY COALESCE(completed_at, started_at, dispatched_at, created_at) DESC
LIMIT 1;
```

### 6.9 Agent 状态协调

每次任务状态变化后，自动更新 Agent 的聚合状态：

```go
func (s *TaskService) ReconcileAgentStatus(ctx, agentID) {
    running, _ := s.Queries.CountRunningTasks(ctx, agentID)
    newStatus := "idle"
    if running > 0 { newStatus = "working" }
    s.updateAgentStatus(ctx, agentID, newStatus)
}
// 在 CancelTask, CompleteTask, FailTask, HandleFailedTasks 中均调用
```

### 6.10 去重队列

```sql
-- 检查是否已有 pending 任务，避免重复排队
SELECT count(*) > 0 AS has_pending FROM agent_task_queue
WHERE issue_id = $1 AND status IN ('queued', 'dispatched');
```

### 6.11 关键设计模式总结

| 模式 | 实现 |
|------|------|
| **优先级队列** | `ORDER BY priority DESC, created_at ASC` |
| **并发限制** | `max_concurrent_tasks` + `CountRunningTasks` 前置检查 |
| **原子 Claim** | `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` |
| **per-(Issue,Agent) 串行** | `NOT EXISTS` 子查询 + unique index |
| **Auto-Retry** | `CreateRetryTask`，仅对基础设施错误生效 |
| **孤儿恢复** | Daemon 重启时 `RecoverOrphanedTasksForRuntime` |
| **超时清扫** | 定时 `FailStaleTasks`，可配置阈值 |
| **幂等转换** | `WHERE status = 'running'` 守卫 + 已存在记录返回 |
| **Session 恢复** | `session_id`/`work_dir` 跨重试继承 |
| **去重** | `HasPendingTaskForIssue` 前置检查 |

### 6.12 对我们的适配建议

当前我们的任务调度是直接在 Zustand store 中 dispatch，建议逐步引入：

**Phase 1 - 优先级 + 并发控制**：
```typescript
// task-queue.ts
interface TaskQueue {
  enqueue(task: Task, priority: Priority): void;
  claim(agentId: string): Task | null;
  complete(taskId: string, result: TaskResult): void;
  fail(taskId: string, error: string, reason: FailureReason): void;
}

// SQLite 原子操作
const CLAIM_SQL = `
  UPDATE task SET status = 'running', started_at = now()
  WHERE id = (
    SELECT id FROM task
    WHERE agent_id = ? AND status = 'queued'
      AND (SELECT count(*) FROM task WHERE agent_id = ? AND status = 'running') < ?
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  )
  RETURNING *
`;
```

**Phase 2 - Auto-Retry**：
```typescript
const RETRYABLE_REASONS = new Set(['runtime_offline', 'timeout', 'runtime_recovery']);

function maybeRetry(task: Task): Task | null {
  if (!RETRYABLE_REASONS.has(task.failureReason)) return null;
  if (task.attempt >= task.maxAttempts) return null;
  return { ...task, id: uuid(), status: 'queued', attempt: task.attempt + 1,
           parentId: task.id, sessionId: task.sessionId };  // 继承 session
}
```

**Phase 3 - Lease + 孤儿恢复**：
```typescript
// Daemon/bridge 启动时
async function recoverOrphanedTasks(runtimeId: string) {
  const orphans = await db`
    UPDATE task SET status = 'failed', failure_reason = 'runtime_recovery'
    WHERE runtime_id = ${runtimeId} AND status IN ('dispatched', 'running')
    RETURNING *
  `;
  for (const task of orphans) maybeRetry(task);
}

// 定时清扫
setInterval(() => {
  db`UPDATE task SET status = 'failed', failure_reason = 'timeout'
     WHERE status = 'running' AND started_at < now() - interval '30 minutes'`;
}, 60_000);
```

---

## 七、总览：两条学习路径的优先级

| 优先级 | 内容 | 收益 | 工作量 |
|--------|------|------|--------|
| **P0-A** | Agent Backend Interface 抽象 | 解耦 store、可测试、可扩展 | 中（定义 interface + 拆 3 个 provider） |
| **P0-B** | 任务队列优先级 + 并发 | 防止资源争抢、公平调度 | 中（SQLite 原子 claim + priority 字段） |
| **P1** | Auto-Retry + Session 恢复 | 基础设施容错、对话连续性 | 低（在 P0-B 基础上增加 attempt 字段 + 重试逻辑） |
| **P2** | Lease + 孤儿恢复 | 生产级健壮性 | 低（daemon 启动 hook + 定时清扫） |
