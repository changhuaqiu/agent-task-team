import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '../../lib/agent-context/ContextManager';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import { issueDispatchWorkContract } from './dispatch-contract';

describe('issueDispatchWorkContract', () => {
  let db: Database.Database;
  const now = new Date('2026-08-18T00:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it.each(['review_gate', 'test_gate'] as const)(
    'authorizes a bounded continuation for %s work',
    (source) => {
      const task = taskRepo.create({
        id: `task-${source}`,
        conversation_id: 'project-1',
        title: 'Verify the artifact',
        agent_id: 'reviewer',
      }, now);
      const snapshot: ContextSnapshot = {
        id: `context-${source}`,
        query: {
          scenario: source === 'review_gate' ? 'code_review' : 'verification',
          trigger: 'user_turn',
          conversationId: 'project-1',
          agentId: 'reviewer',
          archetype: 'reviewer',
          taskId: task.id,
          budgetTokens: 1_000,
          requiredContributorIds: [],
          now: now.toISOString(),
          requestDigest: 'digest',
        },
        fragmentRefs: [],
        capabilities: [],
        constraints: [],
        missingRequired: [],
        omissions: [],
        compiledPrompt: 'Review the artifact.',
        createdAt: now.toISOString(),
      };

      const contract = issueDispatchWorkContract({
        trigger: {
          id: `trigger-${source}`,
          source,
          conversationId: 'project-1',
          agentId: 'reviewer',
          taskId: task.id,
          prompt: 'Review the artifact.',
        },
        traceId: `trace-${source}`,
        contextSnapshot: snapshot,
        task,
        role: { id: 'reviewer' },
        runtime: {
          engine: 'codex',
          runtimeId: 'runtime-1',
          toolNames: [],
        },
      });

      expect(contract.allowedOutcomeTypes).toEqual(expect.arrayContaining([
        'continue_work',
        'record_gate_decision',
      ]));
    },
  );
});
