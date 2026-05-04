# Agent 厂商无关接口设计

## 背景

当前 agent 引擎逻辑散落在 daemon.ts 的单一大函数中（ENGINE_MAP + handleJsonLine 423 行 if/else）。每新增一个引擎需要修改 daemon 主流程，不同引擎的 CLI 参数构建、stdout 解析、session resume 机制交织在一起。

新增引擎 = 修改 daemon.ts 多处 = 高风险。

参考 Multica 的 `Backend` interface 设计：一个接口 + 独立 Provider 实现文件，daemon 变成薄编排层。

## 目标

1. 新增引擎 = 新增一个文件 + factory 加一行 case，不改 daemon 主流程
2. 引擎协议可单测——喂入 stdout fixture，验证解析结果
3. 事件模型统一——UI 不需要知道有几种引擎在跑
4. Resume 透明化——Store 只传 `resumeSessionId`，不关心 CLI flag 差异

## 不在范围内

- Codex JSON-RPC 双向协议（当前只用 CLI 模式）
- Gemini Backend（无实际使用场景）
- MCP Config 注入
- Blocked Args 过滤（无用户自定义 CLI 参数入口）
- 语义活跃度检测
- Store 侧引擎解析重构（`resolveAgentEngine` / `PROVIDER_TO_ENGINE` 保持原样）

---

## 第 1 节：统一事件模型

### AgentEvent

```typescript
// src/server/agent/types.ts

export type AgentEventType =
  | 'text'         // Agent 文本输出
  | 'thinking'     // 模型思考过程（Claude 专属）
  | 'tool_use'     // 调用工具
  | 'tool_result'  // 工具返回结果
  | 'error'        // 执行错误
  | 'done';        // 执行完成

export interface AgentEvent {
  type: AgentEventType;
  content: string;
  tool?: {
    name: string;
    callId?: string;
    input?: string;    // JSON string of tool input
    output?: string;   // Tool result text（tool_result 专用）
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  sessionId?: string;  // CLI session ID for resume
}
```

### AgentResult

```typescript
export interface AgentResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  output: string;       // 累积文本输出
  error?: string;
  durationMs: number;
  sessionId?: string;
}
```

### 跟现状的对比

| AgentEvent 类型 | 现有对应 | 变化 |
|---|---|---|
| `text` | `type: 'message'` + content 追加 | 字段名统一 |
| `thinking` | 无 | 新增（Claude 支持，OpenCode 不 emit） |
| `tool_use` | `ToolEvent { type: 'tool_use' }` | 增加 callId |
| `tool_result` | 无 | **新增**——用户可看到工具返回了什么 |
| `error` | `ToolEvent { type: 'error' }` | 不变 |
| `done` | `type: 'step_finish'` | 更清晰的语义 |

### 对 Store ToolEvent 的映射

```typescript
// store handler 中
switch (event.type) {
  case 'tool_use':
    toolEvent = { id, type: 'tool_use', label: event.tool.name, detail: event.tool.input };
  case 'tool_result':
    toolEvent = { id, type: 'tool_result', label: event.tool.name, detail: event.tool.output };
  case 'error':
    toolEvent = { id, type: 'error', label: '错误', detail: event.content };
  case 'text':
    appendToStreamMessage(activeId, { content: event.content });
}
```

---

## 第 2 节：Backend 接口

### 接口定义

```typescript
// src/server/agent/types.ts

export interface ExecOptions {
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  timeout?: number;              // ms，0 = 不限时
  resumeSessionId?: string;      // 恢复上次会话
  customArgs?: string[];         // 用户自定义参数
  env?: Record<string, string>;  // 额外环境变量（API Key 等）
}

export interface AgentRun {
  events: AsyncGenerator<AgentEvent>;
  result: Promise<AgentResult>;
}

export interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): AgentRun;
}

export interface BackendConfig {
  executablePath: string;
  env?: Record<string, string>;
}
```

### Daemon 使用方式

从 600 行的 if/else 变成：

```typescript
const backend = createBackend(engine, config);
const { events, result } = backend.execute(prompt, opts);

for await (const event of events) {
  socket.emit('agent:event', { agentId, ...event });
}

const final = await result;
socket.emit('terminal:exit', { agentId, code: final.status === 'completed' ? 0 : 1 });
```

Daemon 变成纯编排层：创建 Backend → 消费事件流 → 转发到 socket。

