# 04 — 后端守护进程（Express + Socket.io）

后端代码位于 [`backend/server.js`](../../backend/server.js)。它的定位是“终端/事件桥接器”，而不是业务服务：任务/聊天/agent roster 都不落库，完全由前端内存维护。

## 4.1 监听与协议

- 监听端口：`4000`
- 通信协议：Socket.io（WebSocket + fallback）
- CORS：`origin: '*'`（开发友好；生产环境通常需要收敛）

### 输入事件：terminal:start

前端触发 `terminal:start`：

```ts
socket.emit('terminal:start', { taskId, agentId, command })
```

字段含义：

- `taskId`：用于把 agent event 关联到某个任务（聊天室的 `referencedTaskId`）
- `agentId`：用于路由到对应终端视图（按 agent 维度存日志）
- `command`：用户提示词/命令字符串（后端会写入 `opencode attach` 子进程 stdin）

### 输出事件：terminal:data / agent:event / terminal:exit

- `terminal:data`：`{ agentId, data }`，终端原始输出（做了 `\n -> \r\n` 适配）
- `agent:event`：`{ taskId, agentId, type, message }`，用于聊天室消息
- `terminal:exit`：`{ agentId, code }`，用于前端显示退出码并把 agent 标为 idle

## 4.2 进程管理

后端维护一个 `activeProcesses: Map<agentId, childProcess>`：

- 同一个 agent 同时只允许一个活动进程
- 新的 `terminal:start` 会先 kill 旧进程，再 spawn 新进程

## 4.3 Opencode 集成方式（当前实现）

后端固定执行：

```js
const attachUrl = 'http://localhost:4096';
const child = spawn('opencode', ['attach', attachUrl]);
child.stdin.write(command + '\n');
```

注意点：

- `attachUrl` 写死为 `http://localhost:4096`
- 假设本机存在 `opencode` 可执行文件，且已有可 attach 的会话
- 没有使用 PTY：stdout 只是作为普通 stream 读取并转发；因此某些交互式能力受限

## 4.4 NDJSON 事件解析（stdout → chat）

后端对 stdout 逐行 `JSON.parse`，期望其为 NDJSON（每行一个 JSON 对象）。当前处理分支：

- `type === 'text'` → `agent:event message = parsed.content`
- `type === 'tool_use'` → `agent:event message = "🔧 Used tool: ${parsed.part.tool}"`
- `type === 'step_start'` / `type === 'step_finish'` → 固定提示语
- `type === 'error'` → 固定错误提示语

如果某行不是 JSON，则视为普通终端输出，不进入聊天室。

## 4.5 mock-opencode.js（可选）

[`backend/mock-opencode.js`](../../backend/mock-opencode.js) 是一个“模拟 NDJSON + 彩色终端输出”的脚本，用于演示解析效果；当前 `server.js` 未引用它，但可用于本地调试 stdout 解析逻辑。
