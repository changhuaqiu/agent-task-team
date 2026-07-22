import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { DispatchGateway } from '@/server/control-plane/dispatch-gateway';
import { runtimeNodeRepo } from '@/server/repositories/runtime-node-repo';
import { executionEnvelopeRepo } from '@/server/repositories/execution-envelope-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';
import { invocationRepo } from '@/server/repositories/invocation-repo';

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

  it('does not send, start, or revive a routed dispatch after its TTL expires', () => {
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });
    const envelope = gateway.requestDispatch({
      source: 'workflow',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'luigi',
      runtimeId: 'claude-local',
      ttlMs: -1,
    });
    expect(gateway.markSent(envelope.id)).toBeUndefined();
    executionEnvelopeRepo.expireStalePending();

    expect(gateway.markStarted(envelope.id)).toBeUndefined();
    expect(executionEnvelopeRepo.getById(envelope.id)?.status).toBe('expired');
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type))
      .not.toContain('dispatch.sent');
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type))
      .not.toContain('dispatch.started');
  });

  it('does not let late terminal callbacks overwrite an existing terminal state', () => {
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });
    const completed = gateway.requestDispatch({
      source: 'workflow',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'luigi',
      runtimeId: 'claude-local',
    });
    gateway.markSent(completed.id);
    gateway.markStarted(completed.id);
    gateway.markCompleted(completed.id);

    expect(gateway.markFailed(completed.id, 'late_timeout')).toBeUndefined();
    expect(executionEnvelopeRepo.getById(completed.id)?.status).toBe('completed');

    const failed = gateway.requestDispatch({
      source: 'workflow',
      intent: 'verify',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'peach',
      runtimeId: 'claude-local',
    });
    gateway.markSent(failed.id);
    gateway.markStarted(failed.id);
    gateway.markFailed(failed.id, 'timeout');

    expect(gateway.markCompleted(failed.id)).toBeUndefined();
    expect(executionEnvelopeRepo.getById(failed.id)).toMatchObject({ status: 'failed', reason_code: 'timeout' });
  });

  it('lets only the envelope terminal CAS winner update the invocation reason', () => {
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });
    const envelope = gateway.requestDispatch({
      source: 'workflow',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'luigi',
      runtimeId: 'claude-local',
    });
    gateway.markSent(envelope.id);
    invocationRepo.create({ id: 'inv-terminal-race', conversation_id: 'conv-1', agent_id: 'luigi' });
    invocationRepo.updateStatus('inv-terminal-race', 'running');
    gateway.markStarted(envelope.id);

    expect(gateway.markFailed(
      envelope.id,
      'killed',
      'idle',
      { id: 'inv-terminal-race', errorMessage: 'first terminal callback' },
    )).toBeDefined();
    expect(gateway.markFailed(
      envelope.id,
      'timeout',
      'idle',
      { id: 'inv-terminal-race', errorMessage: 'late terminal callback' },
    )).toBeUndefined();

    expect(executionEnvelopeRepo.getById(envelope.id)).toMatchObject({
      status: 'failed',
      reason_code: 'killed',
    });
    expect(invocationRepo.getById('inv-terminal-race')).toMatchObject({
      status: 'failed',
      reason_code: 'killed',
      error_message: 'first terminal callback',
    });
  });
});
