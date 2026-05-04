# Md-Driven Task Dispatch System Design

> **Status**: Implemented
> **Created**: 2026-05-04
> **Replaces**: 2026-05-04-intelligent-dispatch-design.md (partial), 2026-05-04-task-system-enhancement-design.md (partial)
> **Inspired by**: OpenClaw file-driven architecture

---

## 0. 问题陈述

我们造了一套任务系统，但 agent 之间的协作完全靠 `@mention` 口头分配。没有结构化任务对象、没有状态追踪、没有完成标准。核心断裂点：

1. `terminal:exit` 成功时不推进任务状态
2. `task_assign` 工具只改 DB，不触发真实 dispatch
3. `confirmBreakdown` 创建任务后不自动派发
4. 任务依赖存了但从没人检查
5. Agent 之间没有结构化协作协议

## 1. 核心设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 真相来源 | Markdown 文件 (`.ath/`) | Agent 是 CLI 进程，读写文件最自然；可观测、可 debug |
| UI 数据来源 | FileWatcher → DB → Socket.IO → UI | 保留 DB 投影以支持查询、过滤、排序 |
| 调度模型 | Planner 驱动 + Agent 心跳自驱 | confirmBreakdown 后 Planner 控制首轮，Agent 被 dispatch 时自动扫描 TASKS.md |
| 完成判定 | exit=0 → in_review，工具 → done | 两条路径互补 |
| 规范落地 | PromptComposer 分层注入 | 人格仅首次，项目信息每次，约束+牵引按场景 |

## 2. 目录结构

### 2.1 项目级 `.ath/` 目录

每个项目（conversation）根目录下创建 `.ath/` 目录：

```
<project-root>/
└── .ath/
    ├── PROJECT.md        # 项目元数据（名称、目标、技术栈）
    ├── TASKS.md          # 任务看板（SSOT）
    ├── PROTOCOLS.md      # 任务流转协议 + DoD 标准
    └── ROLES.md          # 角色定义和技能映射
```

### 2.2 TASKS.md 格式

Markdown 表格，一个项目一个文件：

```markdown
# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-001 | 拆分 Store 为 domain slices | P1 | backend | luigi | doing | - | store slices |
| TASK-002 | 拆分后的测试覆盖 | P1 | testing | toad | todo | TASK-001 | test files |
| TASK-003 | 拆分后的 UI 适配 | P1 | frontend | peach | todo | TASK-001 | component updates |

## 风险 / 阻塞

| ID | Task | Type | Summary | Status |
|----|------|------|---------|--------|
| R1 | TASK-001 | gate_fail | 类型定义不兼容 | open |

## 状态说明
- todo: 待开始，等待 Agent 认领或被指派
- doing: 进行中，Agent 已认领
- review: 待验收，Agent 已完成，等待确认
- done: 已完成
- blocked: 阻塞，需要外部介入
```

**设计选择：** 用 Markdown 表格而非 YAML frontmatter。原因：
- Agent 一眼扫描全部任务，不需要逐个打开文件
- 修改状态只需要改表格中一个单元格
- OpenClaw 实践证明表格对 agent 更友好

**格式变更说明（2026-05-04）：**
- `Level` 列替换为 `Phase` 列（Agent 更关心自己在哪个阶段）
- 新增 `## 风险 / 阻塞` 区域，支持结构化风险上报
- `ParsedTask` 类型：`level` 字段 → `phase` 字段
- 新增 `ParsedBlocker` 类型：`{ id, taskId, type, summary, status }`

### 2.3 PROJECT.md 格式

```markdown
# 项目：Agent Task Hub 重构

## 目标
将 taskHubStore.ts 拆分为按领域划分的 slices，提升可维护性。

## 技术栈
- Next.js (App Router)
- Zustand (state management)
- SQLite (Drizzle ORM)
- Socket.IO

## 约束
- 不改变外部 API
- 所有现有测试必须通过
```

### 2.4 PROTOCOLS.md 格式

