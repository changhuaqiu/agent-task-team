import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollaborationKernel } from '@/server/collaboration-kernel';
import { createTestDb } from '@/server/db';
import { AgentInbox } from '@/server/platform-events/agent-inbox';
import {
  requestTaskWakeup,
  scenarioForWakeup,
} from '@/server/task-flow/task-work-request';
import type { TaskWakeup } from '@/server/task-flow/task-wakeup';

const wakeup: TaskWakeup = {
  id: 'wakeup-1',
  conversationId: 'conv-1',
  taskId: 'TASK-1',
  agentId: 'luigi',
  reasonCode: 'owner_ready',
  dispatchSource: 'workflow',
  prompt: 'Implement TASK-1',
  content: 'System wakeup',
  metadata: {
    taskId: 'TASK-1',
    taskTitle: 'Harness',
    taskStatus: 'pending',
    ownerAgentId: 'luigi',
    reasonCode: 'owner_ready',
    idempotencyKey: 'conv-1:TASK-1:luigi:owner_ready',
    startsA2AHandoff: false,
    startsDispatch: true,
  },
};

describe('Task Work Request', () => {
  let db: Database.Database;
  let inbox: AgentInbox;

  beforeEach(() => {
    db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('conv-1','Project','active',?,?)
    `).run(now, now);
    inbox = new AgentInbox({ db });
  });

  afterEach(() => db.close());

  it.each([
    ['chain_ready_for_closure', 'system', 'closure'],
    ['stale_review_gate', 'review_gate', 'recovery'],
    ['stale_test_gate', 'test_gate', 'recovery'],
    ['runnable_owned_idle', 'workflow', 'recovery'],
    ['missing_implementation_evidence', 'system', 'recovery'],
    ['missing_delivery_evidence', 'system', 'recovery'],
    ['unblocked_unassigned', 'workflow', 'planning'],
    ['review_decision_ready', 'review_gate', 'planning'],
    ['review_requested', 'review_gate', 'code_review'],
    ['test_requested', 'test_gate', 'verification'],
    ['owner_ready', 'workflow', 'execution'],
    ['dependency_resolved', 'workflow', 'execution'],
  ] as const)('maps %s wakeups to %s', (reasonCode, dispatchSource, scenario) => {
    expect(scenarioForWakeup({
      ...wakeup,
      reasonCode,
      dispatchSource,
      metadata: { ...wakeup.metadata, reasonCode },
    })).toBe(scenario);
  });

  it('persists a task wakeup through CollaborationKernel without a browser or coordinator', () => {
    const receipt = requestTaskWakeup(wakeup, {
      collaboration: new CollaborationKernel({ inbox }),
      deliveryRunId: 'delivery-1',
    });

    expect(receipt).toMatchObject({
      laneId: 'conv-1:luigi',
      replyTo: { type: 'task', id: 'TASK-1' },
    });
    expect(inbox.listPending('conv-1')).toEqual([
      expect.objectContaining({
        projectAgentId: 'luigi',
        command: expect.objectContaining({
          prompt: 'Implement TASK-1',
          taskId: 'TASK-1',
          deliveryRunId: 'delivery-1',
          contextScenario: 'execution',
          wakeup: expect.objectContaining({ reasonCode: 'owner_ready' }),
          replyTo: { type: 'task', id: 'TASK-1' },
        }),
      }),
    ]);
  });

  it('deduplicates a replay even when its display message id was regenerated', () => {
    const collaboration = new CollaborationKernel({ inbox });
    const first = requestTaskWakeup(wakeup, { collaboration });
    const replay = requestTaskWakeup({ ...wakeup, id: 'wakeup-after-restart' }, { collaboration });

    expect(replay).toEqual(first);
    expect(inbox.listPending('conv-1')).toHaveLength(1);
  });
});
