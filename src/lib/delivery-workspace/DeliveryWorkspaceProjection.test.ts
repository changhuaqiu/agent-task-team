import { describe, expect, it } from 'vitest';
import type { Blocker, Conversation } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';
import { projectDeliveryWorkspace } from './DeliveryWorkspaceProjection';

const delivery: Conversation = {
  id: 'delivery-1',
  title: '重构工作区',
  goal: '让交付状态成为主视图',
  status: 'active',
  priority: 'p1',
  projectPath: 'C:\\workspace\\agent-task-team',
  breakdownStatus: 'confirmed',
  autonomous: true,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T01:00:00.000Z',
};

function task(id: string, status: Task['status']): Task {
  return {
    id,
    conversationId: delivery.id,
    phaseId: '',
    title: `工作 ${id}`,
    description: '',
    status,
    agentId: 'luigi',
    dependencies: [],
    artifacts: [],
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: `2026-08-16T00:0${id.slice(-1)}:00.000Z`,
  };
}

describe('DeliveryWorkspaceProjection', () => {
  it('projects one delivery without leaking data from another project', () => {
    const blocker: Blocker = {
      id: 'blocker-1', conversationId: delivery.id, taskId: 'TASK-1', type: 'manual',
      reasonSummary: '需要用户确认范围', status: 'open', createdAt: '2026-08-16T00:02:00.000Z',
    };
    const view = projectDeliveryWorkspace({
      conversations: [delivery, { ...delivery, id: 'delivery-2', projectPath: 'D:\\other' }],
      tasks: [task('TASK-1', 'blocked'), { ...task('OTHER-1', 'ready'), conversationId: 'delivery-2' }],
      blockersByConversation: { [delivery.id]: [blocker] },
      chatMessagesByConversation: {
        [delivery.id]: [{
          id: 'message-1', agentId: 'human', content: '继续', timestamp: '2026-08-16T00:03:00.000Z',
          mentions: [], intent: 'general',
        }],
      },
    }, delivery.id);

    expect(view?.project).toEqual({ path: 'C:\\workspace\\agent-task-team', name: 'agent-task-team' });
    expect(view?.work.tasks.map((item) => item.id)).toEqual(['TASK-1']);
    expect(view?.attention).toEqual([expect.objectContaining({
      kind: 'manual', taskId: 'TASK-1', detail: '需要用户确认范围',
    })]);
    expect(view?.recentActivity.map((item) => item.id)).toEqual(['message-1']);
  });

  it('only counts authoritative user actions, including waiting-human delivery runs', () => {
    const blocker: Blocker = {
      id: 'blocker-1', conversationId: delivery.id, taskId: 'TASK-1', type: 'manual',
      reasonSummary: '需要授权', status: 'open', createdAt: '2026-08-16T00:02:00.000Z',
    };
    const view = projectDeliveryWorkspace({
      conversations: [delivery],
      tasks: [task('TASK-4', 'ready'), task('TASK-3', 'proposed'), task('TASK-2', 'in_review'), task('TASK-1', 'blocked')],
      blockersByConversation: { [delivery.id]: [
        blocker,
        { ...blocker, id: 'automated-gate', type: 'gate_fail', taskId: 'TASK-2' },
      ] },
      chatMessagesByConversation: {},
      deliveryRunSnapshot: {
        run: {
          id: 'run-1', conversation_id: delivery.id, root_task_id: null,
          status: 'waiting_human', escalation_code: 'authorization_required',
          escalation_detail: '需要扩大写入范围',
        },
      } as never,
    }, delivery.id);

    expect(view?.attention.map((item) => item.kind)).toEqual(['escalation', 'manual']);
    expect(view?.attention[0]).toEqual(expect.objectContaining({ detail: '需要扩大写入范围' }));
    expect(view?.attention.filter((item) => item.taskId === 'TASK-1')).toHaveLength(1);
  });

  it('projects delivery stage, acceptance progress, and current work from the run snapshot', () => {
    const view = projectDeliveryWorkspace({
      conversations: [delivery],
      tasks: [task('TASK-1', 'in_progress'), task('TASK-2', 'done')],
      blockersByConversation: {},
      chatMessagesByConversation: {},
      deliveryRunSnapshot: {
        run: {
          id: 'run-acceptance',
          conversation_id: delivery.id,
          status: 'active',
          current_stage: 'verifying',
        },
        contract: {
          acceptanceCriteria: ['构建通过', '浏览器验收通过'],
        },
        bundle: {
          acceptanceResults: [{
            criterion: '构建通过',
            status: 'passed',
            evidenceRefs: ['build:1'],
          }],
        },
      } as never,
    }, delivery.id);

    expect(view).toMatchObject({
      stage: 'verifying',
      acceptance: { total: 2, passed: 1, failed: 0, pending: 1 },
      work: { current: [expect.objectContaining({ id: 'TASK-1' })] },
    });
  });

  it('returns null when the selected delivery is absent', () => {
    expect(projectDeliveryWorkspace({
      conversations: [delivery], tasks: [], blockersByConversation: {}, chatMessagesByConversation: {},
    }, 'missing')).toBeNull();
  });
});
