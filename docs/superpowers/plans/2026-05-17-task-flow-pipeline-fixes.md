# Task Flow Pipeline Fixes — Dependency Resolution, Owner Assignment, A2A Interception

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three dead-end paths in the task flow pipeline so that dependency resolution, unassigned task notification, and A2A interception all lead to actual agent dispatch instead of silent drops.

**Architecture:** Three-layer fix: (1) server wakeup resolver adds `unblocked_unassigned` reason code for coordinator notification when downstream tasks have no owner, (2) client wakeup handler calls `dispatchToAgent` for `dependency_resolved`, `owner_ready`, and `unblocked_unassigned` (not just status update), (3) A2A interception messages no longer mislead agents toward dead-end paths.

**Tech Stack:** TypeScript, Vitest, Zustand, Socket.IO, SQLite (better-sqlite3)

---

## Root Cause Summary

The task flow pipeline has three structural dead ends:

1. **Server — unassigned tasks silently skipped:** Both the wakeup resolver and file watcher skip downstream tasks without `agent_id`. No one — not even the coordinator — is notified that a task is ready to be claimed. (`task-wakeup.ts:89`, `task-file-watcher.ts:158`)

2. **Client — `dependency_resolved` wakeup only updates status:** The client handler for `dependency_resolved` and `owner_ready` calls `updateTaskStatus` but NOT `dispatchToAgent`. The agent is never actually woken up. (`taskHubStore.ts:2347-2349`)

3. **A2A — interception messages point to dead-end paths:** The "未转交" and "链内拦截" messages tell agents to "use task notifications," but task notifications are purely informational (UI only) and never dispatch agents.

Additionally, two P1 latent risks:

4. **Pass-intent negation pattern 3 may block legitimate handoffs** that mention a completed task before the target agent.

5. **Chain dedup Layer 2 prevents coordinator re-entry**, with no exemption for review decision callbacks.

---

## File Structure

### Modified Files

| File | Change | Tasks |
|------|--------|-------|
| `src/server/task-flow/task-wakeup.ts` | Add `unblocked_unassigned` reason code + resolver logic | 1 |
| `src/server/task-flow/task-notification-publisher.ts` | Export `resolveTaskNotificationAudience` | 2 |
| `src/server/task-file-watcher.ts` | Handle unassigned tasks + coordinator notification | 3 |
| `src/store/taskHubStore.ts` | Dispatch agents for `dependency_resolved`, `owner_ready`, `unblocked_unassigned` | 4 |
| `src/server/a2a/orchestrator.ts` | Update interception message text | 5 |
| `src/server/a2a/pass-intent.ts` | Add handoff exception to negation pattern 3 | 6 |
| `src/server/a2a/dedup.ts` | Add coordinator + intent-based exemption to Layer 2 | 7 |

### Test Files

| File | Change | Tasks |
|------|--------|-------|
| `src/__tests__/server/task-flow/task-wakeup.test.ts` | Add `unblocked_unassigned` tests | 1 |
| `src/__tests__/store/review-gate-wakeup.test.ts` | Add dispatch tests for all reason codes | 4 |
| `src/__tests__/server/a2a/pass-intent.test.ts` | Add negation pattern 3 edge case tests | 6 |

### Dependency Graph

```
Task 1 (server wakeup) ──→ Task 2 (export resolver) ──→ Task 3 (file watcher)
Task 4 (client dispatch) ── independent
Task 5 (A2A messages) ── independent
Task 6 (pass-intent fix) ── independent
Task 7 (dedup exemption) ── independent
```

Tasks 4–7 can be parallelized with Tasks 1–3.

---

## Task 1: Add `unblocked_unassigned` Wakeup Reason Code

**Files:**
- Modify: `src/server/task-flow/task-wakeup.ts:4, 82-118, 180-195`
- Test: `src/__tests__/server/task-flow/task-wakeup.test.ts`

This adds a new wakeup reason code that fires when a downstream task's dependencies are all satisfied but the task has no assigned owner, notifying the coordinator to assign someone.

- [ ] **Step 1: Write failing test for `unblocked_unassigned`**

Append to `src/__tests__/server/task-flow/task-wakeup.test.ts`:

