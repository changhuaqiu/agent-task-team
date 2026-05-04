# Agent Backend 执行链路设计

## Summary

Agent Task Hub 通过 Agent Backend 抽象层对接多种 CLI 引擎（opencode / claude / codex），将各引擎的私有协议归一化为统一的 `AgentEvent` 流。Daemon 作为编排层负责 session 管理、invocation 跟踪和 socket 广播，Backend 只负责"spawn + 解析"。

---

## 1. 架构分层

```
前端 (store)
  │  terminal:start (Socket)
  ▼
Daemon (daemon.ts)
  │  createBackend(engine, config)
  ▼
AgentBackend (interface)
  │  execute(prompt, opts) → AgentRun
  ▼
CLI 进程 (opencode / claude / codex)
```

**关键文件**：

- Daemon 编排：[`src/server/daemon.ts`](../../src/server/daemon.ts)
- Backend 接口：[`src/server/agent/types.ts`](../../src/server/agent/types.ts)
- Backend 工厂：[`src/server/agent/factory.ts`](../../src/server/agent/factory.ts)
- OpenCode 实现：[`src/server/agent/opencode.ts`](../../src/server/agent/opencode.ts)
- Claude 实现：[`src/server/agent/claude.ts`](../../src/server/agent/claude.ts)
- Codex 实现：[`src/server/agent/codex.ts`](../../src/server/agent/codex.ts)

## 2. Backend 接口

```typescript
interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): AgentRun;
}

interface AgentRun {
  events: AsyncGenerator<AgentEvent>;  // 流式事件
  result: Promise<AgentResult>;        // 最终结果
  kill: () => void;                    // 终止进程
}
```

**统一事件类型**：

| type | 含义 | content |
|------|------|---------|
| `text` | Agent 文本输出 | 文本内容 |
| `thinking` | 思考过程（Claude） | 思考内容 |
| `tool_use` | 工具调用 | 工具名 + 输入 |
| `tool_result` | 工具结果 | 输出内容 |
| `error` | 错误 | 错误信息 |
| `done` | 单步完成 | 最终文本 |

**统一结果类型**：

```typescript
interface AgentResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  output: string;
  error?: string;
  durationMs: number;
  sessionId?: string;
  usage?: Record<string, { inputTokens: number; outputTokens: number }>;
}
```

## 3. 各引擎协议适配

### 3.1 OpenCode

**CLI 调用**：`opencode run --format json [--model <m>] [--session <id>] [--prompt <sys>] <prompt>`

**NDJSON 事件映射**：

| opencode type | AgentEvent type | 说明 |
|---------------|-----------------|------|
| `text` | `text` | `part.text` 或 `obj.content` |
| `tool_use` | `tool_use` | `part.tool` + `part.input` |
| `step_finish` | — (仅提取 token) | `part.tokens.input/output` |
| `error` | `error` | `obj.error.name` |
| `step_start` | — (daemon 转发) | 静默 |

**Session ID 提取**：按优先级检查 `obj.sessionID` / `obj.sessionId` / `obj.session_id` / `part.sessionID` / `part.sessionId`。

**环境变量**：
- `OPENCODE_PERMISSION={"*":"allow"}` — 自动批准所有工具调用
- 通过 runtime config 注入 API 凭证

### 3.2 Claude

**CLI 调用**：`claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions`

**stdin 协议**：prompt 作为 stream-json 格式写入 stdin：
```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
```

**stream-json 事件映射**：

| claude type | AgentEvent type | 说明 |
|-------------|-----------------|------|
| `content_block_delta` (text_delta) | `text` | `delta.text` |
| `content_block_delta` (thinking_delta) | `thinking` | `delta.thinking` |
| `content_block_start` (tool_use) | `tool_use` | `content_block.name` |
| `result` | `done` | `obj.result` |
| `system` | — (提取 session_id) | `obj.session_id` |

**特殊处理**：
- 过滤 `CLAUDECODE*` / `CLAUDE_CODE*` 环境变量，防止子进程继承父级状态
- 支持 `--resume <sessionId>` 恢复会话
- 支持 `--max-turns` 限制轮次

### 3.3 Codex

**CLI 调用**：`codex -q <prompt> --full-auto [--model <m>]`

**输出处理**：
- 尝试 JSON 解析每行，失败则作为纯文本处理
- 支持 `type: text` 和 `type: message` 两种格式

## 4. OpenCode Spawn 策略（跨平台）

OpenCode 的 Go 二进制在检测到非 TTY stdout 时会抑制输出（上游已知 bug: `anomalyco/opencode#14948`）。参考外部同类实现对 PTY / pipe 的处理方式后，我们采用三级 fallback 策略：

```
resolveGoBinary() 找到 Go 二进制？
  ├─ YES → Strategy 1: 直接 spawn Go 二进制
  │         绕过 Node.js wrapper 的 spawnSync({ stdio: "inherit" })
  │         stdio: ['ignore', 'pipe', 'pipe']
  │
  └─ NO → Unix + script 命令可用？
           ├─ YES → Strategy 2: script -q /dev/null 包装
           │         提供真实 PTY，Go 看到的是 TTY
           │         stdio: ['ignore', 'pipe', 'pipe']
           │
           └─ NO → Strategy 3: 直接 pipe 走 Node.js wrapper
                     已知有 silent_completion 风险
                     Windows / 无 script 命令时使用
```