```markdown
# 任务流转协议

## 状态机
todo → doing → review → done / blocked

## 认领规则
- Agent 被 dispatch 时，扫描 TASKS.md 中 Role 匹配且 Status=todo 的任务
- 认领：将 Status 改为 doing，将 Agent 列填入自己的 agentId

## 完成标准 (DoD)
### backend 角色
- 代码可编译运行
- 包含类型定义
- 无 lint 错误

### frontend 角色
- 组件可渲染
- 符合 design-system.md 规范
- 响应式适配

### testing 角色
- 测试覆盖率 > 80%
- 所有用例通过

## 交付规则
- 完成任务后：将 TASKS.md 中 Status 改为 review
- 在 Deliverable 列填写产出文件路径
- 如果阻塞：将 Status 改为 blocked，在表格下方说明原因

## 禁止
- 不要修改其他 Agent 负责的任务
- 不要跳过 review 直接标 done
- 不要删除或重新排序其他 Agent 的任务行
```

### 2.5 ROLES.md 格式

```markdown
# 角色定义

| Role | 典型 Agent | 职责 | 技能 |
|------|-----------|------|------|
| planner | mario | 需求拆解、任务分配、进度追踪 | WBS、调度 |
| backend | luigi | 后端逻辑、数据层、API | Node.js、SQL |
| frontend | peach | UI 组件、页面交互 | React、Tailwind |
| testing | toad | 测试编写、质量验证 | Jest、Playwright |
| security | dk | 安全审计、漏洞扫描 | OWASP、依赖检查 |
| devops | yoshi | 构建、部署、CI/CD | Docker、GitHub Actions |
```

## 3. 架构：三层同步

```
Agent (CLI 进程)
    ↓ 读写 .ath/TASKS.md（改 Status: doing → review，新增风险行）
    ↓
FileWatcher (chokidar, 服务端)
    ↓ 检测 .ath/ 目录变更
    ↓ 解析 TASKS.md 表格 + 风险区域
    ↓ 逐条检查 DB：
    ↓   已存在 → 更新 status / agent
    ↓   不存在 → taskRepo.create() 创建新任务
    ↓ 广播 Socket.IO `task.sync` 事件（含 tasks + blockers + conversationId）
    ↓
UI 层 (React + Zustand)
    ↓ 收到 `task.sync` 事件
    ↓ 新任务 → 加入 store tasks[]
    ↓ 已有任务 → 更新 status/agentId
    ↓ 新 blocker → 调用 openBlocker()
    ↓ 看板 + 聊天状态卡片 实时刷新
```

## 4. 模块设计

### Module 1: TaskFileService

**文件**: `src/server/task-file-service.ts`

**职责**: 读写 `.ath/` 下的 markdown 文件。

**核心类型**:

```typescript
interface ParsedTask {
  id: string;
  title: string;
  phase: string;     // 所属阶段（P1, P2, ...）
  role: string;
  agent: string;
  status: string;
  depends: string[];
  deliverable: string;
}

interface ParsedBlocker {
  id: string;
  taskId: string;
  type: string;      // gate_fail, execution_failure, timeout, manual
  summary: string;
  status: 'open' | 'fixed';
}
```

**核心方法**:
- `readTasksMd(projectPath)` → `{ tasks: ParsedTask[], blockers: ParsedBlocker[] }`
- `writeTasksMd(projectPath, tasks, blockers?)` — 写入任务表格 + 可选风险区域
- `updateTaskInMd(projectPath, taskId, updates)` — 原地更新单个任务
- `parseTasksMd(content)` — 解析任务表格（兼容新旧格式）
- `parseBlockersMd(content)` — 解析风险区域
- `formatTasksMd(tasks)` / `formatBlockersMd(blockers)` — 序列化为 Markdown

**格式兼容**:
- 新格式（8 列）：ID | Title | Phase | Role | Agent | Status | Depends | Deliverable
- 旧格式（8 列）：ID | Title | Role | Agent | Status | Depends | Deliverable | Level
- 通过检查表头最后一列是否为 "Level" 自动判断格式

**状态映射**: `todo → pending, doing → in_progress, review → in_review, done → done, blocked → blocked`

### Module 2: TaskFileWatcher

**文件**: `src/server/task-file-watcher.ts`

**职责**: 监听 `.ath/TASKS.md` 变更，同步到 DB，广播到 UI。