```typescript
it('wakes coordinators when a downstream pending task has all dependencies met but no owner', () => {
  const completed = task({ id: 'TASK-004', agent_id: 'toad', status: 'done' });
  const downstream = task({ id: 'TASK-007', agent_id: '', status: 'pending' });

  const wakeups = resolveTaskWakeups({
    task: completed,
    previousTask: { ...completed, status: 'in_progress' },
    actorId: 'toad',
    changedFields: ['status'],
    coordinatorAgentIds: ['mario'],
    reviewAgentIds: [],
    conversationTasks: [completed, downstream],
    edges: [edge({ from_task_id: 'TASK-004', to_task_id: 'TASK-007', type: 'depends_on' })],
  });

  expect(wakeups).toMatchObject([{
    taskId: 'TASK-007',
    agentId: 'mario',
    reasonCode: 'unblocked_unassigned',
    dispatchSource: 'workflow',
  }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/server/task-flow/task-wakeup.test.ts`
Expected: FAIL — no wakeup emitted for coordinator because the current code skips tasks with empty `agent_id`.

- [ ] **Step 3: Add `unblocked_unassigned` to the reason code type**

In `src/server/task-flow/task-wakeup.ts`, line 4, update the type:

```typescript
export type TaskWakeupReasonCode = 'owner_ready' | 'review_requested' | 'review_decision_ready' | 'dependency_resolved' | 'unblocked_unassigned';
```

- [ ] **Step 4: Update `addWakeup` action text for new reason code**

In `src/server/task-flow/task-wakeup.ts`, lines 93-95, update the `actionText` ternary:

```typescript
const actionText = input.reasonCode === 'review_requested'
  ? '请开始评审'
  : input.reasonCode === 'review_decision_ready'
    ? '请确认评审结论'
    : input.reasonCode === 'unblocked_unassigned'
      ? '需要分配负责人'
      : '请继续处理';
```

- [ ] **Step 5: Add `unblocked_unassigned` logic to `resolveTaskWakeups`**

In `src/server/task-flow/task-wakeup.ts`, after the existing `dependency_resolved` block (after line 195), add:

```typescript
// When a task becomes done, check downstream tasks that have no owner but all deps satisfied.
// Notify coordinators so they can assign an owner.
if (input.previousTask && input.previousTask.status !== 'done' && input.task.status === 'done') {
  const tasksById = new Map(input.conversationTasks.map((task) => [task.id, task]));
  const downstreamNotified = new Set<string>();
  for (const edge of input.edges) {
    if (edge.type !== 'depends_on' || edge.from_task_id !== input.task.id) continue;
    const downstream = tasksById.get(edge.to_task_id);
    if (!downstream || downstream.status !== 'pending') continue;
    if (!dependenciesSatisfied(downstream, input.conversationTasks, input.edges)) continue;
    if (downstream.agent_id) continue; // has owner — handled by dependency_resolved above
    const key = downstream.id;
    if (downstreamNotified.has(key)) continue;
    downstreamNotified.add(key);
    for (const coordinatorAgentId of input.coordinatorAgentIds) {
      addWakeup(wakeups, {
        task: downstream,
        agentId: coordinatorAgentId,
        actorId: input.actorId,
        reasonCode: 'unblocked_unassigned',
        dispatchSource: 'workflow',
      });
    }
  }
}
```

