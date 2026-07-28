import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { DispatchGateway } from '@/server/control-plane/dispatch-gateway';
import { runtimeNodeRepo } from '@/server/repositories/runtime-node-repo';
import { executionEnvelopeRepo } from '@/server/repositories/execution-envelope-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';

function installAcknowledgementOnlyEnvelopeSchema(): void {
  const db = getDb();
  db.exec(`
    ALTER TABLE execution_envelope ADD COLUMN settled_at TEXT;
    ALTER TABLE execution_envelope ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

    CREATE TRIGGER trg_execution_envelope_status_update
    BEFORE UPDATE OF status ON execution_envelope
    WHEN NEW.status NOT IN (
      'drafted','validated','routed','sent','acknowledged','rejected','expired'
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid_execution_envelope_status');
    END;

    CREATE TRIGGER trg_execution_envelope_transition_update
    BEFORE UPDATE OF status ON execution_envelope
    WHEN NEW.status <> OLD.status
      AND NOT (
        (OLD.status = 'drafted' AND NEW.status IN ('validated','rejected','expired'))
        OR (OLD.status = 'validated' AND NEW.status IN ('routed','rejected','expired'))
        OR (OLD.status = 'routed' AND NEW.status IN ('sent','rejected','expired'))
        OR (OLD.status = 'sent' AND NEW.status IN ('acknowledged','rejected','expired'))
      )
    BEGIN
      SELECT RAISE(ABORT, 'invalid_execution_envelope_transition');
    END;

    CREATE TRIGGER trg_execution_envelope_settled_update
    BEFORE UPDATE OF status, reason_code, settled_at ON execution_envelope
    WHEN (NEW.status IN ('acknowledged','rejected','expired') AND NEW.settled_at IS NULL)
      OR (NEW.status NOT IN ('acknowledged','rejected','expired') AND NEW.settled_at IS NOT NULL)
      OR (NEW.status = 'rejected' AND (
            NEW.reason_code IS NULL
            OR length(trim(NEW.reason_code)) = 0
          ))
    BEGIN
      SELECT RAISE(ABORT, 'invalid_execution_envelope_settlement');
    END;
  `);
}

