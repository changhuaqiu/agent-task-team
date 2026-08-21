import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '../../lib/agent-context/ContextManager';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import {
  issueDispatchWorkContract,
  renderWorkContractInstruction,
  StaleA2APossessionError,
  workContractToolNames,
} from './dispatch-contract';
import type { ExecutionProfile } from '../invocation-pipeline/execution-profile';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';

const executionProfile: ExecutionProfile = {
  stage: 'implement',
  eligibleSkillIds: [],
  activatedSkills: [],
  requiredSkillIds: [],
  missingRequiredSkillNames: [],
  capabilities: [],
  exitPolicy: 'structured_outcome',
};

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
        executionProfile: {
          ...executionProfile,
          stage: source === 'review_gate' ? 'review' : 'verify',
          exitPolicy: 'gate_decision',
        },
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

  it('issues an outcome-only recovery contract without implementation tools or authorization', () => {
    const task = taskRepo.create({
      id: 'task-outcome-recovery',
      conversation_id: 'project-1',
      title: 'Recover the structured result',
      agent_id: 'implementer',
    }, now);
    const snapshot: ContextSnapshot = {
      id: 'context-outcome-recovery',
      query: {
        scenario: 'recovery',
        trigger: 'resume',
        conversationId: 'project-1',
        agentId: 'implementer',
        archetype: 'worker',
        taskId: task.id,
        budgetTokens: 1_000,
        requiredContributorIds: [],
        now: now.toISOString(),
        requestDigest: 'outcome-recovery-digest',
      },
      fragmentRefs: [],
      capabilities: [],
      constraints: [],
      missingRequired: [],
      omissions: [],
      compiledPrompt: 'Use the prior durable reply to submit the structured result.',
      createdAt: now.toISOString(),
    };

    const contract = issueDispatchWorkContract({
      trigger: {
        id: 'trigger-outcome-recovery',
        source: 'system',
        conversationId: 'project-1',
        agentId: 'implementer',
        taskId: task.id,
        executionMode: 'outcome_recovery',
        contextScenario: 'recovery',
        prompt: 'Submit the prior result only.',
      },
      traceId: 'trace-outcome-recovery',
      contextSnapshot: snapshot,
      task,
      role: { id: 'implementer' },
      executionProfile: { ...executionProfile, stage: 'recover', exitPolicy: 'outcome_recovery' },
      runtime: {
        engine: 'codex',
        runtimeId: 'runtime-1',
        toolNames: ['shell', 'edit_file', 'project_skill'],
      },
    });

    expect(workContractToolNames(contract)).toEqual(['agent_submit_outcome']);
    expect(contract.permissions).toMatchObject({
      executionMode: 'outcome_recovery',
      authorization: {},
    });
    const instruction = renderWorkContractInstruction(contract);
    expect(instruction).toContain('outcome-only recovery turn');
    expect(instruction).toContain('Do not repeat implementation');
    expect(instruction).toContain('Do not send a narrative assistant reply');
  });

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
      executionProfile,
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
      executionProfile,
      runtime: {
        engine: 'codex',
        runtimeId: 'runtime-1',
        toolNames: [],
      },
    })).toThrowError(StaleA2APossessionError);
  });

  it('rejects WorkContract issue when planning finishes after its owner terminates', () => {
    let task = taskRepo.create({
      id: 'task-terminal-race',
      conversation_id: 'project-1',
      title: 'Terminal race',
      agent_id: 'builder',
    }, now);
    const snapshot: ContextSnapshot = {
      id: 'context-terminal-race',
      query: {
        scenario: 'execution', trigger: 'task_wakeup', conversationId: 'project-1',
        agentId: 'builder', archetype: 'executor', taskId: task.id, budgetTokens: 1_000,
        requiredContributorIds: [], now: now.toISOString(), requestDigest: 'terminal-race',
      },
      fragmentRefs: [], capabilities: [], constraints: [], missingRequired: [], omissions: [],
      compiledPrompt: 'Execute', createdAt: now.toISOString(),
    };
    task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
    task = taskRepo.transition(task.id, { to: 'cancelled' }, now)!;

    expect(() => issueDispatchWorkContract({
      trigger: {
        id: 'trigger-terminal-task', source: 'workflow', conversationId: 'project-1',
        agentId: 'builder', taskId: task.id, prompt: 'Execute',
      },
      traceId: 'trace-terminal-task', contextSnapshot: snapshot, task,
      role: { id: 'builder' }, executionProfile,
      runtime: { engine: 'codex', runtimeId: 'runtime-1', toolNames: [] },
    })).toThrow(/Task owner is terminal/);

    const deliveryRepo = new AutonomousDeliveryRepository(db);
    const delivery = deliveryRepo.createRun({
      idempotencyKey: 'terminal-delivery-race', goal: 'Ship', acceptanceCriteria: ['Done'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true, allowPush: false, allowPullRequest: false, allowAutoMerge: false,
      },
      recoveryPolicy: { maxAttemptsPerAction: 2, maxRepairCycles: 1, stallTimeoutMs: 60_000 },
      deliveryPolicy: { requireReview: false, requireWebE2E: false, requireMerge: false },
    }, now).run;
    deliveryRepo.transitionRun({
      runId: delivery.id, to: 'failed', stage: 'planning', expectedRevision: delivery.revision, now,
    });

    expect(() => issueDispatchWorkContract({
      trigger: {
        id: 'trigger-terminal-delivery', source: 'system', conversationId: 'project-1',
        agentId: 'builder', deliveryRunId: delivery.id, prompt: 'Execute',
      },
      traceId: 'trace-terminal-delivery', contextSnapshot: snapshot,
      role: { id: 'builder' }, executionProfile,
      runtime: { engine: 'codex', runtimeId: 'runtime-1', toolNames: [] },
    })).toThrow(/Delivery owner is terminal/);
  });
});
