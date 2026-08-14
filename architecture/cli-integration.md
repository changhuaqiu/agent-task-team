---
topics: [architecture, cli, integration, acp]
doc_kind: note
created: 2026-02-26
---

# Agent 执行集成架构：ACP 统一接入

> 更新：2026-07-15

## 概述

当前仓库的 agent 执行集成已经从“daemon 内部按引擎写死分支 + 每引擎一套私有 CLI 解析 backend”演进为 **ACP（Agent Client Protocol）单一通路**：

- daemon 负责执行编排、会话跟踪、socket 转发与持久化
- daemon 通过 **Agent Catalog** 查表确定如何启动目标运行时（不再有 engine `switch` 工厂）
- **`AcpBackend`** 是 `AgentBackend` 契约的**唯一实现**，通过 ACP JSON-RPC over stdio 驱动运行时
- 各运行时的差异（原生 vs 适配器、启动参数、版本）只存在于 Catalog，不进入 daemon 分支

当前支持的三个运行时（均通过 ACP 接入）：

- `opencode`（原生 ACP，`opencode acp`）
- `claude`（ACP 组织适配器，`npx -y @agentclientprotocol/claude-agent-acp@0.59.0`）
- `codex`（ACP 组织适配器，`npx -y @agentclientprotocol/codex-acp@1.1.2`）

> **迁移已完成**：历史上按引擎分别实现的 `OpenCodeBackend` / `ClaudeBackend` / `CodexBackend`、`factory.ts` 的 engine `switch`、`gemini` / `mock` 回退到 `OpenCodeBackend` 的路径，以及 `AGENT_BACKEND` 迁移旗标，均已移除。daemon 当前是 ACP-only，不存在 legacy 并行路径。详见 `specs/acp-runtime-integration/spec.md` 与归档计划 `docs/archive/`。

本文档描述当前代码里的真实架构。

## 架构概览

```text
前端 store
  -> socket.emit('terminal:start')
    -> src/server/daemon.ts
      -> loadCatalog().find(e => e.id === engine)   // Catalog 查表，无 switch
      -> prepareAcpRuntime(entry, ...)              // 每运行时文件系统/环境准备
      -> createAcpBackend(entry, ...)               // 构造 AcpBackend（唯一实现）
      -> backend.execute(prompt, opts)              -> AgentBackend 契约
                                                    -> AcpBackend
                                                    -> ACP JSON-RPC over stdio
                                                    -> 运行时（opencode acp / 适配器）
      -> forwardAgentEvent()
        -> socket.emit(...)
        -> messageRepo / platform event log / invocationRepo / sessionRepo
```

更细粒度的协议层流向（见 spec §4）：

```text
daemon / dispatch / A2A / ContextManager
                    │
                    ▼
           AgentBackend（内部稳定契约，src/server/agent/types.ts）
                    │
                    ▼
              AcpBackend（唯一实现，src/server/agent/acp/acpBackend.ts）
                    │
          ACP JSON-RPC over stdio
          ┌─────────┼──────────┐
          ▼         ▼          ▼
   opencode acp  claude-      codex-acp
    （原生）     agent-acp    （适配器）
                    │          │
                    ▼          ▼
             Claude Code    Codex App Server
              OAuth 认证    (CODEX_HOME 隔离)
```

框架只理解 ACP 与内部 `AgentEvent`。启动差异只存在于 Catalog，不进入 daemon 分支。

关键文件：

- `src/server/daemon.ts` — 编排、Catalog 查表、事件转发与持久化
- `src/server/agent/types.ts` — `AgentBackend` 契约、`AgentEvent`、`AgentRun`
- `src/server/agent/acp/acpBackend.ts` — 唯一 backend 实现
- `src/server/agent/acp/catalog.ts` — `loadCatalog()` + `createBackend(entry)`
- `src/server/agent/acp/agentCatalog.seed.json` — Catalog 启动事实源
- `src/server/agent/acp/agentEventMapper.ts` — ACP `SessionUpdate` → `AgentEvent`
- `src/server/agent/acp/runtimeSetup.ts` — `prepareAcpRuntime()` 每运行时准备
- `src/server/agent/cliBridge.ts` — `spawnCli`（cross-spawn，Windows .cmd/.bat 安全）
- `src/server/agent/with-done-guarantee.ts` — 保证 `done` 事件最终发出

## 设计原则

### 1. ACP 统一通路，不再 per-engine 解析

坚持 ACP over stdio 模式，主要原因：

1. 用一套标准协议驱动所有运行时，停止在 daemon 中长期维护三套私有 CLI 输出解析。
2. 复用用户已有的运行时环境与订阅（见下文“原生 vs 适配器”）。
3. 将各运行时差异隔离在 Catalog 与 `AcpBackend` 内部。
4. 让 daemon 聚焦“编排”，不理解每个运行时的私有协议。

### 2. 统一事件模型

