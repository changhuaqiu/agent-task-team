# 03 — 领域模型与状态仓库（Zustand）

核心状态仓库位于 [`src/store/taskHubStore.ts`](../../src/store/taskHubStore.ts)。

在当前版本里，它不再只是“前端黑板”，而是承担四类职责：

1. 领域模型定义
2. 前端运行态缓存
3. API rehydrate 与 mutation 编排
4. Socket 实时事件接入

## 3.1 核心领域模型

### TaskStatus

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

- `STATUS_LABELS`
- `STATUS_ORDER`

### Agent

当前 `Agent` 已从旧的静态 role 演进为“角色卡 + 账号绑定 + 运行时选择”模型：

```ts
export interface Agent {
  id: string;
  name: string;
  roleCardId: string;
  theme: AgentTheme;
  emoji: string;
  isOnline: boolean;
  cliEngine?: CliEngine;
  accountIds: string[];
}
```

说明：

- `role / roleLabel` 已处于兼容保留状态
- 实际上更推荐由 `roleCardId` 驱动 Agent 能力与身份

### Conversation

`Conversation` 现在就是“项目上下文”：

```ts
export interface Conversation {
  id: string;
  title: string;
  goal: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  projectPath: string;
  breakdownStatus: 'none' | 'in_progress' | 'reviewed' | 'confirmed' | 'no_account';
  createdAt: string;
  updatedAt: string;
}
```

### Task

任务已经从旧版简单列表扩展为项目内任务：

```ts
export interface Task {
  id: string;
  conversationId: string;
  phaseId: string;
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

消息模型已支持更多运行态信息：

- `toolEvents`
- `isStreaming`
- `progressData`
- `artifactPreview`
- `rejectionReason`
- `selectedProposals`

这意味着聊天室已经同时承载：

- 普通对话
- Agent 流式输出
- 工具调用记录
- 进度信息
- 审批 / 拒绝结果

### 其他关键对象

- `Blocker`：项目风险 / 阻塞
- `Account`：账号与认证配置
- `SupervisorOutputEnvelope`：监督者输出
- `InternalEvent`：内部事件流

## 3.2 Store State 的真实结构

当前 store 关键状态不再只有 `tasks/chatMessages`，而是包含多个域：

- 应用与连接：
  - `hasHydrated`
  - `daemonConnection`
  - `enableMockRunner`
  - `daemonRuntimes`
- 工作台上下文：
  - `conversations`
  - `selectedConversationId`
  - `phases`
  - `tasks`
  - `blockersByConversation`
- 聊天与执行：
  - `chatMessages`
  - `terminalLogs`
  - `agentStatus`
  - `eventsByConversation`
- 账号与角色：
  - `accounts`
  - `roleCards`
- UI 控制：
  - `selectedTaskId`
  - `isNewTaskDialogOpen`
  - `isRosterModalOpen`
  - `isSettingsOpen`

## 3.3 Store 不再是唯一真相源

当前的数据生命周期是：

1. 页面初始化时，store 从 `GET /api/state` rehydrate
2. 用户操作通过 store action 触发本地更新
3. store 再调用 `/api/mutations` 写入后端
4. daemon 事件通过 Socket 进入 store

因此 store 更接近：

- 前端运行时缓存
- UI orchestration layer

而不是持久化主数据源。

## 3.4 当前重要方法

### 初始化

- `loadFromServer()`
  - 从 `/api/state` 加载 conversations、tasks、messages、sessions、invocations
- `connectDaemon()`
  - 初始化 daemon 并绑定 socket 事件

### 项目 / 上下文

- `getSelectedConversation()`
- `setSelectedConversationId()`
- conversation 相关创建、更新、删除动作

### 任务

- `getTaskById()`
- `updateTaskStatus()`
- `addTask()`
- `updateTask()`
- `removeTask()`

### 聊天与派发

- `addChatMessage()`
- `dispatchToAgent()`
- 流式消息处理相关方法

### 执行环境

- `refreshRuntimeCatalog()`
- `getAvailableRuntime()`
- 账号与 runtime 检查、配置相关方法

说明：

- 当前 `refreshRuntimeCatalog()` 仍是空实现，尚未形成真正的前端 runtime catalog
- 运行时可用性主要通过 daemon 推送和执行时解析决定，而不是完整的配置中心模型

## 3.5 Socket 事件在当前版本中的作用

store 监听 daemon 推送的实时事件，并将其映射成前端状态：

- `terminal:data`
  - 写入 `terminalLogs`
- `agent:event`
  - 映射到聊天流、tool event、streaming content、进度信息
- `agent:session`
  - 更新执行会话
- `terminal:exit`
  - 更新 agentStatus 与退出信息

这使得“执行输出”不再只是终端文本，也会体现在聊天和持久化记录里。

## 3.6 当前判断

如果要理解这个项目，不能再把 `taskHubStore` 当成简单状态容器看待，而应把它理解为：

- 前端状态机
- API 客户端编排层
- Socket 事件适配层
- 工作台 UI 的统一入口