**核心逻辑**:
- 使用 `chokidar` 监听 `.ath/TASKS.md` 的 `change` 事件
- 防抖 500ms（Agent 可能连续写入多行）
- 变更时执行 `syncTasksToDb()`:
  1. `readTasksMd()` 解析文件，获得 `{ tasks, blockers }`
  2. 从 `projectPath` 提取 `conversationId`（取路径最后一段）
  3. 遍历每个 parsedTask：
     - DB 中不存在 → `taskRepo.create()` **创建新任务**
     - DB 中已存在 → 对比差异，更新 `status` / `agent_id`
  4. 依赖解析：新完成的任务触发依赖检查，满足条件广播 `task.ready`
  5. 广播 `task.sync` Socket.IO 事件：`{ projectPath, conversationId, tasks, blockers }`

**关键变更（2026-05-04）**: 旧版 watcher 遇到新任务直接 `continue` 跳过，导致看板为空。现改为创建任务。

### Module 3: Prompt 分层注入架构

**设计原则**:
1. **Agent 人格** = 身份、性格、角色约束 → 仅首次 wake 注入（session 内不变）
2. **项目信息** = 任务路径、当前任务、协作协议 → **每次 dispatch 注入**（任务状态实时变化）
3. **约束+牵引** = 规则极简，告诉 agent 去哪找而不是塞满内容

#### 注入时机分层

```
systemPrompt (仅首次 wake)
├── roleLayer       — 身份、性格、角色约束
├── projectLayer    — 项目名称和路径
├── teamLayer       — 团队花名册
└── projectStatus   — 当前任务看板快照

userPrompt (每次 dispatch)
├── skillLayer      — 技能内容
├── toolLayer       — 工具定义
├── protocolLayer   — 任务协作协议（约束+牵引）  ← ✨新增
├── taskContextLayer — 具体任务 ID 和标题
├── historyLayer    — 对话历史                    ← 改为每次
├── userMessageLayer— 用户消息
└── behaviorLayer   — 行为提示
```

**逻辑**:
- **仅首次 (system prompt)**: 人格和身份——同一 session 内不变
- **每次 (user prompt)**: 技能、工具、协议、任务、历史、消息——CLI 每次是新进程，必须全量注入
- **历史压缩**: 后续设计压缩机制，解决历史过长问题（不在本 spec 范围内）

**代码变更**（PromptComposer.ts）:

```ts
// composeSystemPrompt — 仅首次 wake（人格层，session 内不变）
export function composeSystemPrompt(opts: ComposeOptions): string | undefined {
  if (!opts.isFirstWake) return undefined;
  return [
    buildRoleLayer(opts.agent, opts.roleCard),
    buildProjectLayer(opts.project),
    buildTeamLayer(opts.agent.id, opts.allRoleCards, opts.currentLoad),
    projectStatus,
  ].filter(Boolean).join('\n\n');
}

// composeUserPrompt — 每次 dispatch（全量上下文）
export function composeUserPrompt(opts: ComposeOptions): string {
  const parts: string[] = [];

  // 技能 + 工具（每次，CLI 新进程不继承）
  const tools = extractToolsFromSkills(opts.skills ?? []);
  parts.push(buildSkillLayer(opts.skills ?? []));
  parts.push(buildToolLayer(tools));

  // 协作协议（每次，约束+牵引）
  const protocol = buildProtocolLayer(
    opts.agent.id,
    deriveRoleFromCard(opts.roleCard),
    opts.project.path,
    !!opts.task,
  );
  if (protocol) parts.push(protocol);

  // 对话历史（每次，后续加压缩机制控制长度）
  const history = buildHistoryLayer(opts.messages ?? [], opts.agent.id);
  if (history) parts.push(history);

  // 具体任务 + 用户消息 + 行为提示
  if (opts.task) parts.push(buildTaskContextLayer(opts.task));
  parts.push(buildUserMessageLayer(opts.rawPrompt));
  parts.push(buildBehaviorLayer());

  return parts.join('\n\n---\n\n');
}
```

#### protocolLayer 内容设计（约束 + 牵引）

**文件**: `src/lib/agent-context/layers/protocolLayer.ts`