`AcpBackend` 不把原始 stdout 交给前端，而是把 ACP `session/update` 通知映射为统一 `AgentEvent`（`agentEventMapper.ts`，spec §5.3）。

映射表：

| ACP 事件 | 内部 `AgentEvent` |
| --- | --- |
| `agent_message_chunk`（text） | `text` |
| `agent_thought_chunk`（text） | `thinking` |
| `tool_call` | `tool_use` |
| `tool_call_update` | `tool_result` |
| `user_message_chunk` / `plan*` / `available_commands_update` / `session_info_update` / `usage_update` 等 | 安全忽略（返回 `null`，不抛错） |
| 未知 / 未来 `sessionUpdate` | 记录 warning 并安全忽略 |
| `PromptResponse`（stop） | `done`（含 stop reason） |
| transport / 协议错误 | `error` |

daemon 只消费统一事件，不再分支解析每一种 CLI 协议。

### 3. 会话与调用分层

当前区分两层状态：

- `agent_session` — conversation 级 / agent 级执行会话
- `invocation` — 单次执行记录

这让 session 复用和执行审计可以分开管理。

## Catalog：启动事实源

Catalog（`src/server/agent/acp/agentCatalog.seed.json`）是启动事实源（spec §5.1）。daemon 不再按 engine 写 `switch`，而是查表得到运行时的启动方式、交付方式与固定版本。

三个条目：

| id | delivery | launcher | 说明 |
| --- | --- | --- | --- |
| `opencode` | 原生（native） | `opencode acp` | OpenCode 自带 ACP server |
| `claude` | 适配器（adapter） | `npx -y @agentclientprotocol/claude-agent-acp@0.59.0` | ACP 组织维护，基于 Claude Agent SDK；复用主机 Claude Code OAuth，**非** Claude Code CLI 原生 ACP |
| `codex` | 适配器（adapter） | `npx -y @agentclientprotocol/codex-acp@1.1.2` | ACP 组织维护，内部启动 Codex App Server；复用 ChatGPT OAuth + 隔离 `CODEX_HOME`，**非** Codex CLI 原生 ACP |

约束：

- 适配器版本锁定（`package` + `version`），不使用未记录版本的隐式漂移。
- 能力以 ACP `initialize` 握手与实测 smoke 为准，不按运行时名称猜测。
- daemon ingress 只接受受支持且相互匹配的 engine/runtime；完全省略时才采用 OpenCode 默认值，未知显式值直接拒绝。daemon 在启动 ACP 前再次要求账号已启用、验证为 `valid`，且非空密钥、模型、必要 Base URL 与目标 engine 全部匹配。Google、Kimi、OpenCode、Other API Key 账号通过显式 OpenCode provider/model 配置进入 `opencode` Catalog 条目，其连接验证也运行同一配置下的 OpenCode，不再调用旁路厂商 CLI。只有 Anthropic/OpenAI 保留 ACP Adapter 可消费的主机 OAuth。

## 原生 vs 适配器

- **原生（opencode）**：运行时自带 ACP server，直接 `opencode acp` 启动，进程树只有一层。
- **适配器（claude / codex）**：通过 ACP 组织维护的适配器接入。适配器是额外依赖，**不能**在产品或技术文档中描述成厂商 CLI 的原生 ACP 能力。
  - `npx -y` 的包参数包含精确版本；Catalog 加载时校验元数据版本与实际参数一致，禁止“元数据锁定但执行 latest”。
  - 进程树是两层（`npx` → node 适配器 → 运行时），因此 `AcpBackend` 的进程清理使用 `tree-kill`，而不是裸 `child.kill()`。
  - 适配器的认证由主机提供：claude 复用 Claude Code OAuth（`~/.claude/`），codex 复用 ChatGPT OAuth（`CODEX_HOME` 下的 `auth.json`）。

## AcpBackend 职责

`AcpBackend`（spec §5.2）是 `AgentBackend` 的唯一实现，职责包括：

1. 经 `spawnCli`（cross-spawn，Windows .cmd/.bat 安全）启动 ACP agent 子进程。
2. ACP 协议握手：`initialize` → `session/new` → `prompt`。**必须先 `initialize` 再 `session/new`**——codex-acp / claude-agent-acp 适配器强制此顺序，违反会返回 JSON-RPC `-32603`。
3. 消费 `session/update` 通知，经 `agentEventMapper` 映射为 `AgentEvent`，直到收到 stop 消息。
4. 处理 `requestPermission`：默认拒绝；只有显式 `ACP_PERMISSION_MODE=allow_once` 或注入策略才选择单次授权，策略错误/超时继续拒绝。
5. 进程清理：调用方取消/超时先发送 ACP `session/cancel`，再按宽限期执行 TERM → KILL；一次性 finalize 保证 result 不依赖 child `close` 才能解析。
6. 用 `withDoneGuarantee` 包装事件流，保证 `done` 事件最终发出。
7. 基于原因的关闭语义：`kill()` → `cancelled`，超时 → `timeout`，其他异常退出 → `failed`，并携带稳定 `reasonCode`；进程退出绝不会被判为 `completed`。
8. 资源上限：全局并发 run、待消费事件、单事件字符、累计流式字符和 stderr tail 均为有界；消费者提前停止读取会主动取消运行。

