# 03 — 领域模型与状态仓库（Zustand）

核心状态仓库位于 [`src/store/taskHubStore.ts`](../../src/store/taskHubStore.ts)。它同时承担三类职责：

1. 领域模型定义（Task / Agent / ChatMessage / TaskArtifact 等）
2. 全局状态与 mutation（任务/聊天/Agent roster/终端）
3. Socket.io 事件监听与落库（把后端推送写入 store）

## 3.1 领域模型

### TaskStatus（状态机）

```ts
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'rejected'
  | 'blocked';
```

配套常量：

- `STATUS_LABELS: Record<TaskStatus, string>`
- `STATUS_ORDER: TaskStatus[]`（用于看板排序）

### Agent / Roster

```ts
export type AgentRole = 'planner' | 'worker' | 'reviewer';
export type AgentTheme = 'jean' | 'keqing' | 'zhongli' | 'nahida' | 'albedo' | 'venti';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  roleLabel: string;
  theme: AgentTheme;
  emoji: string;
  isOnline: boolean;
}
```

`AGENT_ROSTER` 是内置静态 roster；`activeAgentIds` 表示当前看板上显示哪些 agents。

### Task

```ts
export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string;
  dependencies: string[];
  artifacts: TaskArtifact[];
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}
```

### ChatMessage

```ts
export interface ChatMessage {
  id: string;
  agentId: string | 'human';
  content: string;
  timestamp: string;
  isApprovalRequest?: boolean;
  referencedTaskId?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  mentions?: string[];
  intent?: 'ideate' | 'execute' | 'review' | 'general';
}
```

## 3.2 Store State（关键字段）

- `activeAgentIds: string[]`
- `tasks: Task[]`
- `chatMessages: ChatMessage[]`
- `terminalLogs: Record<string, string[]>`：按 `agentId` 存储 xterm 可直接写入的字符串片段
- `agentStatus: Record<string, 'idle' | 'busy'>`
- UI 控制：
  - `selectedTaskId: string | null`
  - `isNewTaskDialogOpen: boolean`
  - `isRosterModalOpen: boolean`

## 3.3 Selectors（导出的派生数据）

仓库通过“导出 selector 函数”的方式避免在 store 里返回新数组引用：

- `selectActiveAgents(state)`：从 `AGENT_ROSTER` 中筛出 `activeAgentIds` 对应 agent
- `selectAvailableRoster(state)`：`AGENT_ROSTER` 中未激活的 agent

UI 组件中通常配合 `useShallow` 使用，以减少不必要的渲染。

## 3.4 Mutations（核心业务函数）

### 任务

- `getTasksByAgent(agentId)`：按 agent 过滤任务
- `getTaskById(taskId)`
- `addTask(taskData)`：生成自增 `TASK-xxx`，写入 `createdAt/updatedAt`
- `updateTask(taskId, patch)`
- `updateTaskStatus(taskId, status, reviewNote?)`
- `removeTask(taskId)`：如果删除的是当前选中任务，同时清空 `selectedTaskId`

### Agent roster

- `inviteAgent(agentId)`：加入 `activeAgentIds`
- `dismissAgent(agentId)`：从 `activeAgentIds` 移除（是否允许移除由 UI 侧校验）

### 聊天

- `addChatMessage(msg)`：
  - 用 `@(\w+)` 正则解析 `mentions`
  - 用关键词简易分类 `intent`（brainstorm/design/plan → ideate；implement/execute/build → execute；review/check/audit → review）
  - 生成 `id: msg-${Date.now()}` 与 `timestamp`
- `updateChatMessageStatus(msgId, status)`

### 终端

- `appendTerminalLog(agentId, log)`：追加一段终端输出
- `simulateCliExecution(taskId, command)`：
  - 根据 taskId 找到对应 `agentId`
  - 将该 agent 标为 `busy` 并清空其 `terminalLogs`
  - 向后端 emit：`socket.emit('terminal:start', { taskId, agentId, command })`

## 3.5 Socket 事件监听（前端落库）

store 文件底部直接注册事件监听：

- `terminal:data` → `appendTerminalLog(agentId, data)`
- `agent:event` → `addChatMessage({ agentId, content, referencedTaskId })`（仅处理 `type === 'step_start' || 'message'`）
- `terminal:exit` → 追加退出提示 + `agentStatus[agentId] = idle`

这意味着“后端事件”天然会变成：

后端推送 → store 落库 → UI 组件重渲染。