---

## 第 3 节：Backend 实现

### 文件结构

```
src/server/agent/
├── types.ts            # AgentEvent, AgentResult, ExecOptions, AgentBackend
├── factory.ts          # createBackend(engine, config)
├── opencode.ts         # OpenCodeBackend
├── claude.ts           # ClaudeBackend
└── codex.ts            # CodexBackend
```

### OpenCodeBackend

- 命令：`opencode run <prompt> --format json [--session <id>] [--model <m>]`
- 输出：NDJSON，type 字段为 `text` / `tool_use` / `step_start` / `step_finish` / `error`
- Resume：`--session <sessionId>`
- 认证：环境变量 `OPENCODE_PERMISSION={"*":"allow"}`
- Session ID 提取：从输出事件中 `obj.sessionId` / `obj.session_id` 字段

### ClaudeBackend

- 命令：`claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions [--resume <id>]`
- Prompt 通过 stdin 写入 JSON 格式（不是命令行参数，避免长度限制）
- 输出：NDJSON，type 字段为 `assistant` / `user` / `system` / `result` / `log`
  - `assistant` → content_block_delta (text_delta / input_json_delta / thinking_delta)
  - `user` → tool_result content block
  - `system` → 提取 sessionId
  - `result` → 终态
- Resume：`--resume <sessionId>`
- 环境变量：过滤掉 `CLAUDECODE*` / `CLAUDE_CODE*` 防止嵌套污染

### CodexBackend

- 命令：`codex -q <prompt> --full-auto`
- 当前不支持 resume
- 输出解析待确认（先做最简实现）

### 工厂函数

```typescript
export function createBackend(engine: string, config: BackendConfig): AgentBackend {
  switch (engine) {
    case 'opencode': return new OpenCodeBackend(config);
    case 'claude':   return new ClaudeBackend(config);
    case 'codex':    return new CodexBackend(config);
    default: throw new Error(`Unknown engine: ${engine}`);
  }
}
```

---

## 第 4 节：数据流

### 完整链路

```
CLI stdout（引擎私有格式）
  → Backend.parseStdout()（归一化为 AgentEvent）
    → daemon 转发到 socket（emit 'agent:event'，payload 是 AgentEvent）
      → store handler（映射为 ChatMessage 更新）
        → UI 渲染
```

### Store handler

daemon 直接把 Backend 产出的 AgentEvent 透传给 socket，不再做字段映射。Store handler 变成一个简单 switch：

```typescript
socket.on('agent:event', (event: AgentEvent & { agentId: string }) => {
  const { agentId, type, content, tool, usage, sessionId } = event;
  // sessionId 注册
  // switch(type): text → append content, tool_use → ToolEvent, tool_result → ToolEvent, error → ToolEvent
});
```

### UI 变化

`CliOutputBlock` 新增 `tool_result` 渲染——工具调用行下方可展开显示返回内容。

---

## 第 5 节：迁移策略

渐进式，每个 phase 独立提交和验证：

| Phase | 改动 | 风险 |
|---|---|---|
| 1 | 创建 `types.ts`，定义 AgentEvent + AgentBackend 接口 | 零 |
| 2 | 抽出 `OpenCodeBackend`，搬运 handleJsonLine 的 OpenCode 分支 | 低 |
| 3 | 抽出 `ClaudeBackend`，搬运 Claude 分支 | 低 |
| 4 | 抽出 `CodexBackend`（最简实现） | 低 |
| 5 | 改造 daemon handler，用 createBackend + for await 替代 ENGINE_MAP + wireChild | 中 |
| 6 | 更新 socket agent:event payload + store handler | 中 |
| 7 | 更新 ToolEvent 类型 + CliOutputBlock | 低 |

## 文件清单

| 操作 | 文件 | Phase |
|---|---|---|
| Create | `src/server/agent/types.ts` | 1 |
| Create | `src/server/agent/opencode.ts` | 2 |
| Create | `src/server/agent/claude.ts` | 3 |
| Create | `src/server/agent/codex.ts` | 4 |
| Create | `src/server/agent/factory.ts` | 4 |
| Modify | `src/server/daemon.ts` | 5 |
| Modify | `src/store/taskHubStore.ts` | 6, 7 |
| Modify | `src/components/task-hub/CliOutputBlock.tsx` | 7 |
