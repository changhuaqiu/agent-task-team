import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import { CollaborationKernel } from '../collaboration-kernel';
import { PlatformEventLog } from '../platform-events/event-log';
import { runtimeCompletionContextRepo } from '../platform-events/runtime-completion-process-manager';
import { invocationRepo } from '../repositories/invocation-repo';
import { A2ACollaborationRepository } from './collaboration';
import { A2ALifecycleProcessManager } from './lifecycle-process-manager';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function packet() {
  return {
    title: 'Build',
    requestedAction: 'Build the feature',
    possessionSummary: 'Design accepted',
    relevantDecisions: [],
    evidenceRefs: [],
    constraints: [],
    openQuestions: [],
    forbiddenBehaviors: [],
    sourceMessageIds: ['message-1'],
  };
}

describe('A2ALifecycleProcessManager', () => {
  let inbox: AgentInbox;
  let collaboration: A2ACollaborationRepository;
  let manager: A2ALifecycleProcessManager;
  let sequence: number;

  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-a2a-lifecycle', 'A2A Lifecycle', 'active', NOW.toISOString(), NOW.toISOString());
    sequence = 0;
    inbox = new AgentInbox({
      db,
      now: () => NOW,
      idFactory: (prefix) => `${prefix}-${++sequence}`,
    });
    collaboration = new A2ACollaborationRepository({
      db,
      collaboration: new CollaborationKernel({ inbox }),
      now: () => NOW,
      idFactory: (prefix) => `${prefix}-${++sequence}`,
    });
    manager = new A2ALifecycleProcessManager({ db, collaboration });
  });

  afterEach(() => resetDb());

  function offer() {
    const chain = collaboration.createChain({
      conversationId: 'project-a2a-lifecycle',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-1',
      holderId: 'lead',
      holderType: 'agent',
    });
    return collaboration.offerPassGroup({
      chainId: chain.chain.id,
      sourcePossessionId: chain.rootPossession.id,
      expectedSourceRevision: chain.rootPossession.revision,
      idempotencyKey: 'pass-builder',
      branches: [{ toAgentId: 'builder', intent: 'implement', packet: packet() }],
    });
  }

  it('separates Inbox admission from actual Runtime start', async () => {
    const offered = offer();
    const claimed = inbox.claimNext()!;
    inbox.admit(claimed.id, claimed.leaseToken!);
    const admitted = new PlatformEventLog({ db: getDb() })
      .listStream('agent-work:project-a2a-lifecycle:builder')
      .find((event) => event.type === 'agent.work.admitted')!;

    await manager.handle(admitted, { signal: new AbortController().signal });
    expect(collaboration.getPass(offered.passes[0]!.id)).toMatchObject({
      status: 'starting',
      targetPossessionId: undefined,
    });

    invocationRepo.create({
      id: 'inv-builder',
      conversation_id: 'project-a2a-lifecycle',
      agent_id: 'builder',
    });
    runtimeCompletionContextRepo.create({
      invocationId: 'inv-builder',
      conversationId: 'project-a2a-lifecycle',
      agentId: 'builder',
      chainId: offered.group.chainId,
      passId: offered.passes[0]!.id,
      taskProjectDir: 'C:/project',
    });
    const started = new PlatformEventLog({ db: getDb() }).append({
      type: 'runtime.invocation.started',
      category: 'runtime_lifecycle',
      projectId: 'project-a2a-lifecycle',
      streamKey: 'invocation:inv-builder',
      aggregate: { type: 'invocation', id: 'inv-builder' },
      actor: { type: 'runtime', id: 'acp' },
      projectAgentId: 'builder',
      invocationId: 'inv-builder',
      correlationId: offered.group.chainId,
      payload: { adapter: 'acp', engine: 'codex' },
    });
    await manager.handle(started, { signal: new AbortController().signal });

    const pass = collaboration.getPass(offered.passes[0]!.id)!;
    expect(pass).toMatchObject({
      status: 'started',
      targetPossessionId: expect.any(String),
    });
    expect(collaboration.getPossession(pass.targetPossessionId!)).toMatchObject({
      holderId: 'builder',
      status: 'open',
    });
  });

  it('turns terminal Inbox rejection into a failed Pass and source recovery', async () => {
    const offered = offer();
    const claimed = inbox.claimNext()!;
    inbox.expire(claimed.id, claimed.leaseToken!, 'runtime_profile_missing');
    const expired = new PlatformEventLog({ db: getDb() })
      .listStream('agent-work:project-a2a-lifecycle:builder')
      .find((event) => event.type === 'agent.work.expired')!;

    await manager.handle(expired, { signal: new AbortController().signal });
    expect(collaboration.getPass(offered.passes[0]!.id)).toMatchObject({
      status: 'rejected',
      reason: 'runtime_profile_missing',
      phase: 'start',
    });
    expect(collaboration.getGroup(offered.group.id)).toMatchObject({
      status: 'recovering',
      recoveryPossessionId: expect.any(String),
    });
  });

  it('[scenario:agent-failure] revokes receiver possession and opens source recovery', async () => {
    const offered = offer();
    const admitted = collaboration.markPassAdmitted(offered.passes[0]!.id, 0);
    const starting = collaboration.markPassStarting(admitted.id, admitted.revision);
    const started = collaboration.markPassStarted(starting.id, starting.revision);
    invocationRepo.create({
      id: 'inv-died',
      conversation_id: 'project-a2a-lifecycle',
      agent_id: 'builder',
    });
    runtimeCompletionContextRepo.create({
      invocationId: 'inv-died',
      conversationId: 'project-a2a-lifecycle',
      agentId: 'builder',
      chainId: offered.group.chainId,
      passId: offered.passes[0]!.id,
      taskProjectDir: 'C:/project',
    });
    const terminated = new PlatformEventLog({ db: getDb() }).append({
      type: 'runtime.invocation.terminated',
      category: 'runtime_lifecycle',
      projectId: 'project-a2a-lifecycle',
      streamKey: 'invocation:inv-died',
      aggregate: { type: 'invocation', id: 'inv-died' },
      actor: { type: 'runtime', id: 'acp' },
      projectAgentId: 'builder',
      invocationId: 'inv-died',
      correlationId: offered.group.chainId,
      payload: { outcome: 'failed', reasonCode: 'runtime_transport_lost' },
    });

    await manager.handle(terminated, { signal: new AbortController().signal });

    expect(collaboration.getPass(started.pass.id)).toMatchObject({
      status: 'error',
      phase: 'run',
      reason: 'runtime_transport_lost',
    });
    expect(collaboration.getPossession(started.possession.id)).toMatchObject({
      status: 'aborted',
      summary: 'runtime_transport_lost',
    });
    expect(collaboration.getGroup(offered.group.id)).toMatchObject({
      status: 'recovering',
    });
  });
});
