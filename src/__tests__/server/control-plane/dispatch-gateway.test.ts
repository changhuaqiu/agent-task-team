import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { DispatchGateway } from '@/server/control-plane/dispatch-gateway';
import { runtimeNodeRepo } from '@/server/repositories/runtime-node-repo';
import { executionEnvelopeRepo } from '@/server/repositories/execution-envelope-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';

beforeEach(() => {
  const db = createTestDb();
  setTestDb(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO conversation (id,title,status,created_at,updated_at)
    VALUES ('conv-1','Dispatch gateway','active',?,?)`).run(now, now);
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('DispatchGateway', () => {
  it('routes allowed dispatches and records proof', () => {
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });

    const envelope = gateway.requestDispatch({
      source: 'user',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'mario',
      runtimeId: 'opencode-local',
      payload: { prompt: 'implement task', contextRefs: ['task:TASK-1'] },
    });

    expect(envelope.status).toBe('routed');
    gateway.markSent(envelope.id);
    gateway.acknowledge(envelope.id);
    gateway.markExecutionFinished(envelope.id);
    gateway.markExecutionFailed(envelope.id, 'late_evaluation_failure');

    expect(executionEnvelopeRepo.getById(envelope.id)!.status).toBe('acknowledged');
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type)).toEqual([
      'dispatch.requested',
      'dispatch.routed',
      'dispatch.sent',
      'dispatch.acknowledged',
      'dispatch.execution_finished',
      'dispatch.execution_failed',
    ]);
  });

  it('blocks unreachable target nodes before routing', () => {
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    runtimeNodeRepo.register({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });
    runtimeNodeRepo.setStatus('daemon-1', 'unreachable');

    const envelope = gateway.requestDispatch({
      source: 'a2a',
      intent: 'delegate',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      fromAgentId: 'mario',
      toNodeId: 'daemon-1',
      toAgentId: 'dk',
      runtimeId: 'opencode-local',
      payload: { prompt: 'please review', contextRefs: [] },
    });

    expect(envelope.status).toBe('rejected');
    expect(envelope.reason_code).toBe('runtime_unreachable');
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type)).toContain('dispatch.rejected');
  });

  it('blocks secret-bearing envelopes and stores redacted payload', () => {
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });

    const envelope = gateway.requestDispatch({
      source: 'user',
      intent: 'answer',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'mario',
      runtimeId: 'opencode-local',
      payload: { prompt: 'api_key = sk-secretsecretsecretsecret', contextRefs: [] },
    });

    expect(envelope.status).toBe('rejected');
    expect(envelope.reason_code).toBe('secret_detected:openai_key');
    expect(JSON.parse(envelope.payload).prompt).toBe('[BLOCKED: secret]');
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type)).toContain('policy.secret.blocked');
  });

  it('does not treat an sk- substring inside a normal identifier as a secret', () => {
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });

    const envelope = gateway.requestDispatch({
      source: 'workflow',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'mario',
      runtimeId: 'opencode-local',
      payload: {
        prompt: 'Inspect task-notification-publisher and task-graph-policy before editing.',
        contextRefs: [],
      },
    });

    expect(envelope.status).toBe('routed');
    expect(envelope.reason_code).toBeNull();
  });
});
