import { describe, expect, it } from 'vitest';
import { projectDaemonActiveRuns } from '@/server/daemon';

describe('daemon active run snapshot', () => {
  it('preserves concurrent projects for the same agent', () => {
    const tasks = new Map([
      ['conv-old\0mario', 'task-old'],
      ['conv-new\0mario', 'task-new'],
      ['conv-new\0luigi', 'task-build'],
    ]);

    const snapshots = projectDaemonActiveRuns(
      ['mario@conv-old', 'mario@conv-new', 'luigi@conv-new', 'peach@default'],
      (agentId, conversationId) => ({
        task_id: tasks.get(`${conversationId}\0${agentId}`),
      }),
    );

    expect(snapshots).toEqual([
      { agentId: 'mario', conversationId: 'conv-old', taskId: 'task-old' },
      { agentId: 'mario', conversationId: 'conv-new', taskId: 'task-new' },
      { agentId: 'luigi', conversationId: 'conv-new', taskId: 'task-build' },
    ]);
  });
});
