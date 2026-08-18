import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '../../lib/agent-context/ContextManager';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import { issueDispatchWorkContract, StaleA2APossessionError } from './dispatch-contract';

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

  it('binds an A2A reconciliation possession into callback authority', () => {
    db.prepare(`
      INSERT INTO a2a_possession_chain (
        id,conversation_id,root_trigger_type,root_trigger_id,status,current_holder_id,
        config,revision,created_at,updated_at,completed_at
      ) VALUES ('callback-chain-1','project-1','system','callback-root','active','lead',
        '{}',0,?,?,NULL)
    `).run(now.toISOString(), now.toISOString());
    db.prepare(`
      INSERT INTO a2a_possession (
        id,chain_id,holder_id,holder_type,status,parent_pass_id,revision,
        started_at,updated_at,completed_at,summary
      ) VALUES ('callback-possession-1','callback-chain-1','lead','agent','open',NULL,0,
        ?,?,NULL,NULL)
    `).run(now.toISOString(), now.toISOString());
    const snapshot: ContextSnapshot = {
      id: 'context-a2a-callback',
      query: {
        scenario: 'recovery',
        trigger: 'a2a_handoff',
        conversationId: 'project-1',
        agentId: 'lead',
        archetype: 'planner',
        budgetTokens: 1_000,
        requiredContributorIds: [],
        now: now.toISOString(),
        requestDigest: 'callback-digest',
      },
      fragmentRefs: [],
      capabilities: [],
      constraints: [],
      missingRequired: [],
      omissions: [],
      compiledPrompt: 'Synthesize parallel results.',
      createdAt: now.toISOString(),
    };
    const contract = issueDispatchWorkContract({
      trigger: {
        id: 'trigger-a2a-callback',
        source: 'a2a',
        conversationId: 'project-1',
        agentId: 'lead',
        workId: 'source-work',
        chainId: 'callback-chain-1',
        possessionId: 'callback-possession-1',
        possessionRevision: 0,
        prompt: 'Synthesize parallel results.',
      },
      traceId: 'trace-a2a-callback',
      contextSnapshot: snapshot,
      role: { id: 'lead' },
      runtime: {
        engine: 'codex',
        runtimeId: 'runtime-1',
        toolNames: [],
      },
    });

    expect(contract.authoritativeRefs).toContain('a2a_possession:callback-possession-1');
    expect(contract.authoritativeRevisions).toMatchObject({ a2aPossession: 0 });

    db.prepare(`
      UPDATE a2a_possession
      SET status='aborted',revision=revision+1,updated_at=?,completed_at=?
      WHERE id='callback-possession-1'
    `).run(now.toISOString(), now.toISOString());
    expect(() => issueDispatchWorkContract({
      trigger: {
        id: 'trigger-stale-a2a-callback',
        source: 'a2a',
        conversationId: 'project-1',
        agentId: 'lead',
        workId: 'source-work-after-abort',
        chainId: 'callback-chain-1',
        possessionId: 'callback-possession-1',
        possessionRevision: 0,
        prompt: 'Do not run this callback.',
      },
      traceId: 'trace-stale-a2a-callback',
      contextSnapshot: snapshot,
      role: { id: 'lead' },
      runtime: {
        engine: 'codex',
        runtimeId: 'runtime-1',
        toolNames: [],
      },
    })).toThrowError(StaleA2APossessionError);
  });
});
