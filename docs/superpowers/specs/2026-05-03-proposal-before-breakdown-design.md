# Proposal-Before-Breakdown Design

## Problem

当前项目启动流程直接跳到任务拆解，缺少架构方案和业务方案的讨论阶段。用户提需求后 500ms 自动触发 Jean 拆任务，没有给用户和 Jean 讨论技术方案的机会。

## Decision

改为"方案先行"流程：Jean 先出技术架构方案+业务方案草案，和用户讨论，Jean 判断需求清晰后自行输出 PHASE/TASK 格式触发拆解。用户确认后创建任务。

## Scope

- 改变 `triggerBreakdown` 的 prompt 和行为（从"拆任务"改为"出方案"）
- 去掉 `ProjectCreateDialog` 的"自动拆解任务"复选框
- 新增 `breakdownStatus: 'proposal'` 状态
- Jean 的 persona 更新，加入方案先行+自行拆解的行为指引
- 不改 `parsePhaseBreakdown`、`confirmBreakdown`、`ChatMessageItem` 拆解确认 UI

## Flow

### New Flow

```
用户发第一条消息 / 创建项目
        ↓
自动 dispatch Jean（proposal prompt）
        ↓
Jean 输出技术架构方案 + 业务方案草案
        ↓
用户讨论 / 反馈 / Jean 回复（多轮对话）
        ↓
Jean 判断需求清晰 → 输出 PHASE/TASK 格式
        ↓
parsePhaseBreakdown 自动检测 → 用户确认 → 任务创建
```

### breakdownStatus States

```
'none' → 'proposal' → 'confirmed'
              ↑
         (Jean 被派出去出方案)
```

- `none`: 新项目，未触发任何 agent
- `proposal`: Jean 已被派出去出方案（防止重复触发）
- `confirmed`: 用户已确认拆解，任务已创建
- `no_account`: 没有可用账号

`'in_progress'` 和 `'reviewed'` 不再使用。

## Changes

### 1. triggerBreakdown → triggerProposal

**File:** `src/store/taskHubStore.ts` (line ~1233)

Rename function. Change prompt from:

```
你是项目统筹 Mario。请将以下项目目标拆解为 2-4 个阶段。
```

To:

```
你是项目统筹 Jean。请先基于以下项目目标输出一份技术架构方案和业务方案草案。

方案需要包含：
- 技术架构：核心技术选型、模块划分、关键依赖
- 业务方案：核心流程、边界条件、优先级建议

和用户讨论确认后，当你判断需求已足够清晰，再使用 PHASE/TASK 格式输出任务拆解。

项目：{title}
目标：{goal}
```

Set `breakdownStatus` to `'proposal'` instead of `'in_progress'`.

### 2. Remove auto-breakdown checkbox from ProjectCreateDialog

**File:** `src/components/project/ProjectCreateDialog.tsx`

- Remove the `autoBreakdown` state and checkbox (lines 21, 111-129)
- Remove `autoBreakdown` parameter from `createConversation` call (line 43)
- Button text fixed to "创建项目" (line 151)
- Clean up `setAutoBreakdown` reset (line 47)

### 3. createConversation always triggers proposal

**File:** `src/store/taskHubStore.ts` (line ~991)

Change from:
```ts
if (autoBreakdown !== false) {
  setTimeout(() => get().triggerBreakdown(id), 500);
}
```

To:
```ts
setTimeout(() => get().triggerProposal(id), 500);
```

Also update `addChatMessage` auto-trigger (line ~1860):
```ts
if (existingConv && existingConv.breakdownStatus === 'none' && !mentions.length) {
  // triggers proposal instead of breakdown
  setTimeout(() => state.triggerProposal(conversationId), 500);
}
```

### 4. Jean persona update

**File:** `src/data/presetRoleCards.ts`

Update Jean's persona.introduction to include:
"收到新项目时，你会先输出技术架构方案和业务方案草案，和用户讨论确认后再拆解任务。当你判断需求已经足够清晰，你会直接用 PHASE/TASK 格式输出任务拆解方案。"

### 5. ProjectChatPanel status display update

**File:** `src/components/project-hub/ProjectChatPanel.tsx`

Update status labels:
- `'proposal'` → "Jean 正在分析项目…"
- Remove `'in_progress'` and `'reviewed'` cases

## Files Changed

| File | Change |
|------|--------|
| `src/store/taskHubStore.ts` | Rename triggerBreakdown → triggerProposal, new prompt, new status, remove autoBreakdown param |
| `src/components/project/ProjectCreateDialog.tsx` | Remove autoBreakdown checkbox, fix button text |
| `src/data/presetRoleCards.ts` | Update Jean persona |
| `src/components/task-hub/ProjectChatPanel.tsx` | Update status display |

## What Doesn't Change

- `parsePhaseBreakdown` — already runs on every agent message, detects PHASE/TASK format automatically
- `confirmBreakdown` — same confirmation logic
- `ChatMessageItem` — same breakdown review UI with checkboxes
- `breakdownParser` — same parsing logic
