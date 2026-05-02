# 项目任务自动拆解设计

## 背景

当前项目（Conversation）到任务（Task）的拆解完全依赖手动。项目只有 title + goal，用户需要逐条通过 NewTaskDialog 创建任务，或等待聊天中 planner 的 ad-hoc 提议。缺少结构化的拆解流程，导致：

- 项目与任务之间没有分层组织（阶段/里程碑）
- 任务拆解依赖人工经验，容易遗漏
- 无法形成"创建项目 → 拆解 → 审核 → 执行"的闭环

## 目标

1. 项目创建时自动触发 AI 拆解，生成阶段 + 任务
2. 用户在对话流中审核拆解结果，可逐项勾选、调整、重新拆解
3. 确认后正式写入 Phase 和 Task，进入执行阶段
4. 项目与本地文件夹绑定，为后续 agent 操作提供上下文

## 数据模型变更

### Phase（新增实体）

```
Conversation (项目)
  └── Phase (阶段)
        └── Task (任务)
```

```typescript
// src/types/phase.ts
export type PhaseStatus = 'planned' | 'active' | 'done';

export interface Phase {
  id: string;            // PHASE-001 格式
  conversationId: string;
  title: string;
  description: string;
  order: number;          // 0, 1, 2...
  status: PhaseStatus;
  createdAt: string;
  updatedAt: string;
}
```

### Task 变更

```typescript
// Task 接口新增字段
phaseId: string;  // 关联阶段（外键）
```

`dependencies` 保持不变，允许跨阶段依赖。

### Conversation 变更

```typescript
// Conversation 接口新增字段
breakdownStatus: 'none' | 'in_progress' | 'reviewed' | 'confirmed';
```

### 存储方式

与现有模式一致：Phase 数据存在 Zustand store，通过 `partialize` 持久化到 localStorage。Phase ID 格式为 `{conversationId}-PHASE-{seq}`（如 `conv-abc-PHASE-001`），在对话内自增。本期不新增 SQLite phase 表，Phase 仅存 localStorage，后续版本再加数据库持久化。

## 拆解流程

```
用户创建项目 (title + goal + folder)
        │
        ▼
  breakdownStatus → 'in_progress'
  planner agent (Jean) 自动收到拆解 prompt
        │
        ▼
  Jean 在对话中发送结构化消息
  （阶段 + 任务列表 + 推荐负责人）
  breakdownStatus → 'reviewed'
        │
        ▼
  用户在对话中审核：
  · 点击任务 → 编辑（改标题/换人/删除）
  · 勾选/取消 → 标记保留哪些
  · 回复文字 → 继续追问或要求调整
        │
        ▼
  用户点"确认全部"或"确认本阶段"
        │
        ▼
  系统将勾选的任务正式写入 tasks[]
  创建对应 phases[]
  breakdownStatus → 'confirmed'
```

### 拆解 Prompt 模板

```
你是项目统筹 Jean。请将以下项目目标拆解为 2-4 个阶段。

项目：{title}
目标：{goal}
项目路径：{projectPath}

请严格按以下格式输出，不要输出其他内容：

PHASE: {阶段名} | {阶段简述}
TASK: {任务标题} | {任务描述} @{推荐agentId}
TASK: {任务标题} | {任务描述} @{推荐agentId}
PHASE: {下一个阶段名} | {阶段简述}
TASK: {任务标题} | {任务描述} @{推荐agentId}
```

### 消息解析

现有 `parseTaskProposals` 扩展为 `parsePhaseBreakdown`：

```typescript
// src/lib/breakdownParser.ts

interface PhaseProposal {
  title: string;
  description: string;
  tasks: TaskProposal[];
}

interface TaskProposal {
  title: string;
  description: string;
  agentId?: string;
}

function parsePhaseBreakdown(content: string): PhaseProposal[]
```

- `PHASE:` 行 → 创建阶段节点
- `TASK:` 行 → 归入当前阶段
- 返回有序的 PhaseProposal 数组

### 重新拆解

用户发消息 `@Jean 重新拆解，我需要更多关注 xxx`，系统调用 `triggerBreakdown(conversationId)` 重新生成。之前的提案任务不会自动删除，由用户在确认时选择。

## 文件夹绑定

### 服务端 API

```
GET /api/fs/list?path=/Users/kk/projects
```

返回指定目录下的子目录列表：

```json
{
  "path": "/Users/kk/projects",
  "children": [
    { "name": "my-app", "path": "/Users/kk/projects/my-app", "hasChildren": true },
    { "name": "empty-dir", "path": "/Users/kk/projects/empty-dir", "hasChildren": false }
  ]
}
```

安全限制：
- 只返回目录，不返回文件
- 路径必须以 `os.homedir()` 为前缀
- 拒绝包含 `..` 的路径
- 不存在的路径返回空列表

