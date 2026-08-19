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

  it('projects frozen acceptance evidence and verification metadata from a completed run', () => {
    const view = projectDeliveryWorkspace({
      conversations: [delivery],
      tasks: [task('TASK-1', 'in_progress'), task('TASK-2', 'done')],
      blockersByConversation: {},
      chatMessagesByConversation: {},
      deliveryRunSnapshot: {
        run: {
          id: 'run-acceptance',
          conversation_id: delivery.id,
          status: 'completed',
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
          verification: {
            method: 'automated_test',
            verifierAgentId: 'peach',
            tool: 'pnpm test',
            reportRef: 'reports/verification.md',
            specRefs: ['specs/frontend-architecture-refactor/spec.md'],
            codeRevision: 'abc1234',
          },
          completedAt: '2026-08-16T01:02:03.000Z',
        },
      } as never,
    }, delivery.id);

    expect(view).toMatchObject({
      stage: 'completed',
      acceptance: {
        total: 2,
        passed: 1,
        failed: 0,
        pending: 1,
        evidence: [
          { criterion: '构建通过', status: 'passed', evidenceRefs: ['build:1'] },
          { criterion: '浏览器验收通过', status: 'pending', evidenceRefs: [] },
        ],
        verification: {
          method: 'automated_test',
          verifierAgentId: 'peach',
          tool: 'pnpm test',
          reportRef: 'reports/verification.md',
          specRefs: ['specs/frontend-architecture-refactor/spec.md'],
          codeRevision: 'abc1234',
          completedAt: '2026-08-16T01:02:03.000Z',
        },
      },
      work: { current: [expect.objectContaining({ id: 'TASK-1' })] },
    });
  });

  it('does not count a bundle before the delivery run is completed', () => {
    const view = projectDeliveryWorkspace({
      conversations: [delivery],
      tasks: [],
      blockersByConversation: {},
      chatMessagesByConversation: {},
      deliveryRunSnapshot: {
        run: {
          id: 'run-delivering', conversation_id: delivery.id, status: 'active', current_stage: 'delivering',
        },
        contract: { acceptanceCriteria: ['构建通过'] },
        bundle: {
          acceptanceResults: [{ criterion: '构建通过', status: 'passed', evidenceRefs: ['build:1'] }],
          verification: {
            method: 'automated_test', verifierAgentId: 'peach', tool: 'pnpm test',
            reportRef: 'reports/verification.md', specRefs: [],
          },
          completedAt: '2026-08-16T01:02:03.000Z',
        },
      } as never,
    }, delivery.id);

    expect(view?.acceptance).toMatchObject({
      total: 1,
      passed: 0,
      pending: 1,
      evidence: [{ criterion: '构建通过', status: 'pending', evidenceRefs: [] }],
      verification: undefined,
    });
  });

  it('does not treat an agent chat claim as acceptance evidence', () => {
    const view = projectDeliveryWorkspace({
      conversations: [delivery],
      tasks: [],
      blockersByConversation: {},
      chatMessagesByConversation: {
        [delivery.id]: [{
          id: 'message-claim', agentId: 'peach', content: '已经全部验收通过。',
          timestamp: '2026-08-16T00:03:00.000Z', mentions: [], intent: 'general',
        }],
      },
      deliveryRunSnapshot: {
        run: { id: 'run-claim', conversation_id: delivery.id, status: 'active', current_stage: 'verifying' },
        contract: { acceptanceCriteria: ['浏览器验收通过'] },
      } as never,
    }, delivery.id);

    expect(view?.acceptance).toMatchObject({
      total: 1,
      passed: 0,
      pending: 1,
      evidence: [{ criterion: '浏览器验收通过', status: 'pending', evidenceRefs: [] }],
      verification: undefined,
    });
  });

  it('uses authoritative task progress when the persisted delivery stage is stale', () => {
    const view = projectDeliveryWorkspace({
      conversations: [delivery],
      tasks: [task('TASK-1', 'in_review')],
      blockersByConversation: {},
      chatMessagesByConversation: {},
      deliveryRunSnapshot: {
        run: {
          id: 'run-stale-stage',
          conversation_id: delivery.id,
          status: 'active',
          current_stage: 'planning',
        },
        contract: { acceptanceCriteria: ['报告通过评审'] },
      } as never,
    }, delivery.id);

    expect(view).toMatchObject({
      stage: 'reviewing',
      work: {
        current: [expect.objectContaining({ id: 'TASK-1', status: 'in_review' })],
      },
    });
  });

  it('keeps completed delivery acceptance authoritative while flagging a stale Task projection', () => {
    const view = projectDeliveryWorkspace({
      conversations: [delivery],
      tasks: [task('TASK-1', 'in_progress'), task('TASK-2', 'done')],
      blockersByConversation: {},
      chatMessagesByConversation: {},
      deliveryRunSnapshot: {
        run: {
          id: 'run-completed',
          conversation_id: delivery.id,
          status: 'completed',
          current_stage: 'delivering',
        },
        contract: { acceptanceCriteria: ['报告通过评审'] },
        bundle: {
          acceptanceResults: [{
            criterion: '报告通过评审',
            status: 'passed',
            evidenceRefs: ['review:1'],
          }],
        },
      } as never,
    }, delivery.id);

    expect(view).toMatchObject({
      stage: 'completed',
      acceptance: { total: 1, passed: 1, pending: 0 },
      work: {
        total: 2,
        completed: 1,
        terminalProjectionConflict: true,
      },
    });
  });

  it('returns null when the selected delivery is absent', () => {
    expect(projectDeliveryWorkspace({
      conversations: [delivery], tasks: [], blockersByConversation: {}, chatMessagesByConversation: {},
    }, 'missing')).toBeNull();
  });
});
