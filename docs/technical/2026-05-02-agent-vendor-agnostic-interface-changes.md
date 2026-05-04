# Agent 厂商无关接口 — 实施变更总结

> 日期: 2026-05-02
> 关联 Spec: `docs/superpowers/specs/2026-05-02-agent-vendor-agnostic-interface-design.md`
> 关联 Plan: `docs/superpowers/plans/2026-05-02-agent-vendor-agnostic-interface.md`

## 目标

将 agent 引擎逻辑从 daemon.ts 的单体 if/else 中抽离为 Backend 接口 + 独立 Provider 实现。新增引擎 = 新增一个文件 + factory 加一行 case，daemon 主流程零修改。

## 变更清单

### 新增文件

| 文件 | 说明 | Commit |
|---|---|---|
| `src/server/agent/types.ts` | AgentEvent、AgentResult、ExecOptions、AgentRun、BackendConfig、AgentBackend 接口定义 | `a9c28e2` |
| `src/server/agent/opencode.ts` | OpenCode CLI Backend，解析 NDJSON（text/tool_use/step_finish/error），支持 session resume | `671b075` |
| `src/server/agent/claude.ts` | Claude CLI Backend，解析 stream-json（content_block_delta/result/system），支持 session resume，过滤 CLAUDECODE* 环境变量 | `5ffbd2c` |
| `src/server/agent/codex.ts` | Codex CLI Backend，最简实现，JSON 解析 + 纯文本 fallback | `bbe4a94` |
| `src/server/agent/factory.ts` | `createBackend(engine, config)` 工厂函数 | `bbe4a94` |

### 修改文件

| 文件 | 变更 | Commit |
|---|---|---|
| `src/server/daemon.ts` | 移除 ENGINE_MAP + handleJsonLine (423 行)，替换为 `createBackend` + `for await` 事件循环。保留 bridge 模式、tmux 模式、队列、session 跟踪。净减 67 行。 | `a64b242` |
| `src/store/taskHubStore.ts` | 重写 `agent:event` socket handler，适配统一 AgentEvent 格式。ToolEvent 类型新增 `tool_result`，移除 `step_start`/`step_finish`。 | `eb5129b` |
| `src/components/task-hub/ChatMessageItem.tsx` | `hasToolEvents` 过滤器简化为 `toolEvents?.length` | `eb5129b` |
| `src/components/task-hub/CliOutputBlock.tsx` | 移除 `step_finish` 渲染，新增 `tool_result` 绿色结果行渲染，工具计数包含 tool_result | `eb5129b` |

## Commit 历史（按时间顺序）

```
a9c28e2 feat: add AgentBackend interface and unified AgentEvent types
671b075 feat: implement OpenCodeBackend with unified AgentEvent output
93ed532 fix: add usage field to AgentResult, update OpenCodeBackend to report tokens
5ffbd2c feat: implement ClaudeBackend with stream-json protocol
bbe4a94 feat: implement CodexBackend and createBackend factory
a64b242 feat: rewrite daemon handler to use Backend abstraction
eb5129b feat: update store event handler for unified AgentEvent format
```

## 架构变化

### Before

```
daemon.ts (600+ 行)
├── ENGINE_MAP (CLI 参数映射)
├── handleJsonLine (423 行 if/else，按引擎分支解析 stdout)
├── wireChild (进程绑定)
└── 所有引擎的 CLI 构建、输出解析、session resume 交织在一起
```

### After

```
src/server/agent/
├── types.ts         # AgentEvent, AgentResult, AgentBackend 接口
├── factory.ts       # createBackend(engine, config) → AgentBackend
├── opencode.ts      # OpenCodeBackend
├── claude.ts        # ClaudeBackend
└── codex.ts         # CodexBackend

daemon.ts (精简为编排层)
├── forwardAgentEvent()   # 共享事件转发
├── parseAndForwardBridgeLine()  # bridge 模式适配
├── Backend 路径: createBackend → for await → forwardAgentEvent → socket
└── 保留: bridge/tmux/队列/session/timeout
```

## 统一事件模型

| AgentEvent type | 来源 | 用途 |
|---|---|---|
| `text` | 所有 Backend | Agent 文本输出，追加到流式消息 content |
| `thinking` | ClaudeBackend | 模型思考过程（当前跳过不渲染） |
| `tool_use` | 所有 Backend | 工具调用，渲染为 ToolEvent（紫色 active 高亮） |
| `tool_result` | 所有 Backend | 工具返回结果，渲染为 ToolEvent（绿色结果行） |
| `error` | 所有 Backend | 错误信息，渲染为 ToolEvent（红色错误行） |
| `done` | 所有 Backend | 执行完成信号，触发 completeStreamMessage |

## 数据流

```
CLI stdout (引擎私有格式)
  → Backend.execute() (归一化为 AgentEvent AsyncGenerator)
    → daemon forwardAgentEvent() (转发到 socket)
      → store agent:event handler (映射为 ChatMessage 更新)
        → UI ChatMessageItem + CliOutputBlock 渲染
```

## 验证结果

- TypeScript 编译: 通过
- Next.js 构建: 通过
- 单元测试: 261/261 通过
- 向后兼容: 旧消息（无 toolEvents）正常渲染

## 当前限制

- `gemini` 当前在 [`factory.ts`](../../src/server/agent/factory.ts) 中仍回退到 `OpenCodeBackend`
- `mock` 当前也仍回退到 `OpenCodeBackend`
- 因此“厂商无关接口”已经完成了主干抽象，但并不代表所有 engine 都已经有独立 backend 实现

## 新增引擎步骤

1. 创建 `src/server/agent/<engine>.ts`，实现 `AgentBackend` 接口
2. 在 `factory.ts` 的 switch 中添加一个 case
3. 完成 — daemon 和 store 无需修改