### FolderPicker 组件

集成到 ProjectCreateDialog 中，位于标题和目标字段之间：
- 初始显示 `os.homedir()` 下的目录
- 点击目录名展开子目录
- 面包屑导航显示当前路径层级
- 单击选中，显示在路径输入框中
- 支持 DevOps Hub 本身运行的目录作为默认建议

## Store Actions

### Phase State

```typescript
// taskHubStore.ts 新增
phases: Phase[];

upsertPhase: (phase: Omit<Phase, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => string;
removePhase: (phaseId: string) => void;
```

### Breakdown Actions

```typescript
setBreakdownStatus: (conversationId: string, status: Conversation['breakdownStatus']) => void;

triggerBreakdown: (conversationId: string) => void;
// 读取 conversation 的 title/goal/projectPath
// 构造拆解 prompt
// 调用 dispatchToAgent('jean', prompt)
// 设置 breakdownStatus = 'in_progress'

confirmBreakdown: (conversationId: string, proposals: PhaseProposal[]) => void;
// 为每个 PhaseProposal 创建 Phase
// 为每个 TaskProposal 创建 Task（含 phaseId）
// 设置 breakdownStatus = 'confirmed'
```

### createConversation 变更

```typescript
// 新增参数
createConversation: (input: {
  title: string;
  goal: string;
  projectPath?: string;
  priority?: Conversation['priority'];
  autoBreakdown?: boolean;  // 默认 true
}) => void;
```

创建后如果 `autoBreakdown !== false`，自动调用 `triggerBreakdown`。

### partialize 变更

`phases` 加入持久化列表（与 roleCards 同理，非预设数据全量持久化）。

## UI 变更

### 1. ProjectCreateDialog

- 新增 FolderPicker 组件（标题与目标之间）
- 新增"自动拆解任务"开关（默认开启）
- 确认按钮文案改为"创建并拆解"
- `projectPath` 传入 `createConversation`

### 2. ChatMessageItem 增强渲染

当 `parsePhaseBreakdown` 识别到阶段结构时，替换现有的 `parseTaskProposals` 渲染：

- 每个阶段渲染为折叠区块（border 带阶段色标）
- 阶段头显示：阶段序号 + 标题 + 任务数
- 阶段内每张任务显示：☑/☐ 勾选框 + ID + 标题 + 负责人 emoji
- 勾选状态管理在 ChatMessage 元数据中（`selectedProposals: string[]`）
- 底部操作栏："确认全部 (N)" 按钮 + "重新拆解" 按钮
- 点击"确认全部"调用 `confirmBreakdown`

### 3. 指挥台头部（ProjectChatPanel）

项目名称下方根据 `breakdownStatus` 显示：
- `none`：不显示
- `in_progress`：⚡ Jean 正在拆解任务…（带脉冲动画）
- `reviewed`：N 阶段 · M 任务 · 待确认
- `confirmed`：正常显示状态计数

### 4. MiniKanban 分阶段视图

- 顶部新增阶段 tab 栏（替代或并列于现有的纯状态分组）
- 点击阶段 tab 筛选该阶段的任务
- "全部" tab 显示所有任务（保持现有行为）
- 每个阶段 tab 显示任务数 badge

## 文件清单

### 新建文件

| 文件 | 用途 |
|---|---|
| `src/types/phase.ts` | Phase 类型定义 |
| `src/lib/breakdownParser.ts` | 拆解消息解析 |
| `src/components/ui/FolderPicker.tsx` | 文件夹选择器组件 |
| `src/pages/api/fs/list.ts` | 目录浏览 API |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/store/taskHubStore.ts` | Phase state + breakdown actions + createConversation 扩展 |
| `src/types/roleCard.ts` 或 `src/store/taskHubStore.ts` | Task 增加 phaseId，Conversation 增加 breakdownStatus |
| `src/components/project/ProjectCreateDialog.tsx` | 集成 FolderPicker + autoBreakdown 开关 |
| `src/components/task-hub/ChatMessageItem.tsx` | parsePhaseBreakdown 渲染 + 确认交互 |
| `src/components/project/ProjectChatPanel.tsx` | 头部 breakdownStatus 指示 |
| `src/components/project/MiniKanban.tsx` | 阶段 tab 分组 |
| `src/store/taskHubStore.ts` | ChatMessage 增加 selectedProposals 元数据 |
| `src/server/db/schema.ts` | phase 表 + task 表 phaseId 字段 |

## 不在范围内

- 任务拖拽排序（后续）
- 阶段间自动流转（如阶段 1 全部完成后自动激活阶段 2）
- 拆解结果持久化到数据库（Phase 表仅 localStorage，后续再加 SQLite）
- 多人协作 / 权限