beforeEach(() => {
  setTestDb(createTestDb());
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('routes with a daemon compatibility API after the database adopts acknowledgement semantics', () => {
    installAcknowledgementOnlyEnvelopeSchema();
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });

    const envelope = gateway.requestDispatch({
      source: 'user',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'peach',
      runtimeId: 'claude-cli',
      payload: { prompt: 'review the task', contextRefs: [] },
    });

    expect(envelope).toMatchObject({ status: 'routed', revision: 2 });
    gateway.markSent(envelope.id);
    gateway.markStarted(envelope.id);
    gateway.markCompleted(envelope.id);

    expect(executionEnvelopeRepo.getById(envelope.id)).toMatchObject({
      status: 'acknowledged',
      reason_code: null,
      revision: 4,
      settled_at: expect.any(String),
    });
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type)).toEqual([
      'dispatch.requested',
      'dispatch.routed',
      'dispatch.sent',
      'dispatch.started',
      'dispatch.completed',
    ]);
  });

  it('keeps an acknowledged envelope terminal when the compatible daemon reports execution failure', () => {
    installAcknowledgementOnlyEnvelopeSchema();
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });
    const envelope = gateway.requestDispatch({
      source: 'user',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'peach',
      runtimeId: 'claude-cli',
    });
    gateway.markSent(envelope.id);
    gateway.markStarted(envelope.id);

    expect(gateway.markFailed(envelope.id, 'runtime_failed')).toBe(true);
    expect(gateway.markCompleted(envelope.id)).toBe(false);
    expect(executionEnvelopeRepo.getById(envelope.id)).toMatchObject({
      status: 'acknowledged',
      reason_code: null,
      revision: 4,
    });
    expect(proofLogRepo.getByEnvelope(envelope.id).at(-1)).toMatchObject({
      event_type: 'dispatch.failed',
      reason_code: 'runtime_failed',
    });
  });

  it('preserves rejection and expiry settlement invariants on the upgraded schema', () => {
    installAcknowledgementOnlyEnvelopeSchema();
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });

    const rejected = gateway.requestDispatch({
      source: 'user',
      intent: 'answer',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'mario',
      runtimeId: 'opencode-local',
      payload: { prompt: 'api_key = sk-secretsecretsecretsecret', contextRefs: [] },
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason_code: 'secret_detected:openai_key',
      revision: 1,
      settled_at: expect.any(String),
    });
    expect(gateway.markSent(rejected.id)).toBe(false);
    expect(gateway.markStarted(rejected.id)).toBe(false);
    expect(gateway.markFailed(rejected.id, 'late_failure')).toBe(false);
    expect(proofLogRepo.getByEnvelope(rejected.id).map((event) => event.event_type))
      .not.toEqual(expect.arrayContaining(['dispatch.sent', 'dispatch.started']));

    const stale = executionEnvelopeRepo.create({
      source: 'workflow',
      intent: 'verify',
      conversationId: 'conv-1',
      fromNodeId: 'system',
      toNodeId: 'daemon-1',
      toAgentId: 'peach',
      ttlMs: -1,
    });
    expect(executionEnvelopeRepo.expireStale()).toBe(1);
    expect(executionEnvelopeRepo.getById(stale.id)).toMatchObject({
      status: 'expired',
      reason_code: 'ttl_expired',
      revision: 1,
      settled_at: expect.any(String),
    });
    expect(gateway.markSent(stale.id)).toBe(false);
    expect(gateway.markStarted(stale.id)).toBe(false);
    expect(gateway.markFailed(stale.id, 'late_failure')).toBe(false);
    expect(proofLogRepo.getByEnvelope(stale.id).map((event) => event.event_type))
      .not.toEqual(expect.arrayContaining(['dispatch.sent', 'dispatch.started']));
  });

  it('ignores duplicate start and completion callbacks after acknowledgement', () => {
    installAcknowledgementOnlyEnvelopeSchema();
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });
    const envelope = gateway.requestDispatch({
      source: 'user',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'peach',
      runtimeId: 'claude-cli',
    });
    expect(gateway.markSent(envelope.id)).toBe(true);
    expect(gateway.markStarted(envelope.id)).toBe(true);
    expect(gateway.markStarted(envelope.id)).toBe(false);
    expect(gateway.markCompleted(envelope.id)).toBe(true);
    expect(gateway.markCompleted(envelope.id)).toBe(false);
    expect(gateway.markFailed(envelope.id, 'late_failure')).toBe(false);

    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type)).toEqual([
      'dispatch.requested',
      'dispatch.routed',
      'dispatch.sent',
      'dispatch.started',
      'dispatch.completed',
    ]);
  });

  it('does not report failure when a concurrent terminal transition wins', () => {
    const gateway = new DispatchGateway();
    gateway.ensureRuntimeNode({ id: 'browser-1', kind: 'browser', label: 'Browser' });
    gateway.ensureRuntimeNode({ id: 'daemon-1', kind: 'daemon', label: 'Daemon' });
    const envelope = gateway.requestDispatch({
      source: 'user',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'daemon-1',
      toAgentId: 'peach',
      runtimeId: 'claude-cli',
    });
    gateway.markSent(envelope.id);
    gateway.markStarted(envelope.id);
    const beforeFailure = executionEnvelopeRepo.getById(envelope.id)!;
    vi.spyOn(executionEnvelopeRepo, 'updateStatus').mockReturnValue({
      ...beforeFailure,
      status: 'expired',
      reason_code: 'ttl_expired',
    });

    expect(gateway.markFailed(envelope.id, 'runtime_failed')).toBe(false);
    expect(proofLogRepo.getByEnvelope(envelope.id).map((event) => event.event_type))
      .not.toContain('dispatch.failed');
  });
});
