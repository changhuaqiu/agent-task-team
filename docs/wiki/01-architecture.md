# 01 — 整体架构

## 1.1 形态与边界

本仓库是一个“前端可视化协作看板 + 后端事件/终端流转发器”的组合：

- 前端：Next.js（App Router）+ React，用于展示任务看板、全局聊天室、任务详情抽屉与 Web 终端。
- 后端：Node.js（Express + Socket.io），用于：
  - 接收前端发起的“运行命令/提示词”请求
  - 启动或附加到一个 `opencode` 会话，并把 stdout 转发回前端
  - 尝试解析 stdout 中的 NDJSON 事件，以生成聊天室消息

关键文件：

- 前端入口：[`src/app/page.tsx`](../../src/app/page.tsx)、[`src/app/layout.tsx`](../../src/app/layout.tsx)
- 状态与事件中枢：[`src/store/taskHubStore.ts`](../../src/store/taskHubStore.ts)
- 后端守护：[`backend/server.js`](../../backend/server.js)

## 1.2 运行时拓扑（Ports）

- 前端 Web：`http://localhost:3000`（`pnpm dev`）
- 后端 Socket：`http://localhost:4000`（`node backend/server.js`）
- 外部依赖（可选）：`opencode attach http://localhost:4096`（由后端守护进程固定写死）

## 1.3 核心数据流

### A) 任务/聊天的“黑板式”数据流

1. UI 组件通过 `useTaskHubStore()` 读取 `tasks / chatMessages / terminalLogs / agentStatus` 等状态。
2. UI 触发的操作（新建任务、改状态、发聊天、邀请 Agent）调用 store 中的 mutation 方法（如 `addTask`、`updateTaskStatus`、`addChatMessage`）。
3. 所有组件共享同一个 Zustand store，因此页面布局采用“黑板（Blackboard）”风格：状态写入 → 视图自动更新。

### B) 终端与 Agent 事件流（Socket.io）

1. 前端在模块初始化时连接 Socket：`io('http://localhost:4000')`（见 `taskHubStore.ts`）。
2. 当用户在任务详情中点击 “Run Opencode”，前端调用 `simulateCliExecution(taskId, command)`，向后端发送：

```json
{ "taskId": "TASK-xxx", "agentId": "keqing", "command": "..." }
```

3. 后端收到 `terminal:start` 后：
   - 向前端先发一条“正在 attach”的终端提示
   - `spawn('opencode', ['attach', 'http://localhost:4096'])`
   - 把 `command + '\n'` 写入子进程 stdin
4. 后端将子进程 stdout：
   - 原样（轻度换行处理）转发为 `terminal:data`，用于 xterm.js 渲染
   - 尝试按行 JSON.parse，解析 NDJSON 并转发为 `agent:event`（用于聊天室）
5. 子进程退出后，后端发 `terminal:exit`，前端将 agent 标记为 `idle` 并在终端追加退出码。

## 1.4 领域状态机（TaskStatus）

任务状态机在 `taskHubStore.ts` 以联合类型表达：

- `pending | in_progress | in_review | done | rejected | blocked`

UI 侧：

- 任务卡片/详情通过 `StatusBadge` 渲染状态
- `TaskDetailPanel` 的按钮区提供快速状态跳转（Start / Submit Review / Approve / Reject / Block / Reset）

## 1.5 代码组织约定（本项目实际做法）

- “业务中枢在 store”：任务/聊天/终端状态、mutations、Socket 事件落库都集中在 `src/store/taskHubStore.ts`
- “视图组件尽量纯”：`src/components/task-hub/*` 以消费 store + 渲染 UI 为主
- “后端只做桥接”：`backend/server.js` 只负责进程管理与事件转发，不维护业务实体（任务/聊天/Agent roster 全在前端内存）

## 1.6 关联设计文档（仓库内）

如果你想理解“为什么要这么设计”，可以从这些文档看起：

- 需求与愿景：[`VISION.md`](../../VISION.md)、[`ROADMAP.md`](../../ROADMAP.md)
- 多智能体/看板设计：[`specs/2026-04-29-decentralized-agent-task-hub-design.md`](../../specs/2026-04-29-decentralized-agent-task-hub-design.md)
- 设计与决策记录：[`decisions/`](../../decisions/)
