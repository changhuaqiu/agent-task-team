# ACP 采纳设计（Agent Client Protocol Adoption）

> 日期：2026-07-14 ｜ 状态：设计稿·待审 ｜ 归属：Agent Task Hub / agent-runtime 抽象层
> 关联：`specs/cli-bridge-layer/`（现有 bespoke 中转层，**本设计 supersede 其 CLI 适配层**）、`architecture/cli-integration.md`（现有架构，需同步）、`docs/superpowers/specs/2026-07-14-context-layering-design.md`（ACP 线之上的上下文层，互补不动）
> 参照（业界，已核对 spec 原文）：[ACP overview.mdx](https://github.com/agentclientprotocol/agent-client-protocol/blob/master/docs/protocol/overview.mdx)、[initialization.mdx](https://github.com/agentclientprotocol/agent-client-protocol/blob/master/docs/protocol/initialization.mdx)、[agentclientprotocol.com](https://agentclientprotocol.com/get-started/introduction)、[npm @agentclientprotocol/sdk](https://www.npmjs.com/package/@agentclientprotocol/sdk)
> 一句话定位：**把框架与具体 agent runtime（claude/opencode/codex/gemini…）的通信，从 N 套 bespoke CLI 适配，切换到 1 个基于官方 ACP SDK 的标准客户端——让 agent team 真正平台无关。**

---

## 0. 背景与目标

诉求：agent team 应"不限于用什么 agent"——框架与具体 agent runtime 之间要有一层标准中间层，使团队**平台无关**（换 runtime 框架零改动；能直接接入任何 ACP agent）。

业界正好有正式开放标准 **ACP（Agent Client Protocol）**——"AI agent 的 LSP"：标准化**客户端 ↔ 编码 agent** 的通信。关键事实（已核对）：**我们用的 runtime（Claude Code / Codex CLI / OpenCode / Gemini CLI）全都原生支持 ACP**（见 [官方 agents 列表](https://agentclientprotocol.com/get-started/agents)、[Vercel AI SDK ACP provider](https://ai-sdk.dev/providers/community-providers/acp)）。

这意味着：当前那套 bespoke 适配（各 parse 一套私有输出格式）**正在重新发明 ACP**；而切换到 ACP 不是引入新依赖，而是对齐 runtime 已经支持的标准。

## 1. 决策：方案 B —— 官方 SDK 全量替换

- 引入官方 `@agentclientprotocol/sdk`，新增 **`AcpBackend implements AgentBackend`** 作为**唯一 backend**。
- **删除** bespoke per-engine backend（`claude.ts`/`opencode.ts`/`codex.ts`）+ factory 的 `switch` + 手维护的 per-engine `CapabilitySet`。
- **保留** `AgentBackend`/`AgentEvent` 内部接口（daemon/ContextManager 依赖，不动）、`CliBridge`（变通用 spawn）、daemon、ContextManager、A2A、编排。
- `CapabilitySet` 从 ACP `initialize` 握手自取；`AgentEvent` 从 ACP `session/update` 映射一次。
- mock backend → mock ACP agent。

**为何 B（非 A 带兜底）**：所有目标 runtime 都原生支持 ACP，全量替换的长期代码量最少、最干净；用户接受"无兜底"代价（见 §10 风险）。

## 2. 业界 ACP 协议事实（核对 spec，非推测）

- **传输**：JSON-RPC 2.0；本地 agent = 子进程 stdio；远程 agent = HTTP / WebSocket。
- **Agent 端方法**（client→agent）：baseline `initialize` / `authenticate` / `session/new` / `session/prompt`；optional `session/load`（需 `loadSession` 能力）/ `session/set_mode`；notification `session/cancel`。
- **Client 端方法**（agent→client）：baseline `session/request_permission`；optional `fs/read_text_file` / `fs/write_text_file`（需 fs 能力）/ `terminal/*`（需 terminal 能力）。
- **流式通知 `session/update`**（agent→client）：携带 message chunks（agent / user / **thought**）、tool calls 与 updates、**plans**、available commands、mode changes。
- **能力自报**：`initialize` response 的 `agentCapabilities = { loadSession, promptCapabilities{image,audio,embeddedContext}, mcpCapabilities{http,sse} }`；client 自报 `clientCapabilities = { fs{readTextFile,writeTextFile}, terminal }`。**未声明 = 不支持。**
- **协议版本**：单一整数 MAJOR 版本；非破坏性演进靠 capabilities。
- **扩展**：`_meta` 自定义数据、`_` 前缀自定义方法、自定义能力。

## 3. 现状：项目已有 ~80%，但 bespoke + CLI-only

现有 agent-runtime 抽象（`specs/cli-bridge-layer/` + `architecture/cli-integration.md`）：`AgentBackend.execute()` 接口、`createBackend(engine)` factory（claude/opencode/codex，gemini/mock 回退 opencode）、`CliBridge`（cross-spawn）、`CapabilitySet`（手维护）、统一 `AgentEvent`、daemon（编排+持久化）。

两道差距：(a) **bespoke 非标准**（自定义接口，非 JSON-RPC ACP）；(b) **CLI-only**（只 spawn 本地 CLI，SDK/API/远程 agent 非一等公民）。

## 4. ACP vs CLI 逐项对比（核对 spec）

| 维度 | 现在（CLI bespoke） | ACP（spec） |
|---|---|---|
| 通信契约 | N 套私有格式（stream-json/ndjson/events） | 1 套 JSON-RPC（`session/prompt` + `session/update`） |
| 能力获知 | 手维护 CapabilitySet（多 ❓待测） | `initialize` 握手 **自报** |
| resume | per-engine（claude✅ codex❌，手填） | `session/load` + `loadSession` 能力自报 |
| 权限 | per-engine flag（`--full-auto` 等） | `session/request_permission` 标准流（agent→client） |
| PTY | per-engine（opencode requiresPty） | `terminal/*` + client `terminal` 能力 |
| 事件丰富度 | text/thinking/tool_use/tool_result/error/done | 同 + **plan** + mode change + available commands |
| 本地/远程 | 仅本地子进程 | **本地 + 远程同协议** |
| 方向性 | 单向（spawn + parse stdout） | **双向**（agent 可回调 client 做 fs/terminal/permission） |

**结论**：对 agent **能力**无差（同 agent）；对框架侧 ACP **覆盖更广且标准化**。唯一风险是 agent 的 ACP *实现* 完整度（经验性，见 §10）。

## 5. 设计 §1 —— 架构（ACP 线）

```
┌─ 框架价值（ACP 线之上，原样保留）─────────────────────────────┐
│  daemon（编排 + 持久化：session/invocation/message/event）   │
│  ContextManager（组装 systemPrompt + userPrompt）            │
│  A2A handoff / 角色卡 / 任务图 / queue                       │
└──────────────────────────────────────────────────────────────┘
        │  daemon 调  AgentBackend.execute(prompt, opts) → AsyncGenerator<AgentEvent>
        │  ← 唯一内部接口，不变
        ▼
┌─ AcpBackend（新 · 唯一 backend，用 @agentclientprotocol/sdk）─┐
│  按 catalog 选 agent（local spawn / remote url）            │
│  initialize 握手 → 取 capabilities                           │
│  发 ContextManager 产出的 prompt/context                     │
│  ACP 事件 → AgentEvent（映射一次）                           │
│  ACP session ↔ agent_session / invocation                   │
└──────────────────────────────────────────────────────────────┘
        │  JSON-RPC over stdio（本地）/ HTTP·WS（远程）
        ▼
   ACP servers: claude / opencode / codex / gemini / copilot / …（本地子进程 或 远程端点）
```

**代码层变化**：删除 `claude.ts`/`opencode.ts`/`codex.ts`、factory `switch`、手维护 per-engine `CapabilitySet`；保留 `AgentBackend`/`AgentEvent`/`daemon`/`CliBridge`（通用化）/`ContextManager`/A2A/编排；`mock` → mock ACP agent。

## 6. 设计 §2 —— 核心契约

### 6.1 `AgentBackend`（保留，内部稳定契约）
```ts
interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): AsyncGenerator<AgentEvent>;
  readonly capabilities: CapabilitySet;
}
```

### 6.2 `AcpBackend`（新，唯一实现）
```ts
class AcpBackend implements AgentBackend {
  constructor(entry: AgentCatalogEntry, clientCaps: ClientCapabilities) {}
  async *execute(prompt, opts): AsyncGenerator<AgentEvent> {
    // 1. 按 entry.transport 连 agent（local spawn / remote url）
    // 2. initialize 握手 → 填 capabilities
    // 3. session/new 或 session/load（resume）
    // 4. session/prompt(prompt) → 流式 session/update → 映射 AgentEvent
    // 5. turn stop → done；回调（permission/fs/terminal）按 §7.2 P1 策略
  }
  get capabilities(): CapabilitySet {}
}
```

### 6.3 ACP `session/update` ↔ `AgentEvent` 映射
| ACP 内容 | AgentEvent |
|---|---|
| message chunk · agent text | `text` |
| message chunk · thought | `thinking` |
| tool call | `tool_use` |
| tool update / result | `tool_result` |
| error | `error` |
| turn stop（`session/prompt` response） | `done` |
| plan / mode change | **P1 忽略（开放：后续扩 AgentEvent 类型）** |

### 6.4 `CapabilitySet` 重定义（从握手自取）
```ts
interface CapabilitySet {
  loadSession: boolean;        // ← agentCapabilities.loadSession
  promptImage: boolean;        // ← promptCapabilities.image
  promptAudio: boolean;        // ← promptCapabilities.audio
  embeddedContext: boolean;    // ← promptCapabilities.embeddedContext
  mcpHttp: boolean;            // ← mcpCapabilities.http
  mcpSse: boolean;             // ← mcpCapabilities.sse
  protocolVersion: number;
  agentInfo: { name: string; title?: string; version: string };
}
```
> 旧 `CapabilitySet`（promptMode/outputMode/supportsResume/supportsModel/supportsSystemPrompt/systemPromptMode/supportsMaxTurns/supportsPermissionMode/requiresPty）**整体废弃**：前两字段被标准化消灭，其余映射到上或由 session/setup 承担。

### 6.5 `AgentCatalog`（取代 factory switch）
```ts
interface AgentCatalogEntry {
  id: string;                          // 'claude' | 'opencode' | 'codex' | 'gemini' | 'my-remote' | ...
  transport: 'local' | 'remote';
  spawn?: { command: string; args: string[] };   // local ACP 启动命令（flag 实测）
  url?: string;                         // remote endpoint
  workspace?: string;                   // local cwd
  authContextId?: string;              // 复用现有账号/凭据
  protocolVersion?: number;            // 默认 1
}
function createBackend(entry: AgentCatalogEntry): AgentBackend {
  return new AcpBackend(entry, defaultClientCapabilities);
}
```

### 6.6 ContextManager 输出 → ACP 衔接
`ContextManager.systemPrompt` → `session/new` 的 context/mode 设置；`ContextManager.userPrompt` → `session/prompt` 消息体。ContextManager 决定**发什么**，AcpBackend 决定**怎么用 ACP 发**——二者解耦。

## 7. 设计 §3 —— transport / 回调 / mock / 迁移

### 7.1 Transport（local / remote 由 catalog 决定，SDK 屏蔽）
- local：`cliBridge.spawnCli(entry.spawn…)` → 子进程；SDK 包 stdin/stdout 为 JSON-RPC。
- remote：`sdk.remoteTransport(entry.url)`（HTTP/WS）。
- 之后 initialize/session 全走同一套 SDK 调用。`CliBridge` 保留但通用化（不再 per-engine）。

### 7.2 agent→client 回调的 P1 策略（行为对齐 CLI，控范围）
| 回调 | P1 策略 |
|---|---|
| `fs/*`、`terminal/*` | initialize 时 **不声明** fs/terminal 能力 → agent 自管文件/终端（同 CLI 今天）；中介/沙箱为后续可选 |
| `session/request_permission` | **自动 grant + 日志**（或接现有权限 UX） |

### 7.3 Mock ACP agent（取代 mock backend）
最小 ACP server stub（`initialize`/`session/new`/`session/prompt` → 按脚本 emit canned `session/update`）；测试里 AcpBackend 连它，走完整 ACP 路径。

### 7.4 迁移分期
| 阶段 | 内容 | 风险 |
|---|---|---|
| **P1 证明** | 引 SDK；建 AcpBackend+映射+catalog+capability 自取+mock；端到端打通 1 个 agent（ACP 模式最干净者，实测后定）；daemon 旗标后路由 | 低 |
| **P2 全迁移** | catalog 补 claude/opencode/codex/gemini；逐个验证 ACP 模式覆盖原 bespoke（resume/systemPrompt/permissions/**maxTurns**/事件完整性） | 中（经验性完整度） |
| **P3 删 bespoke** | 删 claude.ts/opencode.ts/codex.ts + factory switch；CliBridge 留；daemon/ContextManager 全程不动 | 低 |

## 8. 开放项（实现期钉死，不猜）
- **maxTurns**：查 `session-config-options.mdx` 有无标准字段；若无，走 session config `_meta` 或放弃该约束。
- **各 agent 的 ACP 启动命令/flag**（claude/opencode/codex 的 ACP 模式入口）——实测填 catalog。
- **各 agent ACP 实现完整度**（P2 逐个核）。

## 9. 范围与非目标
- **不在本期**：fs/terminal 中介（P1 不声明该能力，留作后续可选红利）；远程 agent 的托管/部署（catalog 支持 remote url，但不建托管平台）；A2A / MCP 协议本身的改动（它们在 ACP 线之上/正交，不动）；ContextManager 改动（互补，不动）。
- **本期**：AcpBackend + AgentEvent 映射 + CapabilitySet 自取 + AgentCatalog + mock agent + 迁移删除 bespoke。

## 10. 风险与缓解
| 风险 | 缓解 |
|---|---|
| 某 agent 的 ACP 模式不完整（漏了原生 CLI 特性） | P2 逐 agent 实测核；方案 B 无兜底是已知代价——若 P2 发现关键缺口，回退到 A（该 agent 临时保留 legacy）作例外 |
| ACP SDK 成熟度 | 官方 SDK（`@agentclientprotocol/sdk`），随 spec 演进；P1 先小范围验证 |
| ACP 启动 flag 未知 | P1 实测各 agent 的 ACP 入口；初值保守填 catalog |
| maxTurns 无标准字段 | 走 `_meta` 或放弃（开放项） |
| 删 bespoke 后 mock/测试断档 | P1 即建 mock ACP agent，测试走完整 ACP 路径 |

## 11. 与现有产出关系
- **`specs/cli-bridge-layer/`**：本设计 **supersede 其"CLI 适配层"与 per-engine CapabilitySet**；`CliBridge`（平台 spawn）保留并通用化；`CapabilityRouter` 降级逻辑映射到 ACP 能力协商。
- **`architecture/cli-integration.md`**：实现期同步——factory 的 per-engine switch → catalog；三 backend → AcpBackend；bridge 模式 → ACP remote transport。
- **`context-layering-design.md`（刚设计）**：在 ACP 线之上，**互补不动**。ContextManager 产出的 prompt 经 AcpBackend 发出。
- **A2A（a2a-possession-contract）/ MCP**：与 ACP 正交，不动。

## 12. 后续
- 本 spec 通过 → writing-plans 出实现计划（按 §7.4 P1/P2/P3 分期）。
- 开发结束后补"今日说明文档"（Why/What/How，见独立任务）——讲清为何切 ACP、切了什么、架构变化、切后效果。
