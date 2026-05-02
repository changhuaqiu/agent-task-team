# AionUi x Opencode Backend Integration Design

## 1. 核心目标
实现从纯前端 (Zustand Mock) 向“前后端分离 + WebSocket 实时流”架构的演进。借鉴 AionUi 理念，引入独立的 Node.js 后端服务 (Daemon)，用于调度 `opencode` 等真实 CLI 工具，并通过双通道机制将原始 PTY 终端流和结构化 JSON 事件流推送到前端。

## 2. 架构概览

系统拆分为两个独立运行的服务：
1.  **Frontend (Task Hub)**: Next.js + Zustand + xterm.js (端口: 3000)
2.  **Backend (Agent Daemon)**: Express/Fastify + Socket.io + child_process (端口: 4000)

### 2.1 双通道流控 (Dual-Channel Stream)
当用户在前端点击 `[Run CLI]` 时，后端通过 `spawn` 启动 `opencode run --format json`。子进程的标准输出 (`stdout` 和 `stderr`) 会被“分叉”：
*   **通道 A (Raw PTY Stream)**: 直接将接收到的 `Buffer` 转换为字符串，通过 `socket.emit('terminal:data', { taskId, data })` 推送给前端。前端的 `xterm.js` 直接调用 `term.write(data)` 渲染。
*   **通道 B (Parsed Event Stream)**: 后端使用 `readline` 按行读取 `stdout`。尝试解析每行是否为合法的 NDJSON。如果解析成功，识别其事件类型 (`step_start`, `text`, `tool_use`, `step_finish`)，并将其封装为领域事件，通过 `socket.emit('agent:event', payload)` 推送给前端的 `GlobalChatRoom`。

## 3. 后端服务设计 (Agent Daemon)

### 3.1 核心依赖
*   `express`: HTTP 路由（可选，用于初始化的 REST API）。
*   `socket.io`: 提供可靠的双向全双工通信，自带断线重连机制。
*   `cross-spawn`: 跨平台的子进程调用库。
*   `dotenv`: 环境配置管理。

### 3.2 进程管理器 (Process Manager)
*   后端在内存中维护一个 `Map<string, ChildProcess>` (Key 为 `taskId`)，确保每个任务在同一时间只能运行一个 Agent 进程。
*   支持接收前端发来的 `terminal:kill` 事件，强行发送 `SIGTERM` 或 `taskkill` 中止失控的 Agent。

### 3.3 降级策略 (Mock Mode)
考虑到部署环境可能未安装真实的 `opencode` 或缺乏 API Key，后端必须支持**Mock Mode**。
*   在 `process.env.USE_MOCK_CLI=true` 时，`spawn` 的不是真正的 `opencode`，而是一个本地的 `mock-opencode.js` 脚本。
*   该脚本使用 `setTimeout` 循环，输出逼真的 NDJSON 流，甚至模拟偶尔的报错堆栈，以便前端能够测试“失败-重试”链路和聊天室气泡。

## 4. 前端改造 (Task Hub)

### 4.1 Zustand Store 升级
*   移除原有的 `simulateCliExecution` 中的 `setInterval` mock 逻辑。
*   新增 `connectWebSocket(url)` 方法，在 App 初始化时连接到后端的 Socket.io 服务器。
*   注册事件监听器：
    *   `socket.on('terminal:data')`: 将流数据拼接到 `terminalLogs`。
    *   `socket.on('agent:event')`: 拦截事件，如果是 `text`，将其作为聊天消息插入到 `chatMessages` 中。如果是 `tool_use`，可以在聊天室显示“正在调用工具：xxx”。
    *   `socket.on('terminal:exit')`: 更新 `isTerminalRunning[taskId]` 为 false。

### 4.2 API 通信协议
*   **Client -> Server (Events)**
    *   `terminal:start`: Payload `{ taskId: string, command: string, args: string[] }`
    *   `terminal:kill`: Payload `{ taskId: string }`
*   **Server -> Client (Events)**
    *   `terminal:data`: Payload `{ taskId: string, data: string }` (用于 xterm)
    *   `agent:event`: Payload `{ taskId: string, eventType: 'text'|'tool_use'|'error', content: any }` (用于 Chat Room)
    *   `terminal:exit`: Payload `{ taskId: string, code: number }`

## 5. 预期结果
完成此次重构后，Task Hub 的体验将发生质变：
1. 点击任务面板的执行按钮，真实的 Node.js 子进程将在后端启动。
2. 详情面板下方的终端会像黑客帝国一样流式输出包含 ANSI 颜色的日志。
3. 同时，右侧的全局聊天室会像 Clowder 一样，自动冒出 Agent 汇报进度的对话气泡。
4. 架构彻底解耦，为未来接入真正的 OpenClaw 或其他 MCP Agent 扫清了技术障碍。