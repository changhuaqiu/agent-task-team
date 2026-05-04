---
topics: [architecture, cli, integration]
doc_kind: note
created: 2026-02-26
---

# CLI 集成架构：当前实现

> 更新：2026-05-02

## 概述

当前仓库的 CLI 集成已经从“daemon 内部按引擎写死分支”演进为：

- daemon 负责执行编排、会话跟踪、socket 转发与持久化
- backend 工厂负责按引擎创建具体执行器
- 各 backend 负责把引擎私有输出归一化为统一 `AgentEvent`

当前正式支持的主要 backend：

- `opencode`
- `claude`
- `codex`

当前的兼容 / 回退路径：

- `gemini`：暂时回退到 `OpenCodeBackend`
- `mock`：暂时回退到 `OpenCodeBackend`

因此本文档只描述当前代码里的真实架构，不再描述历史上不存在于本仓库的 `AgentService`、`packages/api/src` 等结构。

## 架构概览

```text
前端 store
  -> socket.emit('terminal:start')
    -> src/server/daemon.ts
      -> createBackend(engine, config)
        -> src/server/agent/<engine>.ts
          -> AsyncGenerator<AgentEvent>
      -> forwardAgentEvent()
        -> socket.emit(...)
        -> messageRepo / eventRepo / invocationRepo / sessionRepo
```

关键文件：

- `src/server/daemon.ts`
- `src/server/agent/factory.ts`
- `src/server/agent/types.ts`
- `src/server/agent/opencode.ts`
- `src/server/agent/claude.ts`
- `src/server/agent/codex.ts`

## 设计原则

### 1. CLI 优先，不走 SDK

当前仍坚持 CLI 子进程模式，主要原因：

1. 复用用户已有 CLI 环境与订阅
2. 保持工具能力、文件操作和 session 语义
3. 将各厂商差异隔离在 backend 内部
4. 让 daemon 聚焦“编排”，而不是理解每个引擎的私有协议

### 2. 统一事件模型

backend 不直接把原始 stdout 交给前端，而是统一产出 `AgentEvent`。

当前主要事件类型：

- `text`
- `thinking`
- `tool_use`
- `tool_result`
- `error`
- `done`

daemon 只消费统一事件，不再直接分支解析每一种 CLI 协议。

### 3. 会话与调用分层

当前区分两层状态：

- `agent_session`
  - conversation 级 / agent 级执行会话
- `invocation`
  - 单次执行记录

这让 session 复用和执行审计可以分开管理。

## 当前执行流程

### 1. 前端发起执行

前端通过 Socket 发送 `terminal:start`，当前 payload 包含：

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

说明：

- 当前真正决定执行路径的仍然是 `engine`、`runtimeId`、`accountId`、`opencodeBridgeUrl`
- `providerProfileId / channel / authContextId` 目前主要是参数预留和透传，不是完整配置系统

### 2. daemon 编排

daemon 的主要步骤：

1. 解析执行上下文
2. 根据 `accountId` 读取账号和凭据
3. 查找或创建 `agent_session`
4. 创建 `invocation`
5. 根据 `engine` 调用 `createBackend()`
6. 消费 backend 输出的 `AgentEvent`
7. 写入 repo 并广播给前端

### 3. backend 执行

每个 backend 都负责：

- 生成 CLI 命令或进程配置
- 解析自身输出协议
- 转换为统一 `AgentEvent`

## 工厂与 backend

当前工厂实现见 `src/server/agent/factory.ts`：

```ts
switch (engine) {
  case 'opencode': return new OpenCodeBackend(config);
  case 'claude':   return new ClaudeBackend(config);
  case 'codex':    return new CodexBackend(config);
  case 'gemini':   return new OpenCodeBackend(config);
  case 'mock':     return new OpenCodeBackend(config);
}
```

这说明当前状态是：

- `opencode / claude / codex`：独立 backend
- `gemini / mock`：尚未独立实现

## 当前各引擎状态

### OpenCode

- backend：`OpenCodeBackend`
- 典型命令：`opencode run <prompt> --format json [--session <id>]`
- 适合处理 NDJSON 风格输出

### Claude

- backend：`ClaudeBackend`
- 典型命令：`claude -p <prompt> --output-format stream-json [--resume <id>]`
- 会产生 `stream-json` 风格事件

### Codex

- backend：`CodexBackend`
- 当前以最简模式接入
- 使用 JSON 解析加纯文本 fallback

### Gemini

- 当前没有独立 backend
- factory 中暂时回退到 `OpenCodeBackend`
- 不能视为与 `claude / codex / opencode` 同等级落地

## 运行时探测

daemon 当前会主动探测的 CLI 只有：

- `claude`
- `codex`
- `opencode`

这意味着：

- 前端并没有完整的统一 runtime catalog
- `gemini` 当前也不在默认探测清单中

## Bridge 与本地 CLI

当前 daemon 支持两类主路径：

### 1. Bridge 模式

- 当 `opencodeBridgeUrl` 存在时优先走 bridge
- daemon 通过 HTTP 调用 `{bridge}/run`
- bridge 输出被逐行解析后再归一化为 `AgentEvent`

### 2. 本地 CLI 模式

- daemon 直接调用本地 `opencode / claude / codex`
- backend 负责各自 stdout/stderr 解析

## 持久化职责

daemon 当前不仅负责“转发”，还负责写入：

- `sessionRepo`
- `invocationRepo`
- `messageRepo`
- `eventRepo`

因此 CLI 集成层现在已经是：

- 执行层
- 观测层
- 审计层

而不是单纯的 stdout 桥接器。

## 当前已知限制

1. `gemini` 未独立实现
2. `mock` 未独立实现
3. 统一 runtime 管理 UI 尚未完成
4. `providerProfileId / channel / authContextId` 仍然主要是参数预留

## 后续建议

1. 为 `gemini` 增加独立 backend
2. 为 `mock` 增加真正的 mock backend
3. 将 runtime 检测、账号映射、backend 能力说明统一回写到配置中心文档
4. 持续保持本文档与 `src/server/agent/*`、`src/server/daemon.ts` 一致
