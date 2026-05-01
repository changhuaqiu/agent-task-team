# 04 — Daemon（Socket.io + Opencode 执行桥接）

本项目的 daemon 负责“执行 + 事件转发”，不负责业务实体（会话/任务/聊天仍由前端黑板维护与持久化）。

默认实现采用 **Next.js 内置 Socket.io**（无需单独起后端进程）：

- 初始化路由：[`src/pages/api/daemon/init.ts`](../../src/pages/api/daemon/init.ts)
- Socket.io 路由：[`src/pages/api/socketio.ts`](../../src/pages/api/socketio.ts)
- daemon 核心实现：[`src/server/daemon.ts`](../../src/server/daemon.ts)

历史/可选实现：

- 独立 Express daemon：[`backend/server.js`](../../backend/server.js)（仅在需要独立部署 daemon 时使用）

## 4.1 初始化与监听

### 默认路径（Next.js 内置）

- 前端在连接 Socket 前先调用：`GET /api/daemon/init`
- Socket.io path：`/api/socketio`
- 监听端口：复用 Next.js 端口（默认 `3000`）

### 可选路径（独立 Express）

- 监听端口通常为 `4000`（以 `backend/server.js` 实现为准）
- 与 Next 内置路径不建议同时启用（避免端口与协议混淆）

## 4.2 Socket.io 事件协议

### 输入事件：terminal:start

前端发送：

```ts
socket.emit('terminal:start', {
  projectId,
  taskId,
  agentId,
  prompt,
  sessionId,
  allowMockRunner,
  opencodeBridgeUrl,
})
```

字段含义（简述）：

- `taskId`：用于把结构化事件关联到任务（聊天引用）
- `agentId`：用于路由终端输出（按 agent 维度存 log）
- `prompt`：要执行的自然语言指令
- `sessionId`：用于 opencode 会话复用（若存在则传入 `--session`）
- `allowMockRunner`：当系统找不到 `opencode` 时是否允许回退到模拟执行器
- `opencodeBridgeUrl`：启用 Bridge 时，daemon 将执行转发到该 URL

### 输出事件：terminal:data / agent:event / agent:session / terminal:exit

- `terminal:data`：终端输出流（xterm 渲染）
- `agent:event`：从 NDJSON 解析出的结构化事件（用于聊天室/事件流）
- `agent:session`：从 NDJSON 抽取到的会话 id（用于后续复用）
- `terminal:exit`：退出码（用于 UI 标记运行结束）

## 4.3 执行策略（本地 run / Bridge / Mock）

daemon 按优先级选择执行方式：

1. **Bridge 模式（推荐：远程环境调用本机真实 opencode）**
   - 条件：`opencodeBridgeUrl` 存在
   - 行为：HTTP `POST {bridge}/run`（携带 `{prompt, sessionId}`），并把响应 body 作为输出流转发
2. **本地 opencode run**
   - 条件：本环境存在 `opencode`
   - 行为：`spawn('opencode', ['run', prompt, '--format', 'json', '--session', sessionId?])`
3. **Mock Runner（调试/演示）**
   - 条件：找不到 `opencode` 且 `allowMockRunner=true` 或 `ENABLE_MOCK_RUNNER=1`
   - 行为：执行内置 mock runner（用于演示输出/事件解析链路）

## 4.4 NDJSON 事件解析

daemon 对输出逐行尝试 `JSON.parse`，识别的主要类型：

- `text`：抽取 `part.text` 或 `content` 作为聊天消息
- `tool_use`：记录工具使用提示（用于观测执行过程）
- `step_start / step_finish`：记录阶段性提示
- `error`：记录错误摘要

同时会从输出中抽取 `sessionId/sessionID`（含 `part.*` 兜底），并 emit `agent:session` 供前端持久化。

## 4.5 安全与认证（规划建议）

当前实现偏开发态友好，需要在生产化前补齐最小安全措施：

- 收敛 CORS（仅允许受信 origin）
- Bridge URL 的输入校验与安全策略（已做“禁止 localhost/内网 URL”的基础校验；建议增加 token）
- 对关键执行事件增加鉴权（例如 bearer token），避免任何人可直接触发执行
