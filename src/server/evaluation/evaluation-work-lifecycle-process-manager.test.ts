import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import type { PlatformEvent } from '../platform-events/types';
import { taskRepo } from '../repositories/task-repo';
import { createCaseExecution, transitionCaseExecution } from './application-snapshot';
import { EvaluationWorkLifecycleProcessManager } from './evaluation-work-lifecycle-process-manager';

function createPlanningExecutionFixture() {
  const now = new Date().toISOString();
  getDb().prepare(`INSERT INTO eval_application_snapshot
    (id,conversation_id,name,source,project_path,code_revision,team_manifest,agent_manifest,
     manifest_digest,created_by,created_at)
    VALUES ('snapshot-1','project-1','Snapshot','candidate','C:/project','revision','{}',?,
      'manifest-digest','test',?)`).run(JSON.stringify([{ agentId: 'agent-1' }]), now);
  getDb().prepare(`INSERT INTO eval_dataset
    (id,conversation_id,name,description,revision,status,created_by,created_at,updated_at)
    VALUES ('dataset-1','project-1','Dataset','Dataset',1,'active','test',?,?)`).run(now, now);
  getDb().prepare(`INSERT INTO eval_case
    (id,dataset_id,case_key,split,source_type,input_payload,expected_labels,metadata,
     content_hash,redaction_status,created_at)
    VALUES ('case-1','dataset-1','case','held_out','manual','{}','{}','{}',
      'case-hash','redacted',?)`).run(now);
  const execution = createCaseExecution({
    conversationId: 'project-1',
    caseId: 'case-1',
    applicationSnapshotId: 'snapshot-1',
    variant: 'candidate',
    agentId: 'agent-1',
  });
  transitionCaseExecution({ id: execution.id, conversationId: 'project-1', status: 'planning' });
  return execution;
}

describe('EvaluationWorkLifecycleProcessManager', () => {
  beforeEach(() => {
    setTestDb(createTestDb());
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)`).run(now, now);
  });
  afterEach(() => resetDb());

  it('fails the owning planning case when Runtime admission expires', async () => {
    const execution = createPlanningExecutionFixture();
    const event = {
      type: 'agent.work.expired',
      projectId: 'project-1',
      payload: {
        replyTo: { type: 'evaluation_case', id: execution.id },
        evaluation: { executionId: execution.id },
        reasonCode: 'runtime_profile_missing',
      },
    } as PlatformEvent;

    await new EvaluationWorkLifecycleProcessManager().handle({
      ...event,
      type: 'agent.work.released',
    }, { signal: new AbortController().signal });
    expect(getDb().prepare('SELECT status FROM eval_case_execution WHERE id=?')
      .get(execution.id)).toEqual({ status: 'planning' });

    await new EvaluationWorkLifecycleProcessManager().handle(event, {
      signal: new AbortController().signal,
    });

    expect(getDb().prepare('SELECT status,error_code FROM eval_case_execution WHERE id=?')
      .get(execution.id)).toEqual({ status: 'failed', error_code: 'runtime_profile_missing' });
  });

  it('recovers the ACK-to-running crash window from durable admission exactly once', async () => {
    const execution = createPlanningExecutionFixture();
    taskRepo.create({
      id: 'TASK-EVAL',
      conversation_id: 'project-1',
      title: 'Evaluation task',
      agent_id: 'agent-1',
    });
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO invocation
      (id,conversation_id,task_id,agent_id,status,revision,created_at,updated_at)
      VALUES ('invocation-1','project-1','TASK-EVAL','agent-1','running',0,?,?)`
    ).run(now, now);
    const event = {
      type: 'agent.work.admitted',
      projectId: 'project-1',
      projectAgentId: 'agent-1',
      payload: {
        replyTo: { type: 'evaluation_case', id: execution.id },
        taskId: 'TASK-EVAL',
        evaluation: {
          executionId: execution.id,
          applicationSnapshotId: 'snapshot-1',
          targetManifestDigest: 'manifest-digest',
        },
        runtimeAdmission: {
          invocationId: 'invocation-1',
          traceId: 'trace-1',
          observedManifestDigest: 'manifest-digest',
        },
      },
    } as PlatformEvent;
    const manager = new EvaluationWorkLifecycleProcessManager();
    const context = { signal: new AbortController().signal };

    await manager.handle(event, context);
    await manager.handle(event, context);

    expect(getDb().prepare(`
      SELECT status,task_id,invocation_id,trace_id,observed_manifest_digest
      FROM eval_case_execution WHERE id=?
    `).get(execution.id)).toEqual({
      status: 'running',
      task_id: 'TASK-EVAL',
      invocation_id: 'invocation-1',
      trace_id: 'trace-1',
      observed_manifest_digest: 'manifest-digest',
    });
    expect(getDb().prepare(`
      SELECT COUNT(*) AS count FROM control_proof_event
      WHERE event_type='eval.execution.started' AND conversation_id='project-1'
    `).get()).toEqual({ count: 1 });
  });
});
