import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { invocationRepo } from '@/server/repositories/invocation-repo';
import { generateTraceId, observationSpanRepo } from '@/server/repositories/observation-span-repo';
import { projectObservationProjection } from '@/server/observability/ProjectObservationProjection';
import { AgentInbox } from '@/server/platform-events/agent-inbox';
import { CollaborationKernel } from '@/server/collaboration-kernel';
import { A2ACollaborationRepository } from '@/server/a2a/collaboration';

beforeEach(() => { setTestDb(createTestDb()); conversationRepo.create({ id: 'conv-obs', title: 'Observability' }); });
afterEach(() => resetDb());

describe('projectObservationProjection', () => {
  it('joins agent/context/tool spans and explicit A2A edges', () => {
    let sequence = 0;
    const collaboration = new A2ACollaborationRepository({
      db: getDb(),
      collaboration: new CollaborationKernel({ inbox: new AgentInbox({
        db: getDb(),
        idFactory: (prefix) => `${prefix}-${++sequence}`,
      }) }),
      idFactory: (prefix) => `${prefix}-${++sequence}`,
    });
    const chain = collaboration.createChain({
      conversationId: 'conv-obs',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-1',
      holderId: 'planner',
      holderType: 'agent',
    });
    const handoff = collaboration.offerPassGroup({
      chainId: chain.chain.id,
      sourcePossessionId: chain.rootPossession.id,
      expectedSourceRevision: chain.rootPossession.revision,
      idempotencyKey: 'planner-reviewer',
      branches: [{
        toAgentId: 'reviewer',
        intent: 'review',
        packet: {
          title: 'Review',
          requestedAction: 'Review the implementation',
          possessionSummary: 'Implementation ready',
          relevantDecisions: [],
          evidenceRefs: [],
          constraints: [],
          openQuestions: [],
          forbiddenBehaviors: [],
          sourceMessageIds: ['message-1'],
        },
      }],
    });
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-obs', agent_id: 'planner' });
    invocationRepo.updateDispatchStatus('inv-1', 'completed', { tokenUsage: JSON.stringify({ default: { inputTokens: 10, outputTokens: 5 } }) });
    const traceId = generateTraceId();
    const root = observationSpanRepo.start({ traceId, name: 'agent.invoke', kind: 'agent', conversationId: 'conv-obs', taskId: 'task-1', agentId: 'planner', invocationId: 'inv-1', chainId: chain.chain.id, attributes: { 'ath.runtime.engine': 'claude' } });
    const context = observationSpanRepo.start({ traceId, parentSpanId: root.span_id, name: 'context.assemble', kind: 'context', conversationId: 'conv-obs', agentId: 'planner', invocationId: 'inv-1', attributes: { report: { scenario: 'iterate', loadedSkills: ['review'], availableTools: ['Read'] } } });
    observationSpanRepo.finish(context.span_id, 'ok');
    const tool = observationSpanRepo.start({ traceId, parentSpanId: root.span_id, name: 'tool.execute', kind: 'tool', conversationId: 'conv-obs', agentId: 'planner', invocationId: 'inv-1', attributes: { 'gen_ai.tool.name': 'Read' } });
    observationSpanRepo.finish(tool.span_id, 'ok'); observationSpanRepo.finish(root.span_id, 'ok');

    const snapshot = projectObservationProjection.build('conv-obs');
    expect(snapshot.summary).toMatchObject({ traceCount: 1, agentCount: 1, toolCallCount: 1, totalTokens: 15 });
    expect(snapshot.traces[0]).toMatchObject({ agentId: 'planner', engine: 'claude', tools: ['Read'], context: { scenario: 'iterate' } });
    expect(snapshot.workflow.agentEdges).toEqual([{ fromAgentId: 'planner', toAgentId: 'reviewer', count: 1, chainIds: [chain.chain.id], passIds: [handoff.passes[0]!.id], auditEvents: [] }]);
    expect(snapshot.chains[0]).toMatchObject({ chainId: chain.chain.id, taskIds: ['task-1'] });
    expect(snapshot.chains[0].edges[0]).toMatchObject({ fromAgentId: 'planner', toAgentId: 'reviewer' });
    expect(snapshot.workflow.taskChains[0]).toMatchObject({ taskId: 'task-1', chainIds: [chain.chain.id], agentIds: expect.arrayContaining(['planner', 'reviewer']) });
    expect(projectObservationProjection.build('conv-obs', 50, { taskId: 'task-1' }).summary.traceCount).toBe(1);
    expect(projectObservationProjection.build('conv-obs', 50, { chainId: chain.chain.id }).summary.traceCount).toBe(1);
    expect(projectObservationProjection.build('conv-obs', 50, { invocationId: 'missing' }).summary.traceCount).toBe(0);
  });

  it('prefers the runtime-bound Context Snapshot over the assembly snapshot', () => {
    invocationRepo.create({ id: 'inv-runtime', conversation_id: 'conv-obs', agent_id: 'coder' });
    const traceId = generateTraceId();
    const root = observationSpanRepo.start({
      traceId,
      name: 'agent.invoke',
      kind: 'agent',
      conversationId: 'conv-obs',
      agentId: 'coder',
      invocationId: 'inv-runtime',
    });
    const assembly = observationSpanRepo.start({
      traceId,
      parentSpanId: root.span_id,
      name: 'context.assemble',
      kind: 'context',
      conversationId: 'conv-obs',
      agentId: 'coder',
      invocationId: 'inv-runtime',
      attributes: { report: { scenario: 'execution', snapshotId: 'ctx_assembly' } },
    });
    observationSpanRepo.finish(assembly.span_id, 'ok');
    const runtime = observationSpanRepo.start({
      traceId,
      parentSpanId: root.span_id,
      name: 'context.runtime',
      kind: 'context',
      conversationId: 'conv-obs',
      agentId: 'coder',
      invocationId: 'inv-runtime',
      attributes: { report: { scenario: 'execution', snapshotId: 'ctx_runtime' } },
    });
    observationSpanRepo.finish(runtime.span_id, 'ok');
    observationSpanRepo.finish(root.span_id, 'ok');

    expect(projectObservationProjection.build('conv-obs').traces[0].context).toMatchObject({
      scenario: 'execution',
      snapshotId: 'ctx_runtime',
    });
  });
});
