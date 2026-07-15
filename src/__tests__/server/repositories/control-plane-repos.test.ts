import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { runtimeNodeRepo } from '@/server/repositories/runtime-node-repo';
import { agentBindingRepo } from '@/server/repositories/agent-binding-repo';
import { executionEnvelopeRepo } from '@/server/repositories/execution-envelope-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('system control plane migrations', () => {
  it('creates the P0 control plane tables', () => {
    const rows = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('control_proof_event', 'runtime_node', 'agent_binding', 'execution_envelope')
      ORDER BY name ASC
    `).all() as { name: string }[];

    expect(rows.map((row) => row.name)).toEqual([
      'agent_binding',
      'control_proof_event',
      'execution_envelope',
      'runtime_node',
    ]);
  });
});

describe('runtimeNodeRepo', () => {
  it('registers and updates runtime nodes', () => {
    const node = runtimeNodeRepo.register({
      id: 'node-local',
      kind: 'daemon',
      label: 'Local daemon',
      capabilities: ['execute', 'heartbeat'],
    });

    expect(node.status).toBe('reachable');
    expect(JSON.parse(node.capabilities)).toEqual(['execute', 'heartbeat']);

    const updated = runtimeNodeRepo.register({
      id: 'node-local',
      kind: 'daemon',
      label: 'Renamed daemon',
      capabilities: ['execute'],
      trustLevel: 'paired',
    });

    expect(updated.label).toBe('Renamed daemon');
    expect(updated.trust_level).toBe('paired');
    expect(JSON.parse(updated.capabilities)).toEqual(['execute']);
  });

  it('tracks heartbeat misses and recovery', () => {
    runtimeNodeRepo.register({ id: 'node-bridge', kind: 'bridge', label: 'Bridge' });

    expect(runtimeNodeRepo.recordMiss('node-bridge')!.status).toBe('reachable');
    expect(runtimeNodeRepo.recordMiss('node-bridge')!.status).toBe('stale');
    expect(runtimeNodeRepo.recordMiss('node-bridge')!.status).toBe('unreachable');

    const recovered = runtimeNodeRepo.heartbeat('node-bridge')!;
    expect(recovered.status).toBe('reachable');
    expect(recovered.missed_heartbeats).toBe(0);
    expect(recovered.last_heartbeat_at).toBeTruthy();
  });

  it('does not auto-transition suspended nodes on missed heartbeat', () => {
    runtimeNodeRepo.register({ id: 'node-remote', kind: 'remote', label: 'Remote' });
    runtimeNodeRepo.setStatus('node-remote', 'suspended');

    const missed = runtimeNodeRepo.recordMiss('node-remote')!;
    expect(missed.status).toBe('suspended');
    expect(missed.missed_heartbeats).toBe(0);
  });
});

describe('agentBindingRepo', () => {
  beforeEach(() => {
    runtimeNodeRepo.register({ id: 'node-local', kind: 'daemon', label: 'Local daemon' });
  });

  it('upserts a binding per conversation and agent', () => {
    const created = agentBindingRepo.upsert({
      conversationId: 'conv-1',
      agentId: 'mario',
      nodeId: 'node-local',
      runtimeId: 'opencode-local',
    });

    expect(created.status).toBe('idle');

    const updated = agentBindingRepo.upsert({
      conversationId: 'conv-1',
      agentId: 'mario',
      nodeId: 'node-local',
      runtimeId: 'codex-cli',
      status: 'misconfigured',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.runtime_id).toBe('codex-cli');
    expect(updated.status).toBe('misconfigured');
    expect(agentBindingRepo.listByConversation('conv-1')).toHaveLength(1);
  });

  it('tracks start, finish, and errors', () => {
    agentBindingRepo.upsert({
      conversationId: 'conv-1',
      agentId: 'toad',
      nodeId: 'node-local',
      runtimeId: 'opencode-local',
    });

    const started = agentBindingRepo.markStarted('conv-1', 'toad', 'env-1')!;
    expect(started.status).toBe('busy');
    expect(started.active_envelope_id).toBe('env-1');
    expect(started.last_started_at).toBeTruthy();

    const failed = agentBindingRepo.markError('conv-1', 'toad', 'unreachable', 'node missed heartbeats')!;
    expect(failed.status).toBe('unreachable');
    expect(failed.active_envelope_id).toBeNull();
    expect(failed.last_error).toBe('node missed heartbeats');

    const finished = agentBindingRepo.markFinished('conv-1', 'toad')!;
    expect(finished.status).toBe('idle');
    expect(finished.last_finished_at).toBeTruthy();
  });
});

describe('executionEnvelopeRepo', () => {
  it('creates envelopes with ttl, nonce, and payload', () => {
    const envelope = executionEnvelopeRepo.create({
      source: 'a2a',
      intent: 'review',
      conversationId: 'conv-1',
      chainId: 'chain-1',
      passId: 'pass-1',
      fromNodeId: 'node-local',
      fromAgentId: 'mario',
      toNodeId: 'node-bridge',
      toAgentId: 'dk',
      payload: {
        handoffPacketId: 'packet-1',
        contextRefs: ['task:WT-0'],
      },
      ttlMs: 10_000,
    });

    expect(envelope.id).toMatch(/^env-/);
    expect(envelope.status).toBe('drafted');
    expect(envelope.nonce).toHaveLength(24);
    expect(JSON.parse(envelope.payload)).toEqual({
      handoffPacketId: 'packet-1',
      contextRefs: ['task:WT-0'],
    });
    expect(new Date(envelope.expires_at).getTime()).toBeGreaterThan(new Date(envelope.created_at).getTime());
  });

  it('updates lifecycle status and finds runnable envelopes by node', () => {
    const envelope = executionEnvelopeRepo.create({
      source: 'user',
      intent: 'implement',
      conversationId: 'conv-1',
      fromNodeId: 'browser-1',
      toNodeId: 'node-local',
      toAgentId: 'luigi',
    });

    executionEnvelopeRepo.updateStatus(envelope.id, 'queued');
    expect(executionEnvelopeRepo.listRunnableForNode('node-local').map((row) => row.id)).toEqual([envelope.id]);

    const started = executionEnvelopeRepo.updateStatus(envelope.id, 'started')!;
    expect(started.status).toBe('started');

    const failed = executionEnvelopeRepo.updateStatus(envelope.id, 'failed', 'runtime_unreachable')!;
    expect(failed.status).toBe('failed');
    expect(failed.reason_code).toBe('runtime_unreachable');
  });

  it('expires non-terminal envelopes', () => {
    const stale = executionEnvelopeRepo.create({
      source: 'workflow',
      intent: 'verify',
      conversationId: 'conv-1',
      fromNodeId: 'system',
      toNodeId: 'node-local',
      toAgentId: 'yoshi',
      ttlMs: -1,
    });

    const terminal = executionEnvelopeRepo.create({
      source: 'workflow',
      intent: 'verify',
      conversationId: 'conv-1',
      fromNodeId: 'system',
      toNodeId: 'node-local',
      toAgentId: 'peach',
      ttlMs: -1,
    });
    executionEnvelopeRepo.updateStatus(terminal.id, 'completed');

    expect(executionEnvelopeRepo.expireStale()).toBe(1);
    expect(executionEnvelopeRepo.getById(stale.id)!.status).toBe('expired');
    expect(executionEnvelopeRepo.getById(terminal.id)!.status).toBe('completed');
  });
});

describe('proofLogRepo', () => {
  it('records proof events by envelope and conversation', () => {
    const requested = proofLogRepo.append({
      eventType: 'dispatch.requested',
      conversationId: 'conv-1',
      envelopeId: 'env-1',
      nodeId: 'node-local',
      agentId: 'mario',
      actorId: 'user',
      metadata: { source: 'user' },
    });
    const started = proofLogRepo.append({
      eventType: 'dispatch.started',
      conversationId: 'conv-1',
      envelopeId: 'env-1',
      nodeId: 'node-local',
      agentId: 'mario',
    });

    expect(requested.id).toMatch(/^proof-/);
    expect(JSON.parse(requested.metadata!)).toEqual({ source: 'user' });
    expect(proofLogRepo.getByEnvelope('env-1').map((event) => event.event_type)).toEqual([
      'dispatch.requested',
      'dispatch.started',
    ]);
    expect(proofLogRepo.getByConversation('conv-1')).toHaveLength(2);
    expect(proofLogRepo.getById(started.id)!.event_type).toBe('dispatch.started');
  });

  it('finds persistent closure proofs by domain key', () => {
    proofLogRepo.append({
      eventType: 'chain_closure_dispatched',
      conversationId: 'conv-1',
      taskId: 'ROOT-1',
      reasonCode: 'chain_ready_for_closure',
    });
    proofLogRepo.append({
      eventType: 'chain_closure_dispatched',
      conversationId: 'conv-1',
      taskId: 'ROOT-2',
      reasonCode: 'chain_ready_for_closure',
    });

    expect(proofLogRepo.findByType({
      eventType: 'chain_closure_dispatched',
      conversationId: 'conv-1',
      taskId: 'ROOT-1',
      reasonCode: 'chain_ready_for_closure',
    })).toHaveLength(1);
  });
});