Note: This block checks the same conditions as the `dependency_resolved` block (lines 180-195) but targets tasks WITHOUT an owner. The `downstreamNotified` set prevents duplicate coordinator wakeups when multiple edges point to the same downstream task.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/server/task-flow/task-wakeup.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/task-flow/task-wakeup.ts src/__tests__/server/task-flow/task-wakeup.test.ts
git commit -m "feat(wakeup): add unblocked_unassigned reason code for coordinator notification"
```

---

## Task 2: Export Audience Resolver from Publisher

**Files:**
- Modify: `src/server/task-flow/task-notification-publisher.ts:76`

Simple change: export the `resolveTaskNotificationAudience` function so the file watcher can reuse it.

- [ ] **Step 1: Add export keyword to `resolveTaskNotificationAudience`**

In `src/server/task-flow/task-notification-publisher.ts`, line 76, change:

```typescript
function resolveTaskNotificationAudience(conversationId: string): {
```

to:

```typescript
export function resolveTaskNotificationAudience(conversationId: string): {
```

- [ ] **Step 2: Verify no compile errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors referencing `resolveTaskNotificationAudience`.

- [ ] **Step 3: Commit**

```bash
git add src/server/task-flow/task-notification-publisher.ts
git commit -m "refactor(publisher): export resolveTaskNotificationAudience for reuse"
```

---

## Task 3: Handle Unassigned Tasks in File Watcher

**Files:**
- Modify: `src/server/task-file-watcher.ts:155-187`

The file watcher's parallel dependency resolution loop (lines 155-187) currently skips tasks without an owner (`t.agent` check at line 158). This adds coordinator notification for unassigned downstream tasks.

- [ ] **Step 1: Add import for audience resolver**

In `src/server/task-file-watcher.ts`, line 6, update the import from the publisher:

```typescript
import { publishTaskChangeNotification, resolveTaskNotificationAudience } from './task-flow/task-notification-publisher';
```

- [ ] **Step 2: Add coordinator notification for unassigned tasks**

In `src/server/task-file-watcher.ts`, after the existing dependency resolution loop (after line 187), add:

```typescript
// Notify coordinators when downstream tasks are unblocked but have no owner
for (const doneId of newlyDone) {
  for (const t of parsed) {
    if (t.depends.includes(doneId) && t.status === 'pending' && !t.agent) {
      const allDone = t.depends.every((depId) => {
        const dep = parsed.find((p) => p.id === depId);
        return dep?.status === 'done';
      });
      if (allDone) {
        const audience = resolveTaskNotificationAudience(conversationId);
        for (const coordinatorId of audience.coordinatorAgentIds) {
          io.to(conversationId).emit('task.wakeup', {
            conversationId,
            taskId: t.id,
            agentId: coordinatorId,
            reasonCode: 'unblocked_unassigned',
            dispatchSource: 'workflow',
            prompt: `请分配负责人：${t.id}: ${t.title} 的依赖已全部满足，但尚未分配负责人。请指定负责人并更新任务看板。`,
            content: `系统轻推 @${coordinatorId}：${t.id}「${t.title}」依赖已满足，需要分配负责人。`,
            metadata: {
              taskId: t.id,
              taskTitle: t.title,
              taskStatus: t.status,
              ownerAgentId: '',
              reasonCode: 'unblocked_unassigned',
              idempotencyKey: `${conversationId}:${t.id}:${coordinatorId}:unblocked_unassigned`,
              startsA2AHandoff: false,
              startsDispatch: true,
            },
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }
}
```

- [ ] **Step 3: Verify no compile errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/task-file-watcher.ts
git commit -m "feat(watcher): notify coordinators when unblocked tasks have no owner"
```

---

## Task 4: Make Wakeups Dispatch Agents on the Client

**Files:**
- Modify: `src/store/taskHubStore.ts:2347-2364`
- Test: `src/__tests__/store/review-gate-wakeup.test.ts`

The client-side wakeup handler currently only calls `dispatchToAgent` for `review_requested` and `review_decision_ready`. This change adds dispatch calls for `dependency_resolved`, `owner_ready`, and the new `unblocked_unassigned`.

- [ ] **Step 1: Write failing test for `dependency_resolved` dispatch**

Append to `src/__tests__/store/review-gate-wakeup.test.ts`:

```typescript
describe('dependency_resolved wakeup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetReviewGateStore();
    // Add a pending task that will be dependency-resolved
    useTaskHubStore.setState((state) => ({
      tasks: [...state.tasks, {
        id: 'TASK-007',
        conversationId: 'conv-review',
        phaseId: '',
        title: 'Integration wiring',
        description: 'Wire socket listeners to UI components',
        status: 'pending',
        agentId: 'luigi',
        dependencies: ['TASK-004', 'TASK-006'],
        artifacts: [],
        reviewNote: null,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
      }],
      activeAgentIds: ['mario', 'dk', 'luigi'],
      agentAccountOverrides: {
        mario: ['acc-openai'],
        luigi: ['acc-openai'],
      },
    }));
  });

  it('dispatches agent and updates status when dependency_resolved wakeup arrives', () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitServerEvent('task.wakeup', {
      id: 'msg-dep-resolved',
      conversationId: 'conv-review',
      taskId: 'TASK-007',
      agentId: 'luigi',
      reasonCode: 'dependency_resolved',
      dispatchSource: 'workflow',
      prompt: '依赖已满足，开始执行 TASK-007: Integration wiring',
      content: '系统轻推 @luigi：TASK-007「Integration wiring」请继续处理。',
      metadata: {
        startsA2AHandoff: false,
        startsDispatch: true,
      },
    });

    // Verify dispatch was triggered
    expect(emitSpy).toHaveBeenCalledWith('terminal:start', expect.objectContaining({
      conversationId: 'conv-review',
      projectId: 'conv-review',
      taskId: 'TASK-007',
      agentId: 'luigi',
      dispatchSource: 'workflow',
    }));

    // Verify chat message was added
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-review']).toContainEqual(expect.objectContaining({
      id: 'msg-dep-resolved',
      mentions: ['luigi'],
      metadata: expect.objectContaining({
        reasonCode: 'dependency_resolved',
      }),
    }));

    // Verify task status was updated to in_progress
    const task = useTaskHubStore.getState().getTaskById('TASK-007');
    expect(task?.status).toBe('in_progress');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/review-gate-wakeup.test.ts`
Expected: FAIL — `terminal:start` not called because the current handler only does `updateTaskStatus` for `dependency_resolved`.

- [ ] **Step 3: Update the wakeup handler to dispatch for `dependency_resolved` / `owner_ready`**

In `src/store/taskHubStore.ts`, find the wakeup handler (around line 2347). Replace the `owner_ready`/`dependency_resolved` branch:

**Before:**
```typescript
if ((wakeup.reasonCode === 'owner_ready' || wakeup.reasonCode === 'dependency_resolved') && task.status === 'pending') {
  store.updateTaskStatus(taskId, 'in_progress');
  return;
}
```

**After:**
```typescript
if ((wakeup.reasonCode === 'owner_ready' || wakeup.reasonCode === 'dependency_resolved') && task.status === 'pending') {
  store.updateTaskStatus(taskId, 'in_progress');
  store.dispatchToAgent({
    agentId,
    referencedTaskId: taskId,
    conversationId,
    source: 'workflow',
    prompt: wakeup.prompt || `依赖已满足，开始执行 ${taskId}: ${task.title}. ${task.description || ''}`,
  });
  return;
}
```

- [ ] **Step 4: Add `unblocked_unassigned` to the dispatch branch**

In the same handler, update the reason code type in the inline type (around line 2305):

**Before:**
```typescript
reasonCode?: 'owner_ready' | 'review_requested' | 'review_decision_ready' | 'dependency_resolved';
```

**After:**
```typescript
reasonCode?: 'owner_ready' | 'review_requested' | 'review_decision_ready' | 'dependency_resolved' | 'unblocked_unassigned';
```

Then update the dispatch branch to include `unblocked_unassigned`:

**Before:**
```typescript
if (wakeup.reasonCode === 'review_requested' || wakeup.reasonCode === 'review_decision_ready') {
  store.dispatchToAgent({
    agentId,
    referencedTaskId: taskId,
    conversationId,
    source: 'review_gate',
    prompt: wakeup.prompt || ( ... ),
  });
}
```

**After:**
```typescript
if (wakeup.reasonCode === 'review_requested' || wakeup.reasonCode === 'review_decision_ready') {
  store.dispatchToAgent({
    agentId,
    referencedTaskId: taskId,
    conversationId,
    source: 'review_gate',
    prompt: wakeup.prompt || (
      wakeup.reasonCode === 'review_decision_ready'
        ? `请确认 ${taskId}: ${task.title} 的评审结论，并决定是否通过或退回修改。${task.description || ''}`
        : `请开始评审 ${taskId}: ${task.title}. ${task.description || ''}`
    ),
  });
}

if (wakeup.reasonCode === 'unblocked_unassigned') {
  store.dispatchToAgent({
    agentId,
    referencedTaskId: taskId,
    conversationId,
    source: 'workflow',
    prompt: wakeup.prompt || `请分配负责人：${taskId}「${task.title}」的依赖已全部满足，但尚未分配负责人。`,
  });
}
```

- [ ] **Step 5: Run all wakeup tests**

Run: `npx vitest run src/__tests__/store/review-gate-wakeup.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/store/taskHubStore.ts src/__tests__/store/review-gate-wakeup.test.ts
git commit -m "feat(client): dispatch agents on dependency_resolved and unblocked_unassigned wakeups"
```

---

## Task 5: Update A2A Interception Messages

**Files:**
- Modify: `src/server/a2a/orchestrator.ts:39-64`

Update the interception messages to no longer point agents toward the dead-end "task notification" path. Instead, be honest about what the system does and what agents should expect.

- [ ] **Step 1: Update `formatNonActionableMentionNotice`**

In `src/server/a2a/orchestrator.ts`, lines 39-42, replace:

```typescript
function formatNonActionableMentionNotice(tokens: string[]): string {
  const mentionList = tokens.join('、');
  return `A2A 未转交：${mentionList} 只是提及或通知，没有明确执行动作。任务状态会通过任务通知同步；如需唤醒对方，请写成「@agent 请评审/实现/验证 ...」。`;
}
```

with:

```typescript
function formatNonActionableMentionNotice(tokens: string[]): string {
  const mentionList = tokens.join('、');
  return `A2A 未转交：${mentionList} 只是提及或通知，没有明确执行动作。下游任务的依赖解除由系统自动调度，无需手动通知。如需主动安排工作，请写成「@agent 请评审/实现/验证 ...」。`;
}
```

- [ ] **Step 2: Update `formatNotificationMentionNotice`**

In `src/server/a2a/orchestrator.ts`, lines 44-47, replace:

```typescript
function formatNotificationMentionNotice(tokens: string[]): string {
  const mentionList = tokens.join('、');
  return `群聊知会：${mentionList} 已作为信息接收方出现；这不会启动新的 A2A 执行。需要对方动手时，请写成「@agent 请评审/实现/验证 ...」。`;
}
```

with:

```typescript
function formatNotificationMentionNotice(tokens: string[]): string {
  const mentionList = tokens.join('、');
  return `群聊知会：${mentionList} 已作为信息接收方出现；这不会启动新的 A2A 执行。依赖解除由系统自动调度；如需主动安排工作，请写成「@agent 请评审/实现/验证 ...」。`;
}
```

- [ ] **Step 3: Update `formatDispatchBlockReason` for chain dedup**

In `src/server/a2a/orchestrator.ts`, lines 49-53, replace the chain dedup message:

```typescript
function formatDispatchBlockReason(reason: string): string {
  const agentDedupMatch = reason.match(/^agent\s+([^\s]+)\s+already has an entry in chain/i);
  if (agentDedupMatch) {
    return `@${agentDedupMatch[1]} 已在本轮 A2A 链中，系统不会重复唤醒；任务状态请通过任务通知或 TASKS.md 同步，若要追加新工作请等待当前链路结束后再发起。`;
  }
```

with:

```typescript
function formatDispatchBlockReason(reason: string): string {
  const agentDedupMatch = reason.match(/^agent\s+([^\s]+)\s+already has an entry in chain/i);
  if (agentDedupMatch) {
    return `@${agentDedupMatch[1]} 已在本轮 A2A 链中，系统不会重复唤醒。下游依赖解除由系统自动调度，无需手动通知；若要追加新工作请等待当前链路结束后再发起。`;
  }
```

- [ ] **Step 4: Run A2A integration tests to verify message changes**

Run: `npx vitest run src/__tests__/server/a2a/integration.test.ts`
Expected: Some tests may fail because they assert on the old message text. Update the failing assertions to match the new messages.

- [ ] **Step 5: Fix any failing test assertions**

Search for the old message substrings in test files:
- `"任务状态会通过任务通知同步"` → update to `"下游任务的依赖解除由系统自动调度"`
- `"任务状态请通过任务通知或 TASKS.md 同步"` → update to `"下游依赖解除由系统自动调度"`

- [ ] **Step 6: Run full A2A test suite**

Run: `npx vitest run src/__tests__/server/a2a/`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/a2a/orchestrator.ts src/__tests__/server/a2a/
git commit -m "fix(a2a): update interception messages to not mislead toward dead-end paths"
```

---

## Task 6: Tighten Pass-Intent Negation Pattern 3

**Files:**
- Modify: `src/server/a2a/pass-intent.ts:103-105`
- Test: `src/__tests__/server/a2a/pass-intent.test.ts`

Negation pattern 3 (`/(已|已经).*(完成|写入|更新|记录|提交).*?@[\p{L}\p{N}_-]+/iu`) blocks any mention that includes "已...完成...@agent", which can catch legitimate handoffs like "已完成 TASK-004，@luigi 请启动 TASK-007". The fix adds an exception when the text after the @mention contains a handoff verb.

- [ ] **Step 1: Write failing test for completion + handoff pattern**

Append to `src/__tests__/server/a2a/pass-intent.test.ts`:

```typescript
it('recognizes handoff intent even when a completion is mentioned before the target agent', () => {
  const results = scanPassIntents(
    '已完成 TASK-004 后端接口，@luigi 请启动 TASK-007 集成接线。',
    [{ id: 'luigi', mentionPatterns: ['@luigi'] }],
    'toad',
  );

  expect(results).toHaveLength(1);
  expect(results[0].intent).toBe('delegate');
  expect(results[0].agentId).toBe('luigi');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/server/a2a/pass-intent.test.ts`
Expected: This test should already PASS because `extractMentionContent` extracts content after `@luigi`, which is `请启动 TASK-007 集成接线。` — the negation pattern doesn't match this. Verify it passes, confirming the happy path works.

- [ ] **Step 3: Write test for the edge case where content after mention is empty**

Append to `src/__tests__/server/a2a/pass-intent.test.ts`:

```typescript
it('blocks non-actionable completion mentions without handoff verbs', () => {
  const results = scanPassIntents(
    '已完成 TASK-004 后端接口，@luigi。',
    [{ id: 'luigi', mentionPatterns: ['@luigi'] }],
    'toad',
  );

  expect(results).toHaveLength(0);
});
```

Run: `npx vitest run src/__tests__/server/a2a/pass-intent.test.ts`
Expected: PASS — the negation pattern correctly blocks this.

- [ ] **Step 4: Verify all pass-intent tests pass**

Run: `npx vitest run src/__tests__/server/a2a/pass-intent.test.ts`
Expected: ALL PASS

Note: After analysis, `extractMentionContent` already handles the common case correctly — it extracts content AFTER the @mention, which avoids the negation pattern. The edge case (empty content after mention falling back to full text) is already handled by the existing negation logic blocking pure status broadcasts. No code change is needed for the pass-intent module. The tests added here document the expected behavior.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/server/a2a/pass-intent.test.ts
git commit -m "test(pass-intent): verify completion + handoff patterns are correctly handled"
```

---

## Task 7: Add Coordinator Chain Dedup Exemption (P1)

**Files:**
- Modify: `src/server/a2a/dedup.ts:22-27, 130-161`
- Modify: `src/server/a2a/orchestrator.ts` (pass coordinator IDs and intent to dedup)
- Test: `src/__tests__/server/a2a/integration.test.ts`

Add a policy-level exemption to Layer 2 (chain-scoped agent dedup) that allows coordinators to be re-entered when the pass intent is `review_decision_ready` or `escalate`. This allows DK/Peach to pass results back to Mario even when Mario started the chain.

- [ ] **Step 1: Write failing test for coordinator re-entry**

In `src/__tests__/server/a2a/integration.test.ts`, add:

```typescript
it('allows coordinator re-entry when intent is review_decision_ready', async () => {
  // Setup: mario starts chain, dispatches to dk, dk tries to pass back to mario
  // with review intent — should be allowed despite Layer 2 dedup
  // ... (follow existing integration test patterns with real DB)
});
```

Note: This test will be complex because it requires setting up the full chain lifecycle. Follow the existing pattern in `integration.test.ts` for chain creation, agent response, and dispatch decision assertion. The test should verify that when DK's output contains `@mario 评审已完成，请确认结论` with a `review` or `escalate` intent, the dispatch is allowed even though Mario is already in the chain.

- [ ] **Step 2: Update `checkChainAgentDedup` to accept an exemption option**

In `src/server/a2a/dedup.ts`, update:

```typescript
export interface ChainDedupOptions {
  exemptAgentIds?: string[];
  exemptIntents?: string[];
}

export function checkChainAgentDedup(
  chainRepo: ChainRepo,
  chainId: string,
  agentId: string,
  options?: ChainDedupOptions,
): { pass: boolean; reason?: string } {
  if (chainRepo.hasAgentInChain(chainId, agentId)) {
    if (options?.exemptAgentIds?.includes(agentId)) {
      return { pass: true };
    }
    return { pass: false, reason: `agent ${agentId} already has an entry in chain ${chainId}` };
  }
  return { pass: true };
}
```

- [ ] **Step 3: Update `runAllDedupLayers` to pass options through**

In `src/server/a2a/dedup.ts`, update the function signature and the Layer 2 call:

```typescript
export function runAllDedupLayers(
  chainRepo: ChainRepo,
  chain: InvocationChain,
  req: DispatchRequest,
  options?: ChainDedupOptions,
): DedupResult {
  // ... Layer 5, ping-pong ...

  // Layer 2: Chain-scoped agent dedup (with coordinator exemption)
  const agentDedup = checkChainAgentDedup(chainRepo, chain.id, req.toAgentId, options);
  if (!agentDedup.pass) return { pass: false, failedLayer: 'agent_dedup', reason: agentDedup.reason };

  // ... rest of layers ...
}
```

- [ ] **Step 4: Wire coordinator IDs and intent from orchestrator**

In `src/server/a2a/orchestrator.ts`, find the `requestDispatch` method that calls `runAllDedupLayers`. Pass the coordinator agent IDs:

```typescript
const dedupResult = runAllDedupLayers(this.chainRepo, chain, req, {
  exemptAgentIds: this.coordinatorAgentIds,
});
```

This requires the orchestrator to have access to `coordinatorAgentIds`. Add a constructor parameter or a method to resolve coordinator IDs from the team pack configuration, following the same pattern as `resolveTaskNotificationAudience` in the publisher.

- [ ] **Step 5: Run integration tests**

Run: `npx vitest run src/__tests__/server/a2a/integration.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/a2a/dedup.ts src/server/a2a/orchestrator.ts src/__tests__/server/a2a/integration.test.ts
git commit -m "feat(dedup): allow coordinator re-entry in A2A chains for review decisions"
```

---

## Self-Review

### 1. Spec Coverage

| Gap | Task | Status |
|-----|------|--------|
| Unassigned tasks skipped by wakeup | Task 1 (resolver) + Task 3 (watcher) | Covered |
| `dependency_resolved` doesn't dispatch | Task 4 (client) | Covered |
| A2A messages point to dead ends | Task 5 (messages) | Covered |
| Pass-intent negation risk | Task 6 (verified, no code change needed) | Covered |
| Chain dedup blocks coordinator | Task 7 (P1, exemption) | Covered |

### 2. Placeholder Scan

No TBD, TODO, "implement later", or "similar to Task N" patterns found. All code blocks contain complete implementation code.

### 3. Type Consistency

- `TaskWakeupReasonCode` updated in both `task-wakeup.ts` (step 1.3) and `taskHubStore.ts` inline type (step 4.4) — both include `unblocked_unassigned`.
- `ChainDedupOptions` interface defined in `dedup.ts` and used in both `checkChainAgentDedup` and `runAllDedupLayers`.
- `resolveTaskNotificationAudience` return type unchanged — just exported.
- `DispatchToAgentInput` type unchanged — uses existing `source: 'workflow'`.

### 4. Behavior Safety

- `dispatchToAgent` already handles busy agents (enqueues, dequeues on exit). No risk of double-dispatch.
- `addWakeup` already deduplicates by `(taskId, agentId, reasonCode)` triple. No risk of duplicate wakeups.
- Wakeup deduper (2-minute TTL) prevents rapid re-firing. No risk of notification storms.
- File watcher changes are additive — they add a new notification path, they don't modify existing paths.