```
export function buildProtocolLayer(
  agentId: string,
  agentRole: string,          // 从 RoleCard.domains 推导，如 'backend'
  projectPath: string,
  hasTaskAssignment: boolean, // 是否有被分配的具体任务
): string
```

**约束层（永远注入，~200 tokens）**:

```markdown
## 任务协作协议

### 你的身份
- agentId: {agentId} | Role: {agentRole}

### 任务看板路径
.ath/TASKS.md（直接编辑此文件管理任务）

### TASKS.md 格式
| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
| TASK-001 | 示例 | P1 | backend | luigi | doing | - | types.ts |

## 风险 / 阻塞
| ID | Task | Type | Summary | Status |
| R1 | TASK-001 | gate_fail | 描述 | open |

### 状态流转
todo → doing → review → done / blocked

### 规则
1. 先读 .ath/TASKS.md 查看全部任务
2. 有分配给你的 → 将 Status 改为 doing → 执行
3. Role 匹配且 todo 的 → 也可以认领
4. 完成后 → Status 改为 review + Deliverable 填产出路径
5. 阻塞 → Status 改为 blocked，在表格下方加风险行
6. 遇到风险 → 在"风险 / 阻塞"区域新增一行

### 禁止
- 不改其他 Agent 的任务行
- 不跳过 review 直接标 done
```

**牵引层（按场景追加，~30 tokens）**:

场景 A — 有任务分配时追加：
```
你被分配了 {taskId}: {taskTitle}。读取 .ath/TASKS.md 确认，完成后更新。
```

场景 B — 无任务，@mention 唤醒：
```
自检 .ath/TASKS.md，认领 Role={agentRole} 的 todo 任务。没有则按用户指令执行。
```

场景 C — Planner:
```
调度职责：读取 .ath/TASKS.md，按优先级使用 task_assign 分配任务。
```

#### Token 对比

| 方案 | 每次 dispatch 的 prompt tokens |
|------|------|
| 旧方案（全量注入 system prompt） | ~800（TASKS.md + PROTOCOLS.md + ROLES.md 全文） |
| **新方案（约束+牵引 in user prompt）** | ~150（规则 + 路径 + 场景指引） |
| Agent 自己按需读文件 | 自己控制，只读需要的章节 |

#### 4 个 .ath/ 文件的读取时机

| 文件 | 谁读 | 什么时候读 | 通过什么 |
|------|------|-----------|---------|
| `TASKS.md` | Agent | 每次被 dispatch 时 | prompt 牵引 "先读 .ath/TASKS.md" |
| `PROTOCOLS.md` | Agent | 开始具体任务前 | prompt 牵引 "完成标准: .ath/PROTOCOLS.md" |
| `ROLES.md` | Agent | 不确定自己角色时 | prompt 牵引 "角色映射: .ath/ROLES.md" |
| `PROJECT.md` | Agent | 需要项目背景时 | prompt 牵引 "项目上下文: .ath/PROJECT.md" |
| `TASKS.md` | TaskFileWatcher | 文件变更时 | chokidar 监听，同步 DB |
| 全部 4 个 | protocolLayer | dispatch 时 | 不读内容，只注入路径 |

### Module 4: 任务闭环 (Task Lifecycle)

#### 4a. exit=0 自动推进

**文件**: `src/store/taskHubStore.ts` — `terminal:exit` handler

**当前**: 只处理 `code !== 0` → `blocked`
**新增**: `code === 0` + 有 taskId → 读取任务状态 → `in_progress → in_review`

```
if (code === 0 && taskId) {
  const task = store.getTaskById(taskId);
  if (task && task.status === 'in_progress') {
    store.updateTaskStatus(taskId, 'in_review');
  }
}
```

同时更新 `.ath/TASKS.md`：`TaskFileService.updateTaskStatus(projectPath, taskId, 'review')`

#### 4b. task_assign 触发真实 dispatch

**文件**: `src/pages/api/mutations.ts` — `tool.invoke` → `task_assign` handler

