# Prompt Composer 设计

**Goal:** 将散落在 store、daemon、各 builder 里的 prompt 拼接逻辑，收敛为统一的分层 PromptComposer。支持 opencode + claude 引擎。

**Scope:** `src/lib/agent-context/` 重构 + `taskHubStore.ts` 两处 dispatch 调用方迁移。不改动 daemon、backend、UI 组件。

---

## Prompt 分层

### System Prompt

**注入方式因引擎而异：**

| 引擎 | systemPrompt 注入方式 | 说明 |
|---|---|---|
| opencode | 合并进主 prompt（`\n\n---\n\n` 分隔） | opencode CLI 无 system-prompt flag，`--prompt` 不生效会被忽略 |
| claude | `--append-system-prompt` flag | 通过 Claude Code CLI 的追加系统提示机制 |
| codex | 合并进主 prompt | 同 opencode |
| gemini | 合并进主 prompt | 同 opencode |

> **历史问题（2026-05-04 修复）**：opencode 曾用 `--prompt` 传递 systemPrompt，但该 flag 不被 opencode CLI 识别，导致首次 @agent 时角色身份、团队名册、协作规则全部丢失。claude 引擎在 tmux 路径中也缺失 `--append-system-prompt`。修复后改为合并到主 prompt（opencode/codex/gemini）或正确使用 flag（claude）。

| 层 | 函数 | 内容 | 注入时机 |
|---|---|---|---|
| RoleLayer | `buildRoleLayer(agent, roleCard)` | persona 全 5 维度 + 角色约束 | 仅首次唤醒 |
| ProjectLayer | `buildProjectLayer(project)` | 项目名、路径、规范文件 | 仅首次唤醒 |
| TeamLayer | `buildTeamLayer(selfId, roleCards)` | 团队名册 + 协作规则 | 仅首次唤醒 |

**首次唤醒 = `!sessionId`（agent 在当前 project+conversation 下没有活跃 CLI session）。** 首次唤醒时三层全部注入，构成完整的角色 + 环境 + 团队上下文。后续对话通过 CLI `--session` / `--resume` 恢复，CLI 自身保留上下文，不需要重复注入。

### User Prompt（作为 positional arg / stdin 发送）

| 层 | 函数 | 内容 | 注入时机 |
|---|---|---|---|
| HistoryLayer | `buildHistoryLayer(messages, selfId)` | 最近 10 条对话 | 仅首次唤醒 |
| TaskContextLayer | `buildTaskContextLayer(task, phase)` | 任务 ID + 标题 + 阶段 + 描述 | 有 referencedTaskId 时 |
| UserMessageLayer | `buildUserMessageLayer(rawPrompt)` | 清洗后的用户消息 | 始终 |
| BehaviorLayer | `buildBehaviorLayer()` | 决策提示 | 始终 |

---

## ComposeOptions 接口

```typescript
interface ComposeOptions {
  agent: { id: string; name: string };
  roleCard: RoleCard;
  allRoleCards: RoleCard[];
  project: { name: string; path: string };
  isFirstWake: boolean;
  messages?: ChatMessage[];
  task?: { id: string; title: string; description?: string; phase?: { title: string } };
  rawPrompt: string;
}
```

## Composer 函数

```typescript
function composeSystemPrompt(opts: ComposeOptions): string | undefined {
  if (!opts.isFirstWake) return undefined;
  return [buildRoleLayer, buildProjectLayer, buildTeamLayer]
    .map(fn => fn(opts))
    .filter(Boolean)
    .join('\n\n');
}

function composeUserPrompt(opts: ComposeOptions): string {
  const parts: string[] = [];
  if (opts.isFirstWake) {
    const history = buildHistoryLayer(opts);
    if (history) parts.push(history);
  }
  if (opts.task) {
    parts.push(buildTaskContextLayer(opts));
  }
  parts.push(buildUserMessageLayer(opts));
  parts.push(buildBehaviorLayer(opts));
  return parts.join('\n\n---\n\n');
}
```

---

## 各层详细内容

### RoleLayer

```
{persona.introduction}

## 角色约束
- 职责：{responsibilities.join('、')}
- 非职责：{nonResponsibilities.join('、')}
- 禁止：{forbiddenActions.join('、')}
- 评审/建议必须附带具体证据和文件引用   (if requiresEvidence)
- 输出格式：{formatLabel}                (if not freeform)
- 只能提出建议，不能直接修改代码          (if propose-only)
- 以下操作需用户确认：{...}              (if requiresConfirmation.length > 0)

## 语气风格
{persona.voice}

## 思维模式
{persona.mindset}

## 工作习惯
{persona.habits}

## 协作风格
{persona.collaboration}
```

persona 的 4 个扩展维度（voice/mindset/habits/collaboration）仅在对应字段非空时注入对应 section。

### ProjectLayer

```
## 项目上下文
- 项目：{projectName}
- 工作目录：{projectPath}
- 项目根目录有 CLAUDE.md / AGENTS.md 规范文件，请遵循
```

### TeamLayer

