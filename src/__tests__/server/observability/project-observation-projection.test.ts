import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { invocationRepo } from '@/server/repositories/invocation-repo';
import { generateTraceId, observationSpanRepo } from '@/server/repositories/observation-span-repo';
import { projectObservationProjection } from '@/server/observability/ProjectObservationProjection';

beforeEach(() => { setTestDb(createTestDb()); conversationRepo.create({ id: 'conv-obs', title: 'Observability' }); });
afterEach(() => resetDb());

describe('projectObservationProjection', () => {
  it('joins agent/context/tool spans and explicit A2A edges', () => {
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-obs', agent_id: 'planner' });
    invocationRepo.updateDispatchStatus('inv-1', 'completed', { tokenUsage: JSON.stringify({ default: { inputTokens: 10, outputTokens: 5 } }) });
    const traceId = generateTraceId();
    const root = observationSpanRepo.start({ traceId, name: 'agent.invoke', kind: 'agent', conversationId: 'conv-obs', taskId: 'task-1', agentId: 'planner', invocationId: 'inv-1', chainId: 'chain-1', attributes: { 'ath.runtime.engine': 'claude' } });
    const context = observationSpanRepo.start({ traceId, parentSpanId: root.span_id, name: 'context.assemble', kind: 'context', conversationId: 'conv-obs', agentId: 'planner', invocationId: 'inv-1', attributes: { report: { scenario: 'iterate', loadedSkills: ['review'], availableTools: ['Read'] } } });
    observationSpanRepo.finish(context.span_id, 'ok');
    const tool = observationSpanRepo.start({ traceId, parentSpanId: root.span_id, name: 'tool.execute', kind: 'tool', conversationId: 'conv-obs', agentId: 'planner', invocationId: 'inv-1', attributes: { 'gen_ai.tool.name': 'Read' } });
    observationSpanRepo.finish(tool.span_id, 'ok'); observationSpanRepo.finish(root.span_id, 'ok');

    const db = getDb();
    db.prepare(`INSERT INTO invocation_chain (id, conversation_id, root_trigger_type, root_trigger_id, status, config, created_at) VALUES ('chain-1','conv-obs','user','u1','active','{}',?)`).run(new Date().toISOString());
    db.prepare(`INSERT INTO chain_worklist (id, chain_id, agent_id, requested_by, prompt, content_hash, status, queued_at) VALUES ('work-1','chain-1','reviewer','planner','review','hash','queued',?)`).run(new Date().toISOString());

    const snapshot = projectObservationProjection.build('conv-obs');
    expect(snapshot.summary).toMatchObject({ traceCount: 1, agentCount: 1, toolCallCount: 1, totalTokens: 15 });
    expect(snapshot.traces[0]).toMatchObject({ agentId: 'planner', engine: 'claude', tools: ['Read'], context: { scenario: 'iterate' } });
    expect(snapshot.workflow.agentEdges).toEqual([{ fromAgentId: 'planner', toAgentId: 'reviewer', count: 1, chainIds: ['chain-1'], passIds: [], auditEvents: [] }]);
    expect(snapshot.chains[0]).toMatchObject({ chainId: 'chain-1', taskIds: ['task-1'] });
    expect(snapshot.chains[0].edges[0]).toMatchObject({ fromAgentId: 'planner', toAgentId: 'reviewer' });
    expect(snapshot.workflow.taskChains[0]).toMatchObject({ taskId: 'task-1', chainIds: ['chain-1'], agentIds: expect.arrayContaining(['planner', 'reviewer']) });
    expect(projectObservationProjection.build('conv-obs', 50, { taskId: 'task-1' }).summary.traceCount).toBe(1);
    expect(projectObservationProjection.build('conv-obs', 50, { chainId: 'chain-1' }).summary.traceCount).toBe(1);
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