### Strategy 1: 直接 spawn Go 二进制

**原理**：opencode 的 Node.js wrapper (`bin/opencode`) 内部使用 `spawnSync(goBinary, args, { stdio: "inherit" })` 调用 Go 二进制。当父进程以 piped stdio 启动 wrapper 时，Go 二进制通过 `stdio: "inherit"` 继承了这些 pipe，但 Go 运行时检测到非 TTY 后可能抑制输出。直接 spawn Go 二进制可以绕过这个中间层。

**实现**：
1. `resolveGoBinary()` 跟踪 symlink 找到 wrapper 的实际路径
2. 在同目录查找 `.opencode`（Unix）或 `opencode.exe` / `.opencode.exe`（Windows）
3. 用 `stdio: ['ignore', 'pipe', 'pipe']` 直接 spawn Go 二进制

### Strategy 2: `script -q /dev/null` PTY 包装

**原理**：macOS / Linux 自带 `script` 命令，可以在伪终端（PTY）中运行命令。Go 二进制看到的是真实 TTY，会正常输出。

**实现**：
```typescript
spawn('script', ['-q', '/dev/null', 'opencode', ...args], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

**注意事项**：
- PTY 输出可能包含 ANSI 转义码，readline 解析前用 `STRIP_ANSI_RE` 清理
- PTY 换行符为 `\r\n`，使用 `crlfDelay: Infinity` 确保 readline 正确解析
- Linux 上 `script` 语法不同（`script -qc "cmd args" /dev/null`），当前仅 macOS 完全支持

### Strategy 3: 直接 pipe 兜底

**适用场景**：Windows 或 `script` 不可用时。

**已知限制**：可能产生 silent_completion（0 text events），这是当前 piped stdio 路径下仍需继续观察的问题。

**Windows 展望**：
- Windows 没有原生 `script` 命令
- 可能的替代方案：`winpty`、`conpty` API、或 `node-pty`
- 当前优先级较低，因为 OpenCode 的 Windows 支持本身也有限

## 5. Daemon 编排流程

```
terminal:start
  │
  ├─ 检查 force / busy 状态
  ├─ 解析 engine (runtimeId → RUNTIME_ENGINE_MAP)
  ├─ resolveCredentialEnv(accountId)
  ├─ Session 查找/创建 (sessionRepo)
  ├─ Invocation 记录 (invocationRepo)
  ├─ Runtime config 生成 (opencode-config)
  │
  ├─ 路径选择：
  │   ├─ opencodeBridgeUrl → Bridge HTTP 模式
  │   ├─ tmuxEnabled → tmux pane 模式
  │   └─ 默认 → Backend 抽象执行
  │
  ├─ createBackend(engine, config)
  ├─ backend.execute(prompt, opts)
  │
  ├─ for await (event of events):
  │   ├─ forwardAgentEvent(event)
  │   │   ├─ 注册 sessionId (agent:session)
  │   │   ├─ 广播到前端 (agent:event)
  │   │   ├─ 写入 messageRepo
  │   │   └─ 重置超时
  │   └─ 更新 invocationRepo
  │
  └─ await result → terminal:exit
```

## 6. 事件格式约定

Daemon 广播的 `agent:event` 格式：

```typescript
{
  taskId: string | undefined;
  agentId: string;
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error' | 'done';
  content: string;
  tool?: { name: string; callId?: string; input?: string; output?: string };
  usage?: { inputTokens: number; outputTokens: number };
  sessionId?: string;
  conversationId: string;  // sessionConvId = conversationId || projectId || 'default'
}
```

前端 store 的 `agent:event` handler 根据 `type` 决定如何展示：
- `text` → 流式追加到聊天消息
- `tool_use` → 工具调用卡片
- `error` → 错误消息
- `done` / step_finish → 完成标记

## 7. Session 管理策略

- 每个 `(agentId, conversationId)` 组合维护一个 active session
- 首次 dispatch 时创建 session，后续复用 `cli_session_id`（由 CLI 返回）
- Session 创建时使用 `nextSeqForAgent()` 避免 `UNIQUE(agent_id, task_id, seq)` 约束冲突
- 切换 conversation 或 seal 旧 session 后，新 dispatch 创建新 session

## 8. 关联文档

- 架构概览：[`docs/wiki/01-architecture.md`](../../docs/wiki/01-architecture.md)
- 多 CLI 集成配置中心：[`docs/technical/integrations/2026-05-01-cli-channel-auth-config-center.md`](../integrations/2026-05-01-cli-channel-auth-config-center.md)
- 参考分析：[`docs/plans/2026-05-02-multica-reference-analysis.md`](../../docs/plans/2026-05-02-multica-reference-analysis.md)
