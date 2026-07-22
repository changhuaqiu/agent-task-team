import { describe, expect, it } from 'vitest';
import { projectDaemonActiveRuns } from '@/server/daemon';

describe('daemon active run snapshot', () => {
  it('preserves concurrent projects for the same agent', () => {
    const invocations = new Map([
      ['conv-old\0mario', { id: 'inv-old', task_id: 'task-old' }],
      ['conv-new\0mario', { id: 'inv-new', task_id: 'task-new' }],
      ['conv-new\0luigi', { id: 'inv-build', task_id: 'task-build' }],
    ]);

    const snapshots = projectDaemonActiveRuns(
      ['mario@conv-old', 'mario@conv-new', 'luigi@conv-new', 'peach@default'],
      (agentId, conversationId) => invocations.get(`${conversationId}\0${agentId}`),
    );

    expect(snapshots).toEqual([
      { agentId: 'mario', conversationId: 'conv-old', taskId: 'task-old', invocationId: 'inv-old' },
      { agentId: 'mario', conversationId: 'conv-new', taskId: 'task-new', invocationId: 'inv-new' },
      { agentId: 'luigi', conversationId: 'conv-new', taskId: 'task-build', invocationId: 'inv-build' },
    ]);
  });
});
