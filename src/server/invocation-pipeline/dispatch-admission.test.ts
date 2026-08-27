import { describe, expect, it } from 'vitest';
import { admitDispatch } from './dispatch-admission';

const mario = {
  id: 'mario',
  displayName: 'Mario',
  instructions: '负责理解目标、拆解工作、协调团队并推动交付闭环。',
  responsibility: 'coordinator' as const,
  canModifyCode: true,
  canReview: false,
};

const luigi = {
  id: 'luigi',
  displayName: 'Luigi',
  instructions: '负责在明确边界内完成全栈实现。',
  responsibility: 'implementer' as const,
  canModifyCode: true,
  canReview: false,
};

describe('DispatchAdmission', () => {
  it('admits a direct Mario handoff as planning even when its legacy definition allows edits', () => {
    const result = admitDispatch({
      trigger: {
        id: 'mention-mario', source: 'a2a', conversationId: 'project-1', agentId: 'mario',
        prompt: '@mario 看到消息了吧，开始处理吧',
      },
      agent: mario,
      definitionRevision: 7,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      grant: expect.objectContaining({
        kind: 'planning',
        contextScenario: 'planning',
        archetype: 'planner',
        allowCodeChanges: false,
        role: expect.objectContaining({
          definitionId: 'mario',
          definitionRevision: 7,
          responsibility: 'coordinator',
        }),
      }),
    }));
  });

  it('rejects implementation of an unassigned Task by an implementation Agent', () => {
    const result = admitDispatch({
      trigger: {
        id: 'mention-luigi', source: 'a2a', conversationId: 'project-1', agentId: 'luigi',
        taskId: 'TASK-1', prompt: '实现自动归类',
      },
      task: { id: 'TASK-1', status: 'ready', agent_id: '', revision: 1 },
      agent: luigi,
      definitionRevision: 3,
    });

    expect(result).toMatchObject({ ok: false, reasonCode: 'dispatch_task_assignment_required' });
  });

  it('admits the assigned implementation Agent with code mutation capability', () => {
    const result = admitDispatch({
      trigger: {
        id: 'owner-wakeup', source: 'workflow', conversationId: 'project-1', agentId: 'luigi',
        taskId: 'TASK-1', prompt: '实现自动归类',
      },
      task: { id: 'TASK-1', status: 'ready', agent_id: 'luigi', revision: 4 },
      agent: luigi,
      definitionRevision: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      grant: { kind: 'execution', allowCodeChanges: true },
    });
  });

  it('keeps a vague unbound request to an implementer in planning', () => {
    const result = admitDispatch({
      trigger: {
        id: 'mention-luigi', source: 'a2a', conversationId: 'project-1', agentId: 'luigi',
        prompt: '@luigi 开始处理',
      },
      agent: luigi,
      definitionRevision: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      grant: { kind: 'planning', allowCodeChanges: false, reasonCode: 'dispatch_unbound_request_planning' },
    });
  });

  it('admits a server-modeled ad-hoc implementation subject', () => {
    const result = admitDispatch({
      trigger: {
        id: 'adhoc-luigi', source: 'system', conversationId: 'project-1', agentId: 'luigi',
        prompt: '修复独立诊断脚本', executionSubject: { kind: 'ad_hoc_execution', id: 'incident-42' },
      },
      agent: luigi,
      definitionRevision: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      grant: { kind: 'execution', allowCodeChanges: true, reasonCode: 'dispatch_explicit_ad_hoc_execution' },
    });
  });
});
