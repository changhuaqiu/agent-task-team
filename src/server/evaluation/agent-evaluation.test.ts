import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { AgentEvaluation } from './agent-evaluation';
import type { JudgePort } from './judge';
import type { EvaluationScore } from './types';
import { DEFAULT_RUBRIC_REVISION_ID, stableJson } from './defaults';
import { evaluationOperations } from './operations';
import { buildSubjectSnapshot } from './snapshot-builder';
import { evaluateDeterministically } from './deterministic-evaluator';
import { A2ACollaborationRepository } from '../a2a/collaboration';
import { WorkContractRepository } from '../work-contract/repository';

const now = '2026-07-19T00:00:00.000Z';
const judgeScores: EvaluationScore[] = ['correctness', 'instruction_following', 'collaboration', 'clarity'].map((dimensionKey) => ({
  dimensionKey, evaluatorKind: 'judge', evaluatorRevision: 'test-judge-v1',
  applicability: 'applicable', normalizedScore: 90, label: 'pass',
  rationale: '校准 Judge 结果', evidenceRefs: [],
}));
const judge: JudgePort = {
  async evaluate() {
    return { scores: judgeScores, attempt: { promptDigest: 'test', requestParams: {}, parseStatus: 'parsed', latencyMs: 1 } };
  },
};