**当前**: 只做 `taskRepo.update(task_id, { agent_id })`
**新增**:
1. `taskRepo.update(task_id, { agent_id })`
2. `TaskFileService.updateTaskAgent(projectPath, task_id, agent_id)`
3. 广播 `task.assigned` Socket.IO 事件
4. store 收到后触发 `dispatchToAgent({ agentId, referencedTaskId })`

#### 4c. confirmBreakdown 派发 Planner

**文件**: `src/store/taskHubStore.ts` — `confirmBreakdown`

**当前**: 创建 tasks → `breakdownStatus('confirmed')` → 结束
**新增**:
1. 创建 tasks（现有逻辑）
2. 写入 `.ath/TASKS.md`（调用 `TaskFileService`）
3. 写入 `.ath/PROJECT.md`（项目上下文）
4. dispatch Planner（Mario），prompt 指令：

```
任务分解已完成，共 N 个任务。请：
1. 读取 .ath/TASKS.md 确认任务清单
2. 按优先级和依赖关系，逐个 dispatch 对应 Agent
3. 使用 task_assign 工具将任务分配给目标 Agent（这会自动触发 dispatch）
```

### Module 5: 任务状态卡片 (TaskStatusCard)

**文件**: `src/components/task-hub/TaskStatusCard.tsx`

**触发**: `task.sync` 或 `task.status_changed` 事件
**位置**: 聊天框（GlobalChatRoom）内，作为 `ChatMessageItem` 的一个变体

**样式**:
```
┌─────────────────────────────────────────┐
│ 🟢 luigi │ TASK-001: 拆分 Store │ review │ 12:34 │
└─────────────────────────────────────────┘
```

- 左侧 Agent emoji + agentId（`text-sm font-medium`）
- 品牌色左边框（`border-l-2 border-[var(--agent-*)]`）
- 中间任务标题（`text-sm`）
- 状态 badge 复用 `StatusBadge`
- 右侧时间戳（`text-xs text-muted-foreground`）
- 点击 → `setSelectedTaskId(taskId)`
- 通过 `transition-opacity` 淡入（150ms）

**渲染逻辑**: 在 `ChatMessageItem` 中检测到 `intent === 'task_status'` 或 `type === 'task.status_changed'` event 时，渲染 `TaskStatusCard` 代替普通气泡。

### Module 6: Agent 自驱 (Dispatch-Time Task Scanning)

**关键区别**: 我们的 Agent 是按需 CLI 调用，不是常驻进程。"心跳"不是定时轮询，而是 **每次 dispatch 时 protocolLayer 的约束+牵引自动生效**。

**实现**: 不需要额外的 prompt。Module 3 的约束层已经覆盖了：

- 约束第 1 条："被 dispatch 时，先读 .ath/TASKS.md 查看全部任务"
- 约束第 2-3 条：有分配的任务 → 认领执行；有匹配的 todo → 也可认领
- 牵引："任务看板: .ath/TASKS.md（每次被唤醒时读取）"

Agent 的自驱行为 = 约束规则 + 自己去读文件。不需要在 prompt 里写完整流程步骤。

### Module 7: 依赖调度 (Dependency Resolution)

**实现位置**: 服务端 `task-file-watcher.ts`

**触发时机**: 当 TaskFileWatcher 检测到某个任务状态变为 `done` 时。

**逻辑**:
1. 扫描 TASKS.md 中 `Depends` 列包含该 taskId 的所有任务
2. 对于每个依赖任务，检查其所有依赖是否都 `done`
3. 如果全部满足且该任务有 `Agent` 分配 → 广播 `task.ready` 事件
4. store 收到后触发 `dispatchToAgent`

**注意**: 依赖调度是可选的——如果 Planner 已经通过 task_assign 手动控制了派发节奏，依赖检查不生效（只对 `todo` 状态的任务生效）。

## 5. 数据流总结

### 5.1 项目初始化

```
用户创建项目 → confirmBreakdown → Planner 输出 PHASE/TASK
  → TaskFileService.initProjectDir()
  → 写入 .ath/PROJECT.md + .ath/TASKS.md + .ath/PROTOCOLS.md + .ath/ROLES.md
  → TaskFileWatcher.start(projectPath)
  → dispatch Planner(Mario)，prompt 包含完整任务清单
```