返回 `AgentRun { events, result, kill }`：`events` 是 `AgentEvent` 的 `AsyncGenerator`，`result` 是一次性 resolve 的 `Promise<AgentResult>`，`kill` 是幂等的取消函数。

## 每运行时准备（prepareAcpRuntime）

`runtimeSetup.ts` 的 `prepareAcpRuntime(entry, opts)` 在 spawn 前做文件系统 / 环境准备（无 spawn 副作用）：

- **opencode**：主机默认模型 `zhipuai-coding-plan/glm-4.7` 只产 thought、不产 text，因此在隔离临时目录写 fallback config（默认 `deepseek/deepseek-chat`）并通过 `OPENCODE_CONFIG` 注入，不修改项目 cwd。若调用方已设置 `OPENCODE_CONFIG`，账号配置优先。
- **codex**：隔离 `CODEX_HOME`——在临时目录复制必要的 `~/.codex/auth.json` + `config.toml`，返回 `cleanup` 在 turn 结束后清理。codex-acp 经 `CODEX_HOME` 读取 ChatGPT OAuth 认证。
- **claude**：passthrough（认证来自主机 Claude Code OAuth 或 `ANTHROPIC_API_KEY`），无 cwd 配置、无 env 覆盖。

## 能力事实与执行参数

三种运行时只有 ACP 通路，能力事实由 Catalog 的 `verifiedCapabilities`、ACP `initialize` 握手和兼容测试共同证明。daemon 构造一次 `ExecOptions` 并直接交给 `AcpBackend.execute()`；不再维护已恒等化的手工 `CapabilitySet` 或运行前降级器。

已有 runtime session id 时 `AcpBackend` 使用 `session/load`，运行时握手未声明 `loadSession` 则失败关闭；system prompt、cwd/env 与 timeout 同样通过稳定执行契约传入，不按 runtime 名称猜测或静默丢弃。

## 当前执行流程

### 1. 前端发起执行

前端通过 Socket 发送 `terminal:start`，payload 包含 `agentId`、`prompt`、`engine`、`accountId`、`taskId`、`conversationId` 等。真正决定 ACP 路径的是 `engine`（用于在 Catalog 中查表）与 `accountId`（用于账号与凭据）。

### 2. daemon 编排

daemon 的主要步骤：

1. 解析执行上下文（engine / runtime / account）
2. 根据 `accountId` 读取账号和凭据
3. 查找或创建 `agent_session`，创建 `invocation`
4. `loadCatalog().find(e => e.id === engine)`——找不到条目直接抛错（不静默回退）
5. `prepareAcpRuntime(entry, ...)` 做文件系统 / 环境准备
6. `createAcpBackend(entry, ...)` 构造 backend
7. `backend.execute(prompt, opts)`，消费 `AgentEvent` 流
8. 写入 repo 并广播给前端

### 3. backend 执行

`AcpBackend` 负责 spawn、ACP 握手、事件映射、权限占位、进程清理与结果 resolve（见上 文“AcpBackend 职责”）。

## 持久化职责

daemon 不仅负责“转发”，还负责写入：

- `sessionRepo`
- `invocationRepo`
- `messageRepo`
- 历史 `agent_event` 不再通过独立 `eventRepo` 暴露；当前事件事实统一由 Platform Event Log 与消息投影承担。

因此执行集成层现在已经是：执行层 + 观测层 + 审计层，而不是单纯的 stdout 桥接器。

## 延迟项与已知限制（坦诚记录）

以下能力本期**未实现**，属于后续迭代：

1. **人工确认权限策略**：deny 与显式 `allow_once` 已实现；需要浏览器/操作者参与的 confirm profile 尚未接入。
2. **模型规范化**：model ID 跨运行时不通用（如 codex 的 `openai/x` + `reasoning_effort`）；ContextManager → ACP 的模型选择按运行时规范化是开放项。ACP `PromptRequest` 无 model 字段，模型须经各运行时自身配置层注入（见 opencode 的 `opencode.json`）。

平台 MCP 已落地：daemon 为每次 Invocation 创建 loopback-only、短期 bearer grant，并把随机 server 名与允许工具注入 ACP 的 `session/new` 和 `session/load`；turn 完成后立即撤销。具体权限边界见 [`docs/technical/execution/four-agent-pr-review-loop.md`](../docs/technical/execution/four-agent-pr-review-loop.md)。

## 后续建议

1. 在现有 fail-closed 权限策略上接入需要操作者参与的 confirm profile。
2. 推进跨运行时模型规范化。
3. 持续保持本文档与 `src/server/agent/acp/*`、`src/server/daemon.ts` 一致。
