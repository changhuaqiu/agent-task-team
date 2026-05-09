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
- RoleCard 现包含可选 `capabilities` 字段（`CapabilityProfile`），作为第 8 维度描述：
  - `domains`：擅长领域列表
  - `skills`：技能标签
  - `seniority`：资历等级
  - `maxConcurrentTasks`：最大并行任务数

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
  breakdownStatus: 'none' | 'proposal' | 'confirmed' | 'no_account';
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
  - 角色卡可持久化到 `role_cards` SQLite 表（JSON `data` 列存储完整 RoleCard）
  - 配套查询函数：`upsertRoleCard`、`loadAllRoleCards`、`deleteRoleCard`
- Skill 能力模块：
  - `skillsMap: Record<string, SkillSummary>`
  - `agentSkillIds: Record<string, string[]>`
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

### Team Runtime Cache

当前团队身份、执行资料和协作策略不再由 store 自己拼装。store 只负责把 rehydrate 得到的 Conversation、TeamPack、RoleCard、Account、Skill 和 agent 绑定传入 `src/lib/team-runtime/`，再缓存解析结果用于 UI 和派发。

关键规则：

- `getEffectiveRoster()` 委托 `resolveTeamRuntime()`。没有 TeamPack 时返回 preset agents；有 TeamPack 时以 TeamPack roles 为第一事实源，并为旧 UI 兼容保留必要映射。
- `getAgentRuntimeProfile(agentId)` 委托 `resolveRuntimeAgentProfile()`。它返回单个成员的 RoleCard、Skill、账号和 engine；如果没有可执行账号或 fallback engine，返回 `null`。
- `dispatchToAgent()` 必须先拿到 `RuntimeAgentProfile`，再 compose prompt 和 emit `terminal:start`。拿不到 profile 时记录明确的 no-runtime-profile 中止事件，不再静默使用默认 engine。
- PromptComposer 接收 runtime roster，因此 TeamLayer、TeamPackLayer 和 dispatch 使用的是同一组团队身份。
- `/api/state` 返回持久化的全部 `agentSkillIds`，store 不能再假设只有固定六个 preset agent 才能绑定 Skill。
- 项目创建后的方案分析不再固定派发给 Mario。普通项目仍使用 preset planner；TeamPack 项目等待对应 TeamPack 加载完成后，按 workflow 的首个可用角色发起 proposal。
- 用户消息中的 `@agent` 也按 runtime roster 解析。TeamPack role id、当前角色名和角色素材显示名都可以作为 mention 目标，不再只接受静态 Mario 6 人组。

这意味着 store 的职责边界是“缓存与适配”，不是“定义团队规则”。TeamPack 的通信规则、任务流程和角色解析都应保留在 Team Runtime Contract 或 server repository 边界内。

## 3.4 当前重要方法

### 初始化

- `loadFromServer()`
  - 从 `/api/state` 加载 conversations、tasks、messages、sessions、invocations
  - 内部调用 `loadSkills()` 加载 skills 并缓存到 `skillsMap`
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
- `confirmBreakdown()` 现在经过 `DispatchAdvisor` —— 一个编程式匹配器，根据 capability profiles、当前负载和 forbidden actions 建议 agent 分配。Advisor 在任务创建前产出带有 `suggestedAgentIds` 的 enriched PhaseProposals
- 当前通过 `composeSystemPrompt(opts)` 构建 systemPrompt，`ComposeOptions.skills` 从 `skillsMap` 解析，团队花名册来自 Team Runtime roster
- 流式消息处理相关方法

### Skill 管理

- `loadSkills()`
  - 从 `/api/skills` 加载所有 skill 并写入 `skillsMap`
- `getSkillsForAgent(agentId)`
  - 从 `agentSkillIds[agentId]` 解析出该 agent 绑定的 skill 列表
- `assignSkillsToAgent(agentId, skillIds)`
  - 通过 `/api/agents/{agentId}/skills` 写入绑定关系并更新 `agentSkillIds`
- `importSkills(source)`
  - 通过 `/api/skills/import` 从 Git 仓库或 URL 导入 skill

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
- `task.sync`
  - 文件变更触发的任务同步事件（来自 TaskFileWatcher）
  - payload: `{ projectPath, conversationId, tasks: ParsedTask[], blockers: ParsedBlocker[] }`
  - 新任务 → 加入 `tasks[]`（之前被跳过，现已修复）
  - 已有任务 → 更新 `status` / `agentId`
  - 新 blocker → 调用 `openBlocker()`
- `task.assigned`
  - 任务分配事件（来自 `task_assign` 工具调用）
  - store 收到后触发 `dispatchToAgent({ agentId, referencedTaskId })`
- `task.ready`
  - 依赖满足事件（来自 TaskFileWatcher 依赖解析）
  - 当任务的所有依赖都 `done` 且该任务有 Agent 分配时触发
  - store 收到后自动将 `pending` → `in_progress` 并 dispatch Agent

这使得”执行输出”不再只是终端文本，也会体现在聊天和持久化记录里。

## 3.6 当前判断

如果要理解这个项目，不能再把 `taskHubStore` 当成简单状态容器看待，而应把它理解为：

- 前端状态机
- API 客户端编排层
- Socket 事件适配层
- 工作台 UI 的统一入口
- Team Runtime 的前端缓存与展示适配层

它不应成为 RoleCard、TeamPack workflow、通信矩阵或账号执行规则的最终事实源。
