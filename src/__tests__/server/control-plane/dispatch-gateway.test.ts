import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { DispatchGateway } from '@/server/control-plane/dispatch-gateway';
import { runtimeNodeRepo } from '@/server/repositories/runtime-node-repo';
import { executionEnvelopeRepo } from '@/server/repositories/execution-envelope-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';

beforeEach(() => {
  setTestDb(createTestDb());
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
    gateway.markStarted(envelope.id);
    gateway.markCompleted(envelope.id);

    expect(executionEnvelopeRepo.getById(envelope.id)!.status).toBe('completed');
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type)).toEqual([
      'dispatch.requested',
      'dispatch.routed',
      'dispatch.sent',
      'dispatch.started',
      'dispatch.completed',
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

    expect(envelope.status).toBe('blocked');
    expect(envelope.reason_code).toBe('runtime_unreachable');
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type)).toContain('dispatch.blocked');
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

    expect(envelope.status).toBe('blocked');
    expect(envelope.reason_code).toBe('secret_detected:openai_key');
    expect(JSON.parse(envelope.payload).prompt).toBe('[BLOCKED: secret]');
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type)).toContain('policy.secret.blocked');
  });
});