### 5.2 任务认领与执行

```
Planner 调用 task_assign(TASK-001, luigi)
  → mutations.ts 更新 DB + 更新 TASKS.md
  → 广播 task.assigned → store → dispatchToAgent(luigi, TASK-001)
  → daemon spawn luigi 的 CLI 进程
  → luigi 的 system prompt 包含 protocolLayer（含 TASKS.md 格式说明 + 认领规则）
  → luigi 读取 TASKS.md，将 TASK-001 Status 改为 doing，Agent 改为 luigi
  → luigi 执行工作
  → luigi 完成后将 TASK-001 Status 改为 review
  → TaskFileWatcher 检测变更 → 解析文件
    → TASK-001 在 DB 中存在 → 更新 status 为 in_review
    → 新任务在 DB 中不存在 → taskRepo.create() 创建
    → 新风险行 → 包含在 task.sync 事件中
  → 广播 task.sync → store 创建/更新任务 + blocker → UI 刷新
```

### 5.3 CLI 进程退出

```
luigi 的 CLI 进程 exit(0)
  → daemon 更新 invocation status
  → terminal:exit handler → updateTaskStatus(TASK-001, 'in_review')
  → TaskFileService.updateTaskStatus → TASKS.md 更新
  → TaskFileWatcher 检测变更 → 检查依赖 → 广播
  → 如果 TASK-002 depends_on TASK-001 → task.ready → dispatch toad
```

## 6. 与现有系统的关系

| 现有模块 | 变更 | 说明 |
|---------|------|------|
| `taskHubStore.ts` | 修改 `terminal:exit` handler, `confirmBreakdown`, 新增 `task.sync` 创建新任务 + blocker 同步 | 核心闭环逻辑 |
| `PromptComposer.ts` | 新增 `protocolLayer` | 规范注入 |
| `mutations.ts` | 扩展 `task_assign`/`task_create`/`task_update_status` handler | 触发 dispatch + 文件双写 |
| `skill-tool-executor.ts` | `task_create` 全参数 + 文件写入, `task_update_status` 文件写入 | 工具执行层双写 |
| `taskManagement.ts` | `task_create` 新增 phase/dependencies/deliverable/role 参数 | 工具定义扩展 |
| `daemon.ts` | 新增 FileWatcher 启动/停止 | 文件监听 |
| `task-repo.ts` | 无变更 | DB 投影复用 |
| `taskStore.ts` | `confirmBreakdown` 使用新 ParsedTask shape | phase 替代 level |
| `task-file-service.ts` | 新增 ParsedBlocker, parseBlockersMd, formatBlockersMd | md 读写 |
| `task-file-watcher.ts` | 新任务 taskRepo.create(), blocker 同步 | 文件监听 + DB 创建 |
| `protocolLayer.ts` | 引导 Agent 直接写 TASKS.md，文档化新格式 | Prompt 注入 |
| `TaskStatusCard.tsx` | 新建 | 聊天状态卡片 |

## 7. 文件清单

```
src/server/task-file-service.ts               # md 读写解析（ParsedTask + ParsedBlocker）
src/server/task-file-watcher.ts               # chokidar 监听 + DB 同步（含任务创建）
src/server/skill-tool-executor.ts             # skill tool 执行器（task_create 全参数 + 文件双写）
src/server/skill-tool-router.ts               # tool 名称路由映射
src/lib/agent-context/layers/protocolLayer.ts # Prompt 规范注入（引导写 MD）
src/store/taskStore.ts                        # task slice（confirmBreakdown 新 shape）
src/data/presetSkills/taskManagement.ts       # task_create 全参数定义
src/components/task-hub/TaskStatusCard.tsx     # 聊天状态卡片
```

## 8. 不做的事

- **不改造 Agent 为常驻进程** — 保持按需 CLI 调用
- **不新增 DB 表** — 复用现有 task/invocation 表，md 是 truth
- **不做 drag-and-drop 看板** — 状态变更通过 agent 写 md 或 UI 按钮触发
- **不做 agent 间直接通信** — 通过 TASKS.md 间接协调
- **不做角色管理 UI** — 通过 .ath/ROLES.md 文件管理
