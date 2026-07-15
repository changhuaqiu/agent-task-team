# Agent Backend 执行链路设计

## Summary

Agent Task Hub 通过 **ACP（Agent Client Protocol）单一通路**驱动所有运行时（opencode / claude / codex），经 `AcpBackend`（`AgentBackend` 的唯一实现）将 ACP `session/update` 归一化为统一的 `AgentEvent` 流。Daemon 作为编排层负责 session 管理、invocation 跟踪和 socket 广播；启动差异只存在于 Agent Catalog，不进入 daemon 分支。

> 历史上曾按引擎分别实现 `OpenCodeBackend` / `ClaudeBackend` / `CodexBackend` 与 `factory.ts` 的 engine `switch`；这些 bespoke backend 已在 ACP 迁移中移除（spec §7 / §8）。当前权威架构见 `architecture/cli-integration.md`。

---

## 1. 架构分层

```
前端 (store)
  │  terminal:start (Socket)
  ▼
Daemon (daemon.ts)
  │  loadCatalog().find(e => e.id === engine) → createAcpBackend(entry)
  ▼
AgentBackend (interface, src/server/agent/types.ts)
  │  execute(prompt, opts) → AgentRun   （唯一实现：AcpBackend）
  ▼
ACP JSON-RPC over stdio
  │
  ▼
运行时（opencode acp 原生 / claude-agent-acp / codex-acp 适配器）
```

**关键文件**：

- Daemon 编排：[`src/server/daemon.ts`](../../src/server/daemon.ts)
- Backend 契约：[`src/server/agent/types.ts`](../../src/server/agent/types.ts)
- 唯一 backend 实现：[`src/server/agent/acp/acpBackend.ts`](../../src/server/agent/acp/acpBackend.ts)
- Catalog（启动事实源）：[`src/server/agent/acp/catalog.ts`](../../src/server/agent/acp/catalog.ts) + [`agentCatalog.seed.json`](../../src/server/agent/acp/agentCatalog.seed.json)
- 事件映射：[`src/server/agent/acp/agentEventMapper.ts`](../../src/server/agent/acp/agentEventMapper.ts)
- 每运行时准备：[`src/server/agent/acp/runtimeSetup.ts`](../../src/server/agent/acp/runtimeSetup.ts)

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

> ⚠️ **已废弃（保留作历史参考；现行架构见 §1 / §5 与 `architecture/cli-integration.md`）**
> 本节描述的 per-engine CLI 直接调用（`opencode run --format json` / `claude -p --output-format stream-json` / `codex -q --full-auto`）及每引擎私有输出解析，已在 ACP 迁移中移除（spec §7 / §8）。当前 agent 执行为 ACP 单一通路：daemon 经 Catalog 查表 → `AcpBackend` → ACP JSON-RPC over stdio 驱动运行时（opencode 原生 `opencode acp` / claude、codex 经 `@agentclientprotocol/*-acp` 适配器）。以下内容仅记录历史协议细节，不再反映当前代码。

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

**项目级 Skill 挂载**：
- Agent Task Team 的 OpenCode 端侧协作规则放在项目内 `.opencode/skills/agent-task-team-collaboration/SKILL.md`
- Daemon 启动 OpenCode 时会在生成的 `OPENCODE_CONFIG` 中加入当前项目的 `.opencode/skills` 到 `skills.paths`
- 这是项目级挂载，不写入 `~/.opencode`，避免把本项目协作规则污染到其他项目
- 因为 Agent 实际执行目录可能是 `.ath/workspaces/...`，不能只依赖 OpenCode 从当前 cwd 自动发现仓库根目录下的 `.opencode/skills`
- 生成配置同时设置 `permission.skill["*"] = "allow"`，让非交互式 dispatch 可以加载项目 Skill

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

> ⚠️ **已废弃（保留作历史参考；现行架构见 §1 / §5 与 `architecture/cli-integration.md`）**
> 本节的三级 Go-binary PTY spawn 策略（`resolveGoBinary()` / `script -q /dev/null` PTY 包装 / pipe 兜底）服务于已移除的 `opencode run` 直接调用路径。ACP 迁移后 daemon 不再直接 spawn opencode CLI 解析 stdout，而是经 `AcpBackend` 走 ACP JSON-RPC over stdio（`requiresPty:false`），本节描述的 PTY/Go-binary 处理不再出现在当前执行链路中。以下内容仅作历史记录保留。

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
  ├─ ACP 通路（agent 执行唯一 backend 路径）：
  │   ├─ loadCatalog().find(e => e.id === engine)（无条目 → 抛错，不回退）
  │   ├─ prepareAcpRuntime(entry, ...)（opencode 写 opencode.json / codex 隔离 CODEX_HOME / claude passthrough）
  │   ├─ tmuxEnabled → tmux pane 模式（可选观察/执行，仍经 ACP backend）
  │   └─ createAcpBackend(entry, opts)
  │
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

## 9. Session Identity（当前实现）

平台把一次 Agent 执行拆成三层身份：

- Logical Agent Session：平台持久化对象；当前以 `(conversationId, agentId)` 作为唯一 active scope。
- Runtime Session：ACP agent 返回的 session id，持久化在 `agent_session.cli_session_id`。
- Invocation：单次执行记录，只引用 Logical Agent Session，无权更换其 Runtime Session。

执行规则：首次执行使用 ACP `session/new`；已有 Runtime Session 时必须在 initialize 后确认 `loadSession` capability，并调用 `session/load`。加载失败、capability 缺失或 update 中 session id 不一致时均失败关闭，不自动降级为新会话。加载阶段可能产生的历史 replay 不进入当前 invocation 的事件流。

Session binding 由服务端 repository 作为唯一事实源。浏览器只显示 `/api/state` 或 socket 返回的已确认绑定，不持久化并回传 session id 参与恢复决策。数据库通过 partial unique index 保证任一时刻每个 `(conversation_id, agent_id)` 最多只有一个 active Logical Agent Session；Runtime Session 第一次绑定使用 compare-and-set，禁止静默覆盖。

真实 runtime 的恢复能力已验证：OpenCode 1.14.35 原生 ACP、Claude adapter 0.59.0、Codex adapter 1.1.2 均可完成跨 adapter 进程的 `session/new → session/load`，并保持 session id 不变。可通过 `ACP_SMOKE_RESUME=1 pnpm exec tsx scripts/smoke-acp-runtime.ts <runtime>` 复验。
