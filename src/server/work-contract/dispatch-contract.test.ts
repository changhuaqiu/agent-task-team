import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '../../lib/agent-context/ContextManager';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import {
  issueDispatchWorkContract,
  renderWorkContractInstruction,
  StaleA2APossessionError,
  workContractRuntimeToolNames,
  workContractToolNames,
} from './dispatch-contract';
import type { ExecutionProfile } from '../invocation-pipeline/execution-profile';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import type { DispatchAdmissionGrant, DispatchKind } from '../invocation-pipeline/dispatch-admission';
import type { TaskRow } from '../repositories/task-repo';
import { QualityGateRepository } from '../quality-gate/repository';
import { buildWorkIdentity } from './work-identity';

const executionProfile: ExecutionProfile = {
  stage: 'implement',
  eligibleSkillIds: [],
  activatedSkills: [],
  requiredSkillIds: [],
  missingRequiredSkillNames: [],
  capabilities: [],
  exitPolicy: 'structured_outcome',
};

function dispatchGrant(kind: DispatchKind = 'execution', task?: TaskRow): DispatchAdmissionGrant {
  const responsibility = kind === 'planning'
    ? 'coordinator'
    : kind === 'review' || kind === 'verification'
      ? 'reviewer'
      : 'implementer';
  return {
    kind,
    contextScenario: kind === 'planning' ? 'planning' : kind === 'review' ? 'code_review' : kind,
    archetype: responsibility === 'coordinator' ? 'planner' : responsibility === 'reviewer' ? 'reviewer' : 'worker',
    role: {
      definitionId: 'test-agent',
      definitionRevision: 1,
      name: 'Test Agent',
      responsibility,
      instructions: 'Test dispatch.',
      capabilities: { canModifyCode: kind === 'execution', canReview: responsibility === 'reviewer' },
    },
    allowCodeChanges: kind === 'execution',
    reasonCode: 'test_dispatch',
    ...(task ? {
      taskAuthority: { taskId: task.id, ownerAgentId: task.agent_id, revision: task.revision },
    } : {}),
  };
}

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

  it('removes every domain mutation tool while preserving read, verification, and outcome tools', () => {
    expect(workContractRuntimeToolNames([
      'task_list',
      'task_create',
      'task_update_status',
      'task_assign',
      'collaboration_record_pr',
      'collaboration_record_review',
      'collaboration_record_merge',
      'verification_serve_artifact',
      'shell',
    ])).toEqual([
      'shell',
      'task_list',
      'task_propose_graph',
      'task_request_review',
      'task_submit_result',
      'verification_serve_artifact',
      'work_continue',
      'work_handoff',
      'work_report_blocked',
      'work_request_human_decision',
    ]);
  });

  it.each(['review_gate', 'test_gate'] as const)(
    'authorizes a bounded continuation for %s work',
    (source) => {
      let task = taskRepo.create({
        id: `task-${source}`,
        conversation_id: 'project-1',
        title: 'Verify the artifact',
        agent_id: source === 'review_gate' ? 'implementer' : 'reviewer',
      }, now);
      let workId: string | undefined;
      if (source === 'review_gate') {
        task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
        task = taskRepo.transition(task.id, { to: 'in_review' }, now)!;
        const gate = new QualityGateRepository(db).request({
          conversationId: 'project-1',
          kind: 'code_review',
          targetType: 'task',
          targetId: task.id,
          artifactRevision: String(task.revision),
          criteria: { requiresIndependentReview: true },
          policy: { authorizedEvaluatorIds: ['reviewer'] },
          actor: { type: 'system', id: 'test' },
          now,
        });
        workId = buildWorkIdentity({
          scope: 'task',
          targetId: task.id,
          agentId: 'reviewer',
          gateId: gate.gate.id,
          purpose: 'review',
        });
      }
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
          workId,
          prompt: 'Review the artifact.',
        },
        traceId: `trace-${source}`,
        contextSnapshot: snapshot,
        task,
        role: { id: 'reviewer' },
        admission: dispatchGrant(source === 'review_gate' ? 'review' : 'verification'),
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

  it('atomically rejects Task review contracts for a stale or terminal Gate', () => {
    let task = taskRepo.create({
      id: 'task-stale-review-gate',
      conversation_id: 'project-1',
      title: 'Review current artifact',
      agent_id: 'implementer',
    }, now);
    task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
    task = taskRepo.transition(task.id, { to: 'in_review' }, now)!;
    const gates = new QualityGateRepository(db);
    const gate = gates.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: { requiresIndependentReview: true },
      policy: { authorizedEvaluatorIds: ['reviewer'] },
      actor: { type: 'system', id: 'test' },
      now,
    });
    let workId = buildWorkIdentity({
      scope: 'task',
      targetId: task.id,
      agentId: 'reviewer',
      gateId: gate.gate.id,
      purpose: 'review',
    });
    const snapshot: ContextSnapshot = {
      id: 'context-stale-review-gate',
      query: {
        scenario: 'code_review', trigger: 'review_request', conversationId: 'project-1',
        agentId: 'reviewer', archetype: 'reviewer', taskId: task.id, budgetTokens: 1_000,
        requiredContributorIds: [], now: now.toISOString(), requestDigest: 'stale-review-gate',
      },
      fragmentRefs: [], capabilities: [], constraints: [], missingRequired: [], omissions: [],
      compiledPrompt: 'Review', createdAt: now.toISOString(),
    };
    const issue = () => issueDispatchWorkContract({
      trigger: {
        id: 'trigger-stale-review-gate', source: 'review_gate', conversationId: 'project-1',
        agentId: 'reviewer', taskId: task.id, workId, prompt: 'Review',
      },
      traceId: 'trace-stale-review-gate', contextSnapshot: snapshot, task,
      role: { id: 'reviewer' }, admission: dispatchGrant('review'),
      executionProfile: { ...executionProfile, stage: 'review', exitPolicy: 'gate_decision' },
      runtime: { engine: 'codex', runtimeId: 'runtime-1', toolNames: [] },
    });

    task = taskRepo.update(task.id, { description: 'Artifact changed after review dispatch' })!;
    expect(issue).toThrow(/Task review Gate is missing, stale, or terminal/);

    const replacement = gates.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: { requiresIndependentReview: true },
      policy: { authorizedEvaluatorIds: ['reviewer'] },
      actor: { type: 'system', id: 'test' },
      now,
    });
    expect(replacement.gate.id).not.toBe(gate.gate.id);
    workId = buildWorkIdentity({
      scope: 'task',
      targetId: task.id,
      agentId: 'reviewer',
      gateId: replacement.gate.id,
      purpose: 'review',
    });
    gates.cancel({
      gateId: replacement.gate.id,
      actor: { type: 'system', id: 'test' },
      reason: 'test_terminal_gate',
      expectedRevision: replacement.gate.revision,
      now,
    });
    expect(issue).toThrow(/Task review Gate is missing, stale, or terminal/);
  });

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
      admission: dispatchGrant('recovery'),
      executionProfile: { ...executionProfile, stage: 'recover', exitPolicy: 'outcome_recovery' },
      runtime: {
        engine: 'codex',
        runtimeId: 'runtime-1',
        toolNames: ['shell', 'edit_file', 'project_skill'],
      },
    });

    expect(workContractToolNames(contract)).toEqual([
      'work_continue',
      'task_propose_graph',
      'task_submit_result',
      'task_request_review',
      'work_handoff',
      'work_report_blocked',
      'work_request_human_decision',
    ]);
    expect(contract.permissions).toMatchObject({
      executionMode: 'outcome_recovery',
      authorization: {},
    });
    const instruction = renderWorkContractInstruction(contract);
    expect(instruction).toContain('command-only recovery turn');
    expect(instruction).toContain('Do not repeat implementation');
    expect(instruction).toContain('Do not send a narrative assistant reply');
    expect(instruction).toContain('correct the structured payload and retry');
    expect(instruction).toContain('Never expose raw platform reason codes');
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
      admission: dispatchGrant('planning'),
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
      admission: dispatchGrant('planning'),
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
      admission: dispatchGrant('execution', task),
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
      admission: dispatchGrant(),
      runtime: { engine: 'codex', runtimeId: 'runtime-1', toolNames: [] },
    })).toThrow(/Delivery owner is terminal/);
  });

  it('rejects execution when the Task owner changes after admission', () => {
    const admittedTask = taskRepo.create({
      id: 'task-owner-race', conversation_id: 'project-1',
      title: 'Owner race', agent_id: 'builder',
    }, now);
    const admission = dispatchGrant('execution', admittedTask);
    taskRepo.update(admittedTask.id, { agent_id: 'replacement' });
    const snapshot: ContextSnapshot = {
      id: 'context-owner-race',
      query: {
        scenario: 'execution', trigger: 'task_wakeup', conversationId: 'project-1',
        agentId: 'builder', archetype: 'executor', taskId: admittedTask.id, budgetTokens: 1_000,
        requiredContributorIds: [], now: now.toISOString(), requestDigest: 'owner-race',
      },
      fragmentRefs: [], capabilities: [], constraints: [], missingRequired: [], omissions: [],
      compiledPrompt: 'Execute', createdAt: now.toISOString(),
    };

    expect(() => issueDispatchWorkContract({
      trigger: {
        id: 'trigger-owner-race', source: 'workflow', conversationId: 'project-1',
        agentId: 'builder', taskId: admittedTask.id, prompt: 'Execute',
      },
      traceId: 'trace-owner-race', contextSnapshot: snapshot, task: admittedTask,
      role: { id: 'builder' }, admission, executionProfile,
      runtime: { engine: 'codex', runtimeId: 'runtime-1', toolNames: [] },
    })).toThrow(/Task authority changed before contract issuance/);
  });

  it('allows Delivery Gate Work to keep a done Task as read-only artifact context', () => {
    let task = taskRepo.create({
      id: 'task-delivery-review-context', conversation_id: 'project-1',
      title: 'Completed artifact', agent_id: 'builder',
    }, now);
    task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
    task = taskRepo.transition(task.id, { to: 'in_review' }, now)!;
    task = taskRepo.transition(task.id, { to: 'done' }, now)!;
    const delivery = new AutonomousDeliveryRepository(db).createRun({
      idempotencyKey: 'active-delivery-review', goal: 'Review delivery', acceptanceCriteria: ['Passed'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true, allowPush: false, allowPullRequest: false, allowAutoMerge: false,
      },
      recoveryPolicy: { maxAttemptsPerAction: 2, maxRepairCycles: 1, stallTimeoutMs: 60_000 },
      deliveryPolicy: { requireReview: true, requireWebE2E: false, requireMerge: false },
    }, now).run;
    const snapshot: ContextSnapshot = {
      id: 'context-delivery-review',
      query: {
        scenario: 'code_review', trigger: 'review_request', conversationId: 'project-1',
        agentId: 'reviewer', archetype: 'reviewer', taskId: task.id, budgetTokens: 1_000,
        requiredContributorIds: [], now: now.toISOString(), requestDigest: 'delivery-review',
      },
      fragmentRefs: [], capabilities: [], constraints: [], missingRequired: [], omissions: [],
      compiledPrompt: 'Review delivery', createdAt: now.toISOString(),
    };
    const contract = issueDispatchWorkContract({
      trigger: {
        id: 'trigger-delivery-review', source: 'review_gate', conversationId: 'project-1',
        agentId: 'reviewer', taskId: task.id, deliveryRunId: delivery.id,
        prompt: 'Review delivery',
      },
      traceId: 'trace-delivery-review', contextSnapshot: snapshot, task,
      role: { id: 'reviewer' },
      admission: dispatchGrant('review'),
      executionProfile: { ...executionProfile, stage: 'review', exitPolicy: 'gate_decision' },
      runtime: { engine: 'codex', runtimeId: 'runtime-1', toolNames: [] },
    });

    expect(contract).toMatchObject({
      taskId: task.id,
      deliveryRunId: delivery.id,
      workId: `delivery:${delivery.id}:agent:reviewer:purpose:review`,
    });
  });

  it('rejects Task-scoped Gate Work after Task terminal even when it belongs to an active Delivery', () => {
    let task = taskRepo.create({
      id: 'task-terminal-review-race', conversation_id: 'project-1',
      title: 'Terminal review race', agent_id: 'builder',
    }, now);
    task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
    task = taskRepo.transition(task.id, { to: 'in_review' }, now)!;
    task = taskRepo.transition(task.id, { to: 'done' }, now)!;
    const delivery = new AutonomousDeliveryRepository(db).createRun({
      idempotencyKey: 'active-task-review-delivery', goal: 'Ship', acceptanceCriteria: ['Done'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true, allowPush: false, allowPullRequest: false, allowAutoMerge: false,
      },
      recoveryPolicy: { maxAttemptsPerAction: 2, maxRepairCycles: 1, stallTimeoutMs: 60_000 },
      deliveryPolicy: { requireReview: true, requireWebE2E: false, requireMerge: false },
    }, now).run;
    const snapshot: ContextSnapshot = {
      id: 'context-task-terminal-review',
      query: {
        scenario: 'code_review', trigger: 'review_request', conversationId: 'project-1',
        agentId: 'reviewer', archetype: 'reviewer', taskId: task.id, budgetTokens: 1_000,
        requiredContributorIds: [], now: now.toISOString(), requestDigest: 'task-terminal-review',
      },
      fragmentRefs: [], capabilities: [], constraints: [], missingRequired: [], omissions: [],
      compiledPrompt: 'Review Task', createdAt: now.toISOString(),
    };

    expect(() => issueDispatchWorkContract({
      trigger: {
        id: 'trigger-task-terminal-review', source: 'review_gate', conversationId: 'project-1',
        agentId: 'reviewer', taskId: task.id, deliveryRunId: delivery.id,
        workId: `task:${task.id}:agent:reviewer:purpose:review`, prompt: 'Review Task',
      },
      traceId: 'trace-task-terminal-review', contextSnapshot: snapshot, task,
      role: { id: 'reviewer' },
      admission: dispatchGrant('review'),
      executionProfile: { ...executionProfile, stage: 'review', exitPolicy: 'gate_decision' },
      runtime: { engine: 'codex', runtimeId: 'runtime-1', toolNames: [] },
    })).toThrow(/Task owner is terminal/);
  });
});
