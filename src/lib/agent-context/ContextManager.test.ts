import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager, noOpMemoryHook, type ContextRequest } from './ContextManager';
import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/types';
import { ContextBudget } from './ContextBudget';

describe('ContextManager', () => {
  const mockRoleCard: RoleCard = {
    id: 'toad',
    name: 'Toad',
    category: 'backend' as const,
    responsibilities: [],
    nonResponsibilities: [],
    forbiddenActions: [],
    allowedActions: [],
    requiresConfirmation: [],
    requiresEvidence: false,
    outputFormat: 'freeform' as const,
    riskGrading: 'medium' as const,
    isPreset: false,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let mockProviders: any;

  beforeEach(() => {
    mockProviders = {
      getRoleCard: vi.fn().mockResolvedValue(mockRoleCard),
      getAllRoleCards: vi.fn().mockResolvedValue([mockRoleCard]),
      getMessages: vi.fn().mockResolvedValue([]),
      getTask: vi.fn().mockResolvedValue(undefined),
      getTasks: vi.fn().mockResolvedValue([]),
      getTeamPack: vi.fn().mockResolvedValue(undefined),
      getRuntimeRoster: vi.fn().mockResolvedValue([]),
      getSkills: vi.fn().mockResolvedValue([]),
      getCurrentLoad: vi.fn().mockReturnValue({}),
      getTeamLogEnvelope: vi.fn().mockResolvedValue({
        unseenCount: 0,
        entries: [],
        filePath: '.ath/team-log.md',
        totalTokens: 0,
      }),
    };
  });

  it('应该输出含全部 P0 层', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    const req: ContextRequest = {
      agentId: 'toad',
      conversationId: 'conv-123',
      taskId: 'task-123',
      rawPrompt: '实现 ContextManager',
      trigger: 'user_turn',
      isFirstWake: false,
      budgetOverride: new ContextBudget({ maxTokens: 8000 }),
    };

    const result = await manager.assembleContext(req);

    expect(result.userPrompt).toBeDefined();
    expect(result.report.tokensUsed).toBeGreaterThan(0);
    expect(result.report.p0Intact).toBe(true);
  });

  it('超预算时 P4 层优先被裁剪', async () => {
    // 构造大量历史消息，确保会超过预算
    const largeMessages: ChatMessage[] = Array.from({ length: 100 }, (_, i) => ({
      id: `msg-${i}`,
      agentId: 'toad',
      content: 'a'.repeat(200),
      timestamp: '2024-01-01T00:00:00Z',
      conversationId: 'conv-123', // 与当前会话匹配，会进入历史
    }));

    mockProviders.getMessages.mockResolvedValue(largeMessages);

    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    const req: ContextRequest = {
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: 'a'.repeat(400),
      trigger: 'user_turn',
      isFirstWake: false,
      budgetOverride: new ContextBudget({ maxTokens: 1000 }),
    };

    const result = await manager.assembleContext(req);

    expect(result.report.droppedLayers.length).toBeGreaterThan(0);
    // history 是 P4，应该被裁剪（预算不足以容纳所有历史）
    expect(result.report.droppedLayers).toContain('history');
  });

  it('首次唤醒返回 systemPrompt', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    const req: ContextRequest = {
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '实现 ContextManager',
      trigger: 'user_turn',
      isFirstWake: true,
      budgetOverride: new ContextBudget({ maxTokens: 8000 }),
    };

    const result = await manager.assembleContext(req);

    expect(result.systemPrompt).toBeDefined();
    // P1: 只验证 systemPrompt 存在，不检查具体内容（可能不含 roleCard.name）

    // 去重校验：首次唤醒时，collaboration 协议在 systemPrompt（bootstrap
    // channel）已注入，systemTier 不应再 push 一份。合并后文本里
    // "## Agent 协作协议" 只应出现一次（A 类修复：消除平行路径重复）。
    const merged = `${result.systemPrompt ?? ''}\n\n${result.userPrompt}`;
    const collaborationOccurrences = (merged.match(/## Agent 协作协议/g) ?? []).length;
    expect(collaborationOccurrences).toBe(1);
  });

  it('非首次唤醒不返回 systemPrompt', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    const req: ContextRequest = {
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '继续',
      trigger: 'user_turn',
      isFirstWake: false,
    };

    const result = await manager.assembleContext(req);

    expect(result.systemPrompt).toBeUndefined();
  });

  it('按 wakeup 策略省略 dialog 并暴露簇决策', async () => {
    mockProviders.getTask.mockResolvedValue({ id: 'task-1', title: '继续实现' });
    mockProviders.getTeamLogEnvelope.mockResolvedValue({
      unseenCount: 1,
      entries: [{ sender: '@peach', category: 'review', taskRef: 'task-1', summary: '评审通过' }],
      filePath: '.ath/team-log.md',
      totalTokens: 30,
      upToEntryId: 'msg-9',
    });
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    const result = await manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      taskId: 'task-1',
      rawPrompt: '这段原始对话不应被注入',
      trigger: 'resume',
      isFirstWake: true,
      wakeup: { reasonCode: 'owner_ready', reasonSummary: '依赖已满足' },
    });

    expect(result.report).toMatchObject({
      scenario: 'wakeup',
      archetype: 'worker',
      includedClusters: expect.arrayContaining(['protocol', 'capability', 'focus']),
      omittedClusters: expect.arrayContaining(['identity', 'dialog']),
      teamLogUpToEntryId: 'msg-9',
    });
    expect(result.userPrompt).toContain('系统唤醒');
    expect(result.userPrompt).toContain('继续实现');
    expect(result.userPrompt).toContain('团队动态');
    expect(result.userPrompt).toContain('评审通过');
    expect(result.userPrompt).not.toContain('这段原始对话不应被注入');
    expect(result.systemPrompt).toBeUndefined();

    // 回归校验：wakeup 首次唤醒（identity omit → systemPrompt 不构建），
    // collaboration 协议仍必须经 message channel 注入，不能因为 isFirstWake
    // 被整体丢弃。之前用 !req.isFirstWake 做 guard 导致此处出现 0 次。
    expect(result.userPrompt).toContain('## Agent 协作协议');
  });

  it('编译绑定 Skill 并在报告中记录版本与交付结果', async () => {
    mockProviders.getSkillCompilation = vi.fn().mockResolvedValue({
      catalog: [{ skillId: 'skill-1', name: 'code-review', description: 'Review safely', revision: 'skill-rev-1' }],
      activated: [{
        skillId: 'skill-1', name: 'code-review', description: 'Review safely', revision: 'skill-rev-1',
        contentHash: 'hash-1', body: 'Check correctness first.', resourceRefs: ['/skills/code-review/references/guide.md'],
        reason: 'agent_binding', required: true,
      }],
      decisions: [],
    });
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    const result = await manager.assembleContext({
      agentId: 'toad', conversationId: 'conv-123', rawPrompt: 'review this', trigger: 'user_turn', isFirstWake: false,
    });

    expect(result.userPrompt).toContain('## Skill: code-review');
    expect(result.userPrompt).toContain('Revision: skill-rev-1');
    expect(result.userPrompt).toContain('/skills/code-review/references/guide.md');
    expect(result.report.loadedSkills).toEqual(['code-review']);
    expect(result.report.skillDecisions[0]).toMatchObject({
      name: 'code-review', revision: 'skill-rev-1', outcome: 'loaded', reasonCode: 'compiled_into_context',
    });
  });

  it('必需 Skill 被预算裁剪时阻断执行', async () => {
    mockProviders.getSkillCompilation = vi.fn().mockResolvedValue({
      catalog: [{ skillId: 'skill-1', name: 'large-skill', description: 'Large', revision: 'skill-rev-1' }],
      activated: [{
        skillId: 'skill-1', name: 'large-skill', description: 'Large', revision: 'skill-rev-1',
        contentHash: 'hash-1', body: 'x'.repeat(20_000), resourceRefs: [], reason: 'agent_binding', required: true,
      }],
      decisions: [],
    });
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    await expect(manager.assembleContext({
      agentId: 'toad', conversationId: 'conv-123', rawPrompt: 'continue', trigger: 'user_turn', isFirstWake: false,
      budgetOverride: new ContextBudget({ maxTokens: 1_000 }),
    })).rejects.toThrow('required_skill_not_loaded: large-skill');
  });
});