beforeEach(() => {
  setTestDb(createTestDb());
  const db = getDb();
  db.prepare(`INSERT INTO conversation
    (id,title,status,project_path,participants,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run('conv-eval', '评估项目', 'active', null, '[]', now, now);
  db.prepare(`INSERT INTO task
    (id,conversation_id,title,status,agent_id,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run('task-root', 'conv-eval', '根任务', 'done', 'coordinator', now, now, now);
  db.prepare(`INSERT INTO task_action
    (id,conversation_id,actor_id,actor_type,type,task_ids,payload,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run('action-done', 'conv-eval', 'coordinator', 'agent', 'task.status_changed', '["task-root"]',
      '{"status":"done","evidence":{"mergedToMain":true,"mainInstallResult":"pass","mainBuildResult":"pass","mainTestResult":"pass","mainImpactReviewResult":"pass"}}', now);
  db.prepare(`INSERT INTO control_proof_event
    (id,event_type,conversation_id,task_id,agent_id,metadata,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run('proof-close', 'chain_closure_dispatched', 'conv-eval', 'task-root', 'coordinator', '{}', now);
  db.prepare(`INSERT INTO observation_span
    (span_id,trace_id,name,kind,status,conversation_id,task_id,agent_id,attributes,input_preview,output_preview,started_at,ended_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'span-1', 'trace-1', 'agent turn', 'agent', 'ok', 'conv-eval', 'task-root', 'coordinator', '{}',
      'authorization=secret-value', 'done', now, now);
  db.prepare(`INSERT INTO observation_span_payload
    (span_id,role,seq,content,byte_size,truncated,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run('span-1', 'thinking', 0, 'private reasoning', 17, 0, now);
});
afterEach(() => resetDb());

describe('AgentEvaluation', () => {
  it('rejects an online project-wide evaluation without a root task', () => {
    expect(() => new AgentEvaluation(judge).submit({
      conversationId: 'conv-eval',
      evidenceCutoffAt: now,
    })).toThrow('evaluation_root_task_required');
    expect(() => new AgentEvaluation(judge).submit({
      conversationId: 'conv-eval', mode: 'replay', evidenceCutoffAt: now,
    })).toThrow('evaluation_replay_source_required');
  });

  it('excludes unrelated conversation invocations from root-task reliability', () => {
    const db = getDb();
    db.prepare(`INSERT INTO invocation
      (id,conversation_id,task_id,agent_id,status,engine,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      'invocation-root', 'conv-eval', 'task-root', 'luigi', 'planned', 'codex', now, now,
    );
    db.prepare(`INSERT INTO invocation
      (id,conversation_id,task_id,agent_id,status,engine,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      'invocation-unrelated', 'conv-eval', null, 'other-agent', 'planned', 'codex', now, now,
    );
    db.prepare(`INSERT INTO observation_span
      (span_id,trace_id,name,kind,status,conversation_id,task_id,agent_id,invocation_id,attributes,started_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      'span-unrelated', 'trace-unrelated', 'unrelated turn', 'agent', 'running',
      'conv-eval', null, 'other-agent', 'invocation-unrelated', '{}', now,
    );

    const snapshot = buildSubjectSnapshot({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
    });
    const evidence = snapshot.evidence as Record<string, Array<Record<string, unknown>>>;
    expect(evidence.invocations.map((item) => item.id)).toEqual(['invocation-root']);
    expect(evidence.spans.map((item) => item.span_id)).not.toContain('span-unrelated');
  });

  it('freezes WorkAuthority and AgentOutcome as completion-path evidence', () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'task:task-root:agent:coordinator',
      attemptId: 'attempt-eval-path',
      projectId: 'conv-eval',
      taskId: 'task-root',
      agentId: 'coordinator',
      goal: 'Complete the root task',
      acceptanceCriteria: ['current gate passed'],
      role: { name: 'coordinator' },
      permissions: { tools: [] },
      authoritativeRefs: ['task:task-root'],
      authoritativeRevisions: { task: 0 },
      contextSnapshotRef: 'context-eval-path',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'trace-eval-path',
      causationId: 'action-done',
      now: new Date(now),
    });
    const admission = contracts.admitOutcome({
      outcomeId: 'outcome-eval-path',
      idempotencyKey: 'outcome-eval-path-key',
      contractId: contract.contractId,
      outcomeType: 'submit_task_result',
      payload: { summary: 'done' },
      evidenceRefs: ['artifact:root-delivery'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: now,
    }, new Date(now));
    expect(admission.status).toBe('accepted');

    const snapshot = buildSubjectSnapshot({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
    });
    const evidence = snapshot.evidence as Record<string, Array<Record<string, unknown>>>;
    expect(evidence.authorities).toEqual([
      expect.objectContaining({ work_id: contract.workId, status: 'active' }),
    ]);
    expect(evidence.outcomes).toEqual([
      expect.objectContaining({ id: 'outcome-eval-path', admission_status: 'accepted' }),
    ]);
    expect(snapshot.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'work_authority', id: contract.workId }),
      expect.objectContaining({ kind: 'agent_outcome', id: 'outcome-eval-path' }),
    ]));
  });

  it('does not let Task state changed after cutoff inflate historical completion', () => {
    const later = '2026-07-19T00:01:00.000Z';
    getDb().prepare(`INSERT INTO task
      (id,conversation_id,title,status,agent_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      'task-late-completion', 'conv-eval', 'Late completion', 'in_review', 'luigi', now, now,
    );
    getDb().prepare(`INSERT INTO task_edge
      (id,conversation_id,from_task_id,to_task_id,type,created_by_action_id,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      'edge-late-completion', 'conv-eval', 'task-late-completion', 'task-root',
      'subtask_of', 'action-done', now,
    );
    getDb().prepare(`UPDATE task
      SET status='done',completed_at=?,updated_at=? WHERE id='task-late-completion'`)
      .run(later, later);

    const snapshot = buildSubjectSnapshot({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
    });

    expect((snapshot.evidence as { lateFacts: string[] }).lateFacts)
      .toContain('task:task-late-completion');
    expect(snapshot.dataQuality.missing).toContain('mutable_state_at_cutoff');
    expect(evaluateDeterministically(snapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dimensionKey: 'gate.task_completion', label: 'unknown', applicability: 'unknown',
        normalizedScore: undefined,
      }),
      expect.objectContaining({
        dimensionKey: 'completion', label: 'unknown', applicability: 'unknown',
        normalizedScore: undefined,
      }),
    ]));
  });

  it('discovers A2A groups from task membership without a manually supplied chain id', () => {
    getDb().prepare(`INSERT INTO task
      (id,conversation_id,title,status,agent_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      'task-unrelated', 'conv-eval', '同链无关任务', 'ready', 'peach', now, now,
    );
    const collaboration = new A2ACollaborationRepository({ db: getDb(), now: () => new Date(now) });
    const created = collaboration.createChain({
      conversationId: 'conv-eval',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'command-for-root-task',
      holderId: 'mario',
      holderType: 'agent',
    });
    const related = collaboration.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: created.rootPossession.revision,
      idempotencyKey: 'root-task-fanout',
      branches: [
        {
          toAgentId: 'luigi', intent: 'implement', taskId: 'task-root',
          packet: {
            title: '实现', requestedAction: '实现根任务', possessionSummary: '按验收标准实现',
            relevantDecisions: [], evidenceRefs: [], constraints: [], openQuestions: [],
            forbiddenBehaviors: [], sourceMessageIds: [],
          },
        },
        {
          toAgentId: 'peach', intent: 'review', taskId: 'task-root',
          packet: {
            title: '复核', requestedAction: '复核根任务', possessionSummary: '检查实现与证据',
            relevantDecisions: [], evidenceRefs: [], constraints: [], openQuestions: [],
            forbiddenBehaviors: [], sourceMessageIds: [],
          },
        },
      ],
    });
    const admitted = collaboration.markPassAdmitted(related.passes[0]!.id, related.passes[0]!.revision);
    const starting = collaboration.markPassStarting(admitted.id, admitted.revision);
    const started = collaboration.markPassStarted(starting.id, starting.revision);
    const unrelated = collaboration.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: started.possession.id,
      expectedSourceRevision: started.possession.revision,
      idempotencyKey: 'unrelated-same-chain',
      branches: [{
        toAgentId: 'toad', intent: 'verify', taskId: 'task-unrelated',
        packet: {
          title: '无关复核', requestedAction: '处理另一个任务', possessionSummary: '不属于根任务闭包',
          relevantDecisions: [], evidenceRefs: [], constraints: [], openQuestions: [],
          forbiddenBehaviors: [], sourceMessageIds: [],
        },
      }],
    });

    const snapshot = buildSubjectSnapshot({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
    });
    const evidence = snapshot.evidence as Record<string, Array<Record<string, unknown>>>;
    expect(evidence.chains).toHaveLength(1);
    expect(evidence.passGroups).toHaveLength(1);
    expect(evidence.passes).toHaveLength(2);
    expect(evidence.passGroups.map((group) => group.id)).not.toContain(unrelated.group.id);
    expect(evidence.passes.map((pass) => pass.id)).not.toContain(unrelated.passes[0]!.id);
    expect(snapshot.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'event', chainId: created.chain.id, passId: related.passes[0]!.id,
      }),
    ]));
    expect(snapshot.chainId).toBeUndefined();
    expect(evaluateDeterministically(snapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimensionKey: 'gate.handoff_receipts', label: 'fail' }),
      expect.objectContaining({ dimensionKey: 'handoff_reliability', normalizedScore: 50 }),
      expect.objectContaining({ dimensionKey: 'fanout_join', normalizedScore: 0 }),
    ]));
  });

  it('discovers delivery-bound collaboration even before a task-bound WorkContract exists', () => {
    getDb().prepare(`INSERT INTO autonomous_delivery_run
      (id,conversation_id,root_task_id,start_idempotency_key,status,current_stage,goal_contract_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'delivery-root', 'conv-eval', 'task-root', 'delivery-root-start', 'active', 'executing', '{}', now, now,
    );
    const collaboration = new A2ACollaborationRepository({ db: getDb(), now: () => new Date(now) });
    const created = collaboration.createChain({
      conversationId: 'conv-eval', rootTriggerType: 'system', rootTriggerId: 'delivery-root',
      holderId: 'mario', holderType: 'agent',
    });
    const offered = collaboration.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: created.rootPossession.revision,
      deliveryRunId: 'delivery-root',
      idempotencyKey: 'delivery-bound-handoff',
      branches: [{
        toAgentId: 'luigi', intent: 'implement',
        packet: {
          title: '实现', requestedAction: '执行 Delivery 工作', possessionSummary: '根任务交付分支',
          relevantDecisions: [], evidenceRefs: [], constraints: [], openQuestions: [],
          forbiddenBehaviors: [], sourceMessageIds: [],
        },
      }],
    });

    const snapshot = buildSubjectSnapshot({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
    });
    const evidence = snapshot.evidence as Record<string, Array<Record<string, unknown>>>;
    expect(evidence.passGroups.map((group) => group.id)).toEqual([offered.group.id]);
    expect(evidence.passes.map((pass) => pass.id)).toEqual([offered.passes[0]!.id]);
  });

  it('does not project mutable pass state that changed after a historical cutoff', () => {
    let clock = new Date(now);
    const collaboration = new A2ACollaborationRepository({ db: getDb(), now: () => clock });
    const created = collaboration.createChain({
      conversationId: 'conv-eval', rootTriggerType: 'system', rootTriggerId: 'task-root',
      holderId: 'mario', holderType: 'agent',
    });
    const offered = collaboration.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: created.rootPossession.revision,
      idempotencyKey: 'late-pass',
      branches: [{
        toAgentId: 'luigi', intent: 'implement', taskId: 'task-root',
        packet: {
          title: '实现', requestedAction: '执行', possessionSummary: '历史边界测试',
          relevantDecisions: [], evidenceRefs: [], constraints: [], openQuestions: [],
          forbiddenBehaviors: [], sourceMessageIds: [],
        },
      }],
    });
    clock = new Date('2026-07-19T00:01:00.000Z');
    collaboration.markPassAdmitted(offered.passes[0]!.id, offered.passes[0]!.revision);

    const snapshot = buildSubjectSnapshot({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
    });
    const evidence = snapshot.evidence as Record<string, Array<Record<string, unknown>>>;
    expect(evidence.passes).toEqual([]);
    expect(snapshot.dataQuality.missing).toContain('handoff_receipts');
  });

  it('reports duplicate Work attempts, repeated passes, and task reopen as rework', () => {
    const snapshot = buildSubjectSnapshot({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
    });
    snapshot.evidence = {
      ...snapshot.evidence,
      chains: [{ id: 'chain-rework' }],
      passGroups: [],
      invocations: [
        { id: 'inv-1', work_id: 'work-repeat', agent_id: 'luigi', status: 'terminated', outcome: 'failed' },
        { id: 'inv-2', work_id: 'work-repeat', agent_id: 'luigi', status: 'terminated', outcome: 'completed' },
      ],
      passes: [
        { id: 'pass-1', chain_id: 'chain-rework', from_holder_id: 'mario', to_agent_id: 'luigi', task_id: 'task-root', intent: 'implement' },
        { id: 'pass-2', chain_id: 'chain-rework', from_holder_id: 'mario', to_agent_id: 'luigi', task_id: 'task-root', intent: 'implement' },
      ],
      taskActions: [{
        id: 'reopen-action', payload: { previousStatus: 'in_review', status: 'in_progress' },
      }],
    };
    expect(evaluateDeterministically(snapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dimensionKey: 'collaboration_rework', label: 'fail', normalizedScore: 40,
        rationale: '重复 Work 调用 1，重复交接 1，任务 reopen 1。',
      }),
    ]));
  });

  it('keeps recovery score event evidence drillable to its collaboration branch', () => {
    const snapshot = buildSubjectSnapshot({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
    });
    snapshot.evidence = {
      ...snapshot.evidence,
      chains: [{ id: 'chain-recovery' }],
      passGroups: [{ id: 'group-recovery', status: 'completed', expected_count: 1, resolved_count: 1 }],
      passes: [{ id: 'pass-recovery', group_id: 'group-recovery', status: 'completed' }],
      collaborationEvents: [{
        id: 'event-recovery', type: 'a2a.pass.group_recovery_opened',
        payload: { chainId: 'chain-recovery', passId: 'pass-recovery' },
      }],
    };

    const recovery = evaluateDeterministically(snapshot)
      .find((item) => item.dimensionKey === 'collaboration_recovery');
    expect(recovery?.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'event', id: 'event-recovery', chainId: 'chain-recovery', passId: 'pass-recovery',
      }),
    ]));
  });

  it('persists one idempotent job and produces a replayable report', async () => {
    const service = new AgentEvaluation(judge);
    const request = { conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now } as const;
    const first = service.submit(request);
    const duplicate = new AgentEvaluation(judge).submit(request);
    expect(duplicate).toMatchObject({ runId: first.runId, duplicate: true });
    getDb().prepare(`UPDATE task SET status='ready',updated_at=? WHERE id='task-root'`)
      .run('2026-07-19T00:01:00.000Z');

    expect(await service.processPending()).toBe(1);
    const report = service.getReport(first.runId, 'conv-eval')!;
    expect(report.run.status).toBe('partial');
    expect(report.run.gate_status).toBe('pass');
    expect(report.run.overall_score).toBeGreaterThan(80);
    const evidence = report.snapshot!.evidence_payload as Record<string, Array<Record<string, unknown>>>;
    expect(evidence.payloads ?? []).toEqual([]);
    expect(evidence.tasks[0]?.status).toBe('done');
    expect(JSON.stringify(evidence.spans)).not.toContain('secret-value');

    const replay = service.replay(first.runId, 'conv-eval');
    expect(await service.processPending()).toBe(1);
    const replayReport = service.getReport(replay.runId)!;
    expect(replayReport.snapshot!.snapshot_hash).toBe(report.snapshot!.snapshot_hash);
    expect(replayReport.run.overall_score).toBe(report.run.overall_score);
    getDb().prepare(`INSERT INTO conversation
      (id,title,status,participants,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run('conv-other', '其他项目', 'active', '[]', now, now);
    expect(() => service.replay(first.runId, 'conv-other')).toThrow('Completed source run not found');
  });

  it('keeps duplicate closure submission P95 below 500ms across restarted service instances', () => {
    const request = {
      conversationId: 'conv-eval',
      rootTaskId: 'task-root',
      evidenceCutoffAt: now,
      triggerId: 'same-closure-proof',
    } as const;
    const runIds = new Set<string>();
    const latencies = Array.from({ length: 60 }, () => {
      const started = performance.now();
      runIds.add(new AgentEvaluation(judge).submit(request).runId);
      return performance.now() - started;
    }).sort((left, right) => left - right);
    const p95 = latencies[Math.floor((latencies.length - 1) * 0.95)]!;
    expect(runIds.size).toBe(1);
    expect(p95).toBeLessThan(500);
  });

  it('keeps a fresh high-cardinality root snapshot submission below 500ms', () => {
    const db = getDb();
    const insertInvocation = db.prepare(`INSERT INTO invocation
      (id,conversation_id,task_id,agent_id,status,engine,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    const insertSpan = db.prepare(`INSERT INTO observation_span
      (span_id,trace_id,name,kind,status,conversation_id,task_id,agent_id,invocation_id,attributes,started_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    db.transaction(() => {
      for (let index = 0; index < 300; index += 1) {
        const invocationId = `fresh-invocation-${index}`;
        insertInvocation.run(invocationId, 'conv-eval', 'task-root', `agent-${index % 4}`,
          'planned', 'codex', now, now);
        insertSpan.run(`fresh-span-${index}`, `fresh-trace-${index}`, 'agent turn', 'agent', 'running',
          'conv-eval', 'task-root', `agent-${index % 4}`, invocationId, '{}', now);
      }
    })();

    const started = performance.now();
    new AgentEvaluation(judge).submit({
      conversationId: 'conv-eval', rootTaskId: 'task-root', triggerId: 'fresh-high-cardinality',
    });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('does not let an overall score conceal a failed hard gate', async () => {
    getDb().prepare(`INSERT INTO control_proof_event
      (id,event_type,conversation_id,task_id,agent_id,reason_code,metadata,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run('proof-invalid', 'no_valid_exit', 'conv-eval', 'task-root',
        'coordinator', 'missing_closure_report', '{}', now);
    const service = new AgentEvaluation(judge);
    const run = service.submit({ conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now });
    await service.processPending();
    const report = service.getReport(run.runId)!;
    expect(report.run.gate_status).toBe('fail');
    expect(report.run.overall_score).toBeLessThanOrEqual(59);
  });

  it('aggregates Mario, Luigi, and Peach traces into one frozen task subject', async () => {
    const db = getDb();
    const insertSpan = db.prepare(`INSERT INTO observation_span
      (span_id,trace_id,name,kind,status,conversation_id,task_id,agent_id,attributes,started_at,ended_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insertSpan.run('span-luigi', 'trace-luigi', 'implementation', 'agent', 'ok',
      'conv-eval', 'task-root', 'luigi', '{}', now, now);
    insertSpan.run('span-peach', 'trace-peach', 'review', 'agent', 'ok',
      'conv-eval', 'task-root', 'peach', '{}', now, now);
    const service = new AgentEvaluation(judge);
    const started = performance.now();
    const run = service.submit({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now,
      triggerId: 'mario-luigi-peach-closure',
    });
    expect(performance.now() - started).toBeLessThan(500);
    await service.processPending();
    const report = service.getReport(run.runId)!;
    const refs = report.snapshot!.evidence_refs as Array<{ kind: string; traceId?: string }>;
    expect(new Set(refs.filter((ref) => ref.kind === 'span').map((ref) => ref.traceId)))
      .toEqual(new Set(['trace-1', 'trace-luigi', 'trace-peach']));
    expect(report.snapshot!.app_manifest).toMatchObject({
      rubricRevisionId: DEFAULT_RUBRIC_REVISION_ID,
    });
  });

  it('rejects a chain owned by another conversation', () => {
    const db = getDb();
    db.prepare(`INSERT INTO conversation
      (id,title,status,participants,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run('conv-foreign', '外部项目', 'active', '[]', now, now);
    db.prepare(`INSERT INTO a2a_possession_chain
      (id,conversation_id,root_trigger_type,root_trigger_id,status,current_holder_id,config,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
        'chain-foreign', 'conv-foreign', 'task', 'foreign-task', 'active', 'agent-x', '{}', now);
    const service = new AgentEvaluation(judge);
    expect(() => service.submit({
      conversationId: 'conv-eval', rootTaskId: 'task-root', chainId: 'chain-foreign', evidenceCutoffAt: now,
    })).toThrow('Chain does not belong to conversation');
  });

  it('routes boundary-score Judge disagreement to human review without averaging', async () => {
    const db = getDb();
    db.prepare(`INSERT INTO eval_policy
      (conversation_id,enabled,sampling_rate,daily_token_budget,judge_account_id,secondary_judge_account_id,
       allowed_providers,retention_days,fail_strategy,updated_by,updated_at)
      VALUES (?,1,1,50000,?,?,'["openai","anthropic"]',180,'partial','test',?)`)
      .run('conv-eval', 'judge-primary', 'judge-secondary', now);
    const dualJudge: JudgePort = {
      async evaluate(_snapshot, accountId) {
        const primary = accountId === 'judge-primary';
        return {
          scores: judgeScores.map((score, index) => index === 0 ? {
            ...score,
            normalizedScore: primary ? 200 / 3 : 0,
            label: primary ? 'partial' : 'fail',
          } : score),
          attempt: {
            accountId, promptDigest: `digest-${accountId}`, requestParams: {},
            parseStatus: 'parsed', latencyMs: 1,
          },
        };
      },
    };
    const service = new AgentEvaluation(dualJudge);
    const run = service.submit({ conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now });
    await service.processPending();
    const report = service.getReport(run.runId)!;
    expect(report.run).toMatchObject({ status: 'partial', error_code: 'human_review_required' });
    expect(report.judgeAttempts).toHaveLength(2);
    expect(report.reviewQueue).toHaveLength(1);
    expect(report.reviewQueue[0]).toMatchObject({
      dimension_key: 'correctness', reason_code: 'judge_disagreement',
      primary_label: 'partial', secondary_label: 'fail', status: 'pending',
    });
    expect(report.scores.find((score) => score.dimension_key === 'correctness' &&
      score.evaluator_kind === 'judge')).toMatchObject({ label: 'unknown', normalized_score: null });
  });

  it('keeps deterministic results when the daily Judge budget is exhausted', async () => {
    getDb().prepare(`INSERT INTO eval_policy
      (conversation_id,enabled,sampling_rate,daily_token_budget,allowed_providers,
       retention_days,fail_strategy,updated_by,updated_at)
      VALUES (?,1,1,0,'["openai","anthropic"]',180,'partial','test',?)`).run('conv-eval', now);
    let judgeCalls = 0;
    const service = new AgentEvaluation({ async evaluate() {
      judgeCalls += 1;
      return judge.evaluate({} as never);
    } });
    const run = service.submit({ conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now });
    await service.processPending();
    const report = service.getReport(run.runId)!;
    expect(judgeCalls).toBe(0);
    expect(report.run).toMatchObject({ status: 'partial', error_code: 'budget_exhausted' });
    expect(report.scores.some((score) => score.evaluator_kind === 'deterministic')).toBe(true);
  });

  it('atomically reserves the daily Judge budget across concurrent workers', async () => {
    const db = getDb();
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let judgeCalls = 0;
    const blockingJudge: JudgePort = {
      async evaluate() {
        judgeCalls += 1;
        await wait;
        return judge.evaluate({} as never);
      },
    };
    const firstService = new AgentEvaluation(blockingJudge);
    const secondService = new AgentEvaluation(blockingJudge);
    const first = firstService.submit({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now, triggerId: 'budget-first',
    });
    const second = firstService.submit({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now, triggerId: 'budget-second',
    });
    const snapshot = db.prepare(`SELECT s.* FROM eval_subject_snapshot s JOIN eval_run r ON r.snapshot_id=s.id
      WHERE r.id=?`).get(first.runId) as Record<string, unknown>;
    const oneRequestBudget = Math.max(
      4_000,
      Math.min(24_000, stableJson(JSON.parse(String(snapshot.evidence_payload))).length) + 2_500,
    );
    db.prepare(`INSERT INTO eval_policy
      (conversation_id,enabled,sampling_rate,daily_token_budget,max_concurrency,allowed_providers,
       retention_days,fail_strategy,updated_by,updated_at)
      VALUES (?,1,1,?,2,'["openai","anthropic"]',180,'partial','test',?)`)
      .run('conv-eval', oneRequestBudget + 100, now);
    const firstWorker = firstService.processPending(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await secondService.processPending(1)).toBe(1);
    expect(judgeCalls).toBe(1);
    expect(secondService.getReport(second.runId)!.run).toMatchObject({
      status: 'partial', error_code: 'budget_exhausted',
    });
    release!();
    expect(await firstWorker).toBe(1);
    expect(db.prepare('SELECT COUNT(*) count FROM eval_budget_reservation').get()).toEqual({ count: 0 });
  });

  it('completes a multi-worker capacity drill within the local SLO and concurrency limit', async () => {
    const db = getDb();
    db.prepare(`INSERT INTO eval_policy
      (conversation_id,enabled,sampling_rate,daily_token_budget,max_concurrency,allowed_providers,
       retention_days,fail_strategy,updated_by,updated_at)
      VALUES (?,1,1,1000000,4,'["openai","anthropic"]',180,'partial','test',?)`)
      .run('conv-eval', now);
    let active = 0;
    let maxActive = 0;
    let judgeCalls = 0;
    const capacityJudge: JudgePort = {
      async evaluate() {
        judgeCalls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active -= 1;
        return {
          scores: judgeScores,
          attempt: {
            promptDigest: `capacity-${judgeCalls}`,
            requestParams: {},
            parseStatus: 'parsed',
            promptTokens: 100,
            completionTokens: 50,
            latencyMs: 1,
          },
        };
      },
    };
    const submitter = new AgentEvaluation(capacityJudge);
    const runIds = Array.from({ length: 24 }, (_, index) => submitter.submit({
      conversationId: 'conv-eval',
      rootTaskId: 'task-root',
      evidenceCutoffAt: now,
      triggerId: `capacity-${index}`,
    }).runId);
    const workers = Array.from({ length: 4 }, () => new AgentEvaluation(capacityJudge));
    const started = performance.now();
    const processed = await Promise.all(workers.map((worker) => worker.processPending(6)));
    const elapsedMs = performance.now() - started;

    expect(processed.reduce((sum, value) => sum + value, 0)).toBe(24);
    expect(judgeCalls).toBe(24);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(elapsedMs).toBeLessThan(120_000);
    expect((db.prepare(`SELECT COUNT(*) count FROM eval_job
      WHERE run_id IN (${runIds.map(() => '?').join(',')}) AND status='completed'`)
      .get(...runIds) as { count: number }).count).toBe(24);
    expect(evaluationOperations.status('conv-eval').performance).toMatchObject({
      target_ms: 120_000,
      status: 'pass',
      sample_size: 24,
    });
  });

  it('retries a transient Judge failure and never exceeds project concurrency', async () => {
    const db = getDb();
    db.prepare(`INSERT INTO eval_policy
      (conversation_id,enabled,sampling_rate,daily_token_budget,max_concurrency,allowed_providers,
       retention_days,fail_strategy,updated_by,updated_at)
      VALUES (?,1,1,50000,1,'["openai","anthropic"]',180,'partial','test',?)`).run('conv-eval', now);
    let attempts = 0;
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const transientJudge: JudgePort = {
      async evaluate() {
        attempts += 1;
        if (attempts === 1) {
          return {
            scores: [],
            attempt: {
              promptDigest: 'failed-once', requestParams: {}, parseStatus: 'failed', latencyMs: 1,
              errorCode: 'judge_request_failed', errorMessage: 'temporary outage',
            },
          };
        }
        await wait;
        return { scores: judgeScores, attempt: {
          promptDigest: 'recovered', requestParams: {}, parseStatus: 'parsed', latencyMs: 1,
        } };
      },
    };
    const service = new AgentEvaluation(transientJudge);
    const first = service.submit({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now, triggerId: 'retry-first',
    });
    const second = service.submit({
      conversationId: 'conv-eval', rootTaskId: 'task-root', evidenceCutoffAt: now, triggerId: 'retry-second',
    });
    db.prepare(`UPDATE eval_job SET next_attempt_at='2099-01-01T00:00:00.000Z' WHERE run_id=?`).run(second.runId);
    await service.processPending(1);
    db.prepare(`UPDATE eval_job SET next_attempt_at='1970-01-01T00:00:00.000Z' WHERE run_id=?`).run(first.runId);
    const running = service.processPending(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await service.processPending(1)).toBe(0);
    release!();
    expect(await running).toBe(1);
    expect(service.getReport(first.runId)!.judgeAttempts).toHaveLength(2);
    expect(db.prepare('SELECT status,attempt_count FROM eval_job WHERE run_id=?').get(first.runId))
      .toMatchObject({ status: 'completed', attempt_count: 2 });
    expect(db.prepare('SELECT status FROM eval_job WHERE run_id=?').get(second.runId))
      .toMatchObject({ status: 'queued' });
  });

  it('reclaims an expired running lease after a worker restart', async () => {
    const firstProcess = new AgentEvaluation(judge);
    const submitted = firstProcess.submit({
      conversationId: 'conv-eval',
      rootTaskId: 'task-root',
      evidenceCutoffAt: now,
      triggerId: 'restart-recovery',
    });
    getDb().prepare(`UPDATE eval_job SET status='running',attempt_count=1,
      lease_until='1970-01-01T00:00:00.000Z',lease_token='dead-worker',updated_at=?
      WHERE run_id=?`).run(now, submitted.runId);
    getDb().prepare(`UPDATE eval_run SET status='running',started_at=?,updated_at=?
      WHERE id=?`).run(now, now, submitted.runId);

    const restartedProcess = new AgentEvaluation(judge);
    expect(await restartedProcess.processPending(1)).toBe(1);
    expect(restartedProcess.getReport(submitted.runId)!.run.status).toBe('partial');
    expect(getDb().prepare('SELECT status,attempt_count,lease_token FROM eval_job WHERE run_id=?')
      .get(submitted.runId)).toMatchObject({
      status: 'completed',
      attempt_count: 2,
      lease_token: null,
    });
  });
});