```
## 团队名册

| @mention | 名字 | 角色 | 擅长 |
|----------|------|------|------|
| @luigi | ⚡ Luigi | 前端实现 | ... |

## 协作规则
- 遇到超出职责范围的工作，使用 @mention 交接给对应角色（另起一行行首写 @agentId）
- 关键架构变更、数据库 schema 变更前必须请求用户确认
- 评审意见必须附带具体代码引用和修复方向
- 如果需要其他 agent 协助，在回复中另起一行写 @agentId + 请求内容
```

### HistoryLayer

```
[对话历史 - 最近 N 条]
[HH:MM 发送者] 消息内容
[/对话历史]
```

最多 10 条，每条截断 200 字。agent 自身的历史消息标注为 `你（之前）`。

### TaskContextLayer

```
[任务: {id} {title}]
[阶段: {phase.title}]
{task.description}
```

### UserMessageLayer

- 清洗 @mention：`prompt.replace(/@\w+\s*/g, '').trim()`
- 空消息 fallback：`'你好，请就绪并等待指令。'`

### BehaviorLayer

```
完成回复后思考：是否需要交接给其他角色？是否需要请求用户确认？如不需要，正常结束即可。
```

---

## 文件结构

```
src/lib/agent-context/
  PromptComposer.ts           ← composeSystemPrompt + composeUserPrompt + ComposeOptions
  layers/
    roleLayer.ts              ← buildRoleLayer
    projectLayer.ts           ← buildProjectLayer
    teamLayer.ts              ← buildTeamLayer（含协作规则）
    historyLayer.ts           ← buildHistoryLayer
    taskContextLayer.ts        ← buildTaskContextLayer
    userMessageLayer.ts       ← buildUserMessageLayer
    behaviorLayer.ts          ← buildBehaviorLayer
  buildSystemPrompt.ts        ← 删除
  buildTeamRoster.ts          ← 删除
  buildConversationHistory.ts ← 删除
```

---

## 调用方迁移

### `dispatchToAgent`（~line 1366-1475）

**Before:** inline 拼 systemPrompt（调 buildSystemPrompt）+ inline 拼 effectivePrompt（4 段）

**After:**
```typescript
const opts: ComposeOptions = {
  agent: { id: agent.id, name: agent.name },
  roleCard: rc,
  allRoleCards: get().roleCards,
  project: { name: conv?.title ?? '', path: conv?.projectPath ?? '' },
  isFirstWake: !sessionId,
  messages: !sessionId ? (get().chatMessagesByConversation[conversationId] ?? []) : undefined,
  task: referencedTaskId ? get().getTaskById(referencedTaskId) : undefined,
  rawPrompt: prompt,
};

const systemPrompt = composeSystemPrompt(opts);
const effectivePrompt = composeUserPrompt(opts);
```

### `simulateCliExecution`（~line 1555-1626）

**Before:** 简化版 inline systemPrompt，无 team/project/collaboration

**After:** 使用同一个 `composeSystemPrompt(opts)` + `composeUserPrompt(opts)`，完全复用。TaskDetailPanel 传入的 sessionId 需要改为 `undefined`（当前传了 `agent-${agent.id}` 导致永远跳过 systemPrompt）。

---

## 不改动的部分

- `presetRoleCards.ts` — persona 数据不变
- UI 组件 — 不涉及
- `triggerProposal` — 只改 agentId（已修），prompt 内容不变

## 后续修复记录

### 2026-05-04: systemPrompt 注入修复

**问题**：首次 @agent 时 Jean 收到的 prompt 没有任何角色信息（无 persona、无团队名册、无协作规则）。

**根因**：
1. `opencode.ts` 用 `--prompt` flag 传递 systemPrompt，但 opencode CLI 不识别该 flag，静默忽略
2. `daemon.ts` 的 `primaryArgs` IIFE 中，claude/codex/gemini 引擎完全没有传递 systemPrompt
3. 对 opencode 来说，即使 systemPrompt 正确生成了，也无法到达 CLI agent

**修复**（影响文件）：
- `src/server/agent/opencode.ts` — 移除无效的 `--prompt` flag，改为将 systemPrompt 合并进主 prompt（用 `\n\n---\n\n` 分隔）
- `src/server/daemon.ts` primaryArgs IIFE — opencode/codex/gemini 合并到主 prompt；claude 新增 `--append-system-prompt`

### 2026-05-04: session 完成后错误密封

**问题**：每次 CLI 执行完成后 session 被密封（status = 'sealed'），导致下次消息发送时 `findActiveByConversation` 找不到可用 session，`isFirstWake` 永远为 true，systemPrompt 重复注入，CLI session 无法通过 `--resume` 复用。

**根因**：`daemon.ts` 在 backend/bridge/tmux 路径中，CLI 正常完成后都调用 `sessionRepo.seal(id, 'completed')`。这使得每个 session 只能使用一次，违背了 session 跨消息复用的设计意图。

**修复**（影响文件）：
- `src/server/daemon.ts` — backend 路径：成功完成不再 seal，仅失败时 seal；bridge 路径：移除成功完成的 seal 调用
- 保留的 seal 场景：失败/超时/异常 + 创建新 session 时的 `sealByConversation('replaced')`
- 数据修复：`UPDATE agent_session SET status='active' WHERE seal_reason='completed'`
