import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ContextManager,
  noOpMemoryHook,
  RequiredContextError,
  type ContextContributor,
  type ContextFragment,
  type ContextProviders,
  type ContextRequest,
} from './ContextManager';
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

  let mockProviders: ContextProviders;

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

    await expect(manager.assembleContext(req))
      .rejects.toThrow('required_context_missing: legacy:4:userMessage');
    // history 是 P4，应该被裁剪（预算不足以容纳所有历史）
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
    mockProviders.getTask.mockResolvedValue({
      id: 'task-1',
      title: '继续实现',
      conversationId: 'conv-123',
    });
    mockProviders.getMessages.mockResolvedValue([{
      id: 'history-1',
      agentId: 'toad',
      content: '仅存在于历史窗口的旧对话',
      timestamp: '2026-07-18T00:00:00.000Z',
      conversationId: 'conv-123',
    }]);
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
    expect(result.userPrompt).toContain('这段原始对话不应被注入');
    expect(result.userPrompt).not.toContain('仅存在于历史窗口的旧对话');
    expect(result.snapshot.omissions).toContainEqual(expect.objectContaining({
      producer: 'legacy-tier-adapter',
      reason: 'scenario_omitted',
      detail: 'wakeup:dialog',
    }));
    expect(result.snapshot.fragmentRefs).toContainEqual(expect.objectContaining({
      kind: 'legacy.userMessage',
      lifecycle: 'event',
      consistency: 'eventual',
      deliveryMode: 'delta',
      subject: { kind: 'agent', id: 'toad' },
      deliveryChannel: 'message',
    }));
    expect(result.snapshot.fragmentRefs).toContainEqual(expect.objectContaining({
      kind: 'legacy.task',
      lifecycle: 'versioned',
      consistency: 'strong',
      deliveryMode: 'on_change',
      subject: { kind: 'task', id: 'task-1' },
      sourceOwner: 'task-graph',
    }));
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

  it('通过 Contributor 注入场景上下文并生成可追溯 Snapshot', async () => {
    const contributor: ContextContributor = {
      id: 'architecture-decisions',
      async contribute(query) {
        return [{
          id: 'decision:adr-12',
          kind: 'decision.architecture',
          cluster: 'situation',
          scope: { kind: 'project', projectId: query.conversationId },
          subject: { kind: 'project', id: query.conversationId },
          producer: 'architecture-decisions',
          version: 'adr-12-v3',
          content: 'ADR-12：所有外部副作用必须经过 Provider Gateway。',
          visibility: { kind: 'team' },
          freshness: { observedAt: '2026-07-19T00:00:00.000Z' },
          evidenceRefs: ['docs/adr/12.md'],
        }];
      },
    };
    const manager = new ContextManager(mockProviders, noOpMemoryHook, {
      contributors: [contributor],
      now: () => new Date('2026-07-19T01:00:00.000Z'),
    });

    const result = await manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '规划 Provider 接入',
      trigger: 'user_turn',
      scenario: 'planning',
      isFirstWake: false,
    });

    expect(result.userPrompt).toContain('ADR-12：所有外部副作用必须经过 Provider Gateway。');
    expect(result.snapshot).toMatchObject({
      id: expect.stringMatching(/^ctx_/),
      query: { scenario: 'planning', conversationId: 'conv-123', requestDigest: expect.any(String) },
      capabilities: [],
      missingRequired: [],
    });
    expect(result.snapshot.fragmentRefs).toContainEqual(expect.objectContaining({
      id: 'decision:adr-12',
      producer: 'architecture-decisions',
      version: 'adr-12-v3',
      evidenceRefs: ['docs/adr/12.md'],
    }));
    expect(result.report).toMatchObject({
      snapshotId: result.snapshot.id,
      fragmentCount: result.snapshot.fragmentRefs.length,
    });
  });

  it('does not let optional contributor content evict required project context', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook, {
      contributors: [
        {
          id: 'optional-tools',
          contribute: async (query) => [{
            id: 'optional:large-tool-catalog',
            kind: 'tool.catalog',
            cluster: 'capability',
            scope: { kind: 'project', projectId: query.conversationId },
            subject: { kind: 'project', id: query.conversationId },
            producer: 'optional-tools',
            version: '1',
            content: `OPTIONAL:${'x'.repeat(8_000)}`,
            visibility: { kind: 'team' },
            freshness: { observedAt: query.now },
            evidenceRefs: [],
          }],
        },
        {
          id: 'project-context',
          required: true,
          contribute: async (query) => [{
            id: `project-context:${query.conversationId}`,
            kind: 'project.context.capsule',
            cluster: 'situation',
            scope: { kind: 'project', projectId: query.conversationId },
            subject: { kind: 'project', id: query.conversationId },
            producer: 'project-context',
            version: '1',
            content: `REQUIRED_PROJECT_CONTEXT:${'p'.repeat(400)}`,
            visibility: { kind: 'team' },
            freshness: { observedAt: query.now },
            evidenceRefs: [],
            required: true,
          }],
        },
      ],
    });

    const result = await manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: 'continue',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
      budgetOverride: new ContextBudget({ maxTokens: 2_000 }),
    });

    expect(result.userPrompt).toContain('REQUIRED_PROJECT_CONTEXT:');
    expect(result.userPrompt).not.toContain('OPTIONAL:');
    expect(result.snapshot.missingRequired).toEqual([]);
    expect(result.snapshot.omissions).toContainEqual(expect.objectContaining({
      fragmentId: 'optional:large-tool-catalog',
      reason: 'budget_trimmed',
      required: false,
    }));
  });

  it('still fails closed when required contributor content itself exceeds the budget', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook, {
      contributors: [{
        id: 'project-context',
        required: true,
        contribute: async (query) => [{
          id: `project-context:${query.conversationId}`,
          kind: 'project.context.capsule',
          cluster: 'situation',
          scope: { kind: 'project', projectId: query.conversationId },
          subject: { kind: 'project', id: query.conversationId },
          producer: 'project-context',
          version: '1',
          content: 'p'.repeat(8_000),
          visibility: { kind: 'team' },
          freshness: { observedAt: query.now },
          evidenceRefs: [],
          required: true,
        }],
      }],
    });

    let thrown: unknown;
    try {
      await manager.assembleContext({
        agentId: 'toad',
        conversationId: 'conv-123',
        rawPrompt: 'continue',
        trigger: 'resume',
        scenario: 'execution',
        isFirstWake: false,
        budgetOverride: new ContextBudget({ maxTokens: 1_000 }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RequiredContextError);
    expect((thrown as RequiredContextError).missingRequired)
      .toContain('project-context:conv-123');
    expect((thrown as RequiredContextError).omissions).toContainEqual(expect.objectContaining({
      fragmentId: 'project-context:conv-123',
      reason: 'budget_trimmed',
      required: true,
    }));
  });

  it('显式 Team Harness 场景在首个 session 仍完成身份 bootstrap', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    const result = await manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '开始执行',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: true,
    });

    expect(result.report.scenario).toBe('execution');
    expect(result.systemPrompt).toBeDefined();
    const merged = `${result.systemPrompt ?? ''}\n${result.userPrompt}`;
    expect((merged.match(/## Agent 协作协议/g) ?? [])).toHaveLength(1);
    expect(result.snapshot.fragmentRefs).toContainEqual(expect.objectContaining({
      id: 'legacy:bootstrap:system',
    }));
  });

  it('把 A2A 交接归一化为 causal event Artifact', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook);
    const result = await manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '接手评审',
      trigger: 'a2a_handoff',
      scenario: 'handoff',
      a2aHandoff: {
        title: '实现完成',
        requestedAction: '评审 TASK-1',
        possessionSummary: '实现与测试已完成',
        relevantDecisions: [],
        evidenceRefs: ['artifact:test-result'],
        constraints: [],
        openQuestions: [],
        forbiddenBehaviors: [],
        sourceMessageIds: [],
      },
      isFirstWake: false,
    });

    expect(result.snapshot.fragmentRefs).toContainEqual(expect.objectContaining({
      kind: 'legacy.a2a',
      lifecycle: 'event',
      consistency: 'causal',
      deliveryMode: 'delta',
    }));
  });

  it('机械过滤越域、过期和不可见 Fragment 并报告原因', async () => {
    const fragments: ContextFragment[] = [
      {
        id: 'wrong-project',
        kind: 'task',
        cluster: 'focus',
        scope: { kind: 'project', projectId: 'conv-other' },
        subject: { kind: 'task', id: 'task-other' },
        producer: 'test-context',
        version: '1',
        content: '不应跨项目出现',
        visibility: { kind: 'team' },
        freshness: { observedAt: '2026-07-18T00:00:00.000Z' },
        evidenceRefs: [],
      },
      {
        id: 'expired-fact',
        kind: 'runtime.health',
        cluster: 'situation',
        scope: { kind: 'project', projectId: 'conv-123' },
        subject: { kind: 'agent', id: 'toad' },
        producer: 'test-context',
        version: '1',
        content: '已经过期的运行时状态',
        visibility: { kind: 'team' },
        freshness: {
          observedAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T01:00:00.000Z',
        },
        evidenceRefs: [],
      },
      {
        id: 'private-other-agent',
        kind: 'trajectory',
        cluster: 'situation',
        scope: { kind: 'project', projectId: 'conv-123' },
        subject: { kind: 'agent', id: 'mario' },
        producer: 'test-context',
        version: '1',
        content: 'Mario 的私有轨迹',
        visibility: { kind: 'agent', agentId: 'mario' },
        freshness: { observedAt: '2026-07-18T00:00:00.000Z' },
        evidenceRefs: [],
      },
      {
        id: 'planner-only',
        kind: 'planning.note',
        cluster: 'situation',
        scope: { kind: 'project', projectId: 'conv-123' },
        subject: { kind: 'team', id: 'conv-123' },
        producer: 'test-context',
        version: '1',
        content: '只允许 Planner 看到',
        visibility: { kind: 'role', archetypes: ['planner'] },
        freshness: { observedAt: '2026-07-18T00:00:00.000Z' },
        evidenceRefs: [],
      },
      {
        id: 'invalid-global-work-state',
        kind: 'task.global',
        cluster: 'focus',
        scope: { kind: 'global', key: 'shared-task' },
        subject: { kind: 'task', id: 'task-global' },
        producer: 'test-context',
        version: '1',
        content: '项目工作事实不能进入全局作用域',
        visibility: { kind: 'team' },
        freshness: { observedAt: '2026-07-18T00:00:00.000Z' },
        evidenceRefs: [],
      },
      {
        id: 'masquerading-global-task',
        kind: 'identity.task',
        cluster: 'identity',
        scope: { kind: 'global', key: 'shared-task' },
        subject: { kind: 'task', id: 'task-global' },
        producer: 'test-context',
        version: '1',
        content: '任务事实不能伪装成全局身份',
        visibility: { kind: 'team' },
        freshness: { observedAt: '2026-07-18T00:00:00.000Z' },
        evidenceRefs: [],
      },
    ];
    const manager = new ContextManager(mockProviders, noOpMemoryHook, {
      contributors: [{ id: 'test-context', contribute: async () => fragments }],
      now: () => new Date('2026-07-19T00:00:00.000Z'),
    });

    const result = await manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '继续执行',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    });

    expect(result.userPrompt).not.toContain('不应跨项目出现');
    expect(result.userPrompt).not.toContain('已经过期的运行时状态');
    expect(result.userPrompt).not.toContain('Mario 的私有轨迹');
    expect(result.userPrompt).not.toContain('只允许 Planner 看到');
    expect(result.userPrompt).not.toContain('项目工作事实不能进入全局作用域');
    expect(result.userPrompt).not.toContain('任务事实不能伪装成全局身份');
    expect(result.snapshot.omissions.map(item => item.reason)).toEqual(expect.arrayContaining([
      'project_scope_mismatch',
      'expired',
      'visibility_denied',
      'global_scope_not_allowed',
    ]));
  });

  it('确定性保留最新 Fragment，并隔离单个 Contributor 失败', async () => {
    const fragment = (
      producer: string,
      version: string,
      observedAt: string,
      content: string,
    ): ContextFragment => ({
      id: 'decision:shared',
      kind: 'decision',
      cluster: 'situation',
      scope: { kind: 'project', projectId: 'conv-123' },
      subject: { kind: 'project', id: 'conv-123' },
      producer,
      version,
      content,
      visibility: { kind: 'team' },
      freshness: { observedAt },
      evidenceRefs: [],
    });
    const manager = new ContextManager(mockProviders, noOpMemoryHook, {
      contributors: [
        {
          id: 'old-decisions',
          contribute: async () => [{
            ...fragment('old-decisions', 'v1', '2026-07-18T00:00:00.000Z', '旧决策'),
            required: true,
          }],
        },
        {
          id: 'new-decisions',
          contribute: async () => [
            fragment('new-decisions', 'v2', '2026-07-19T00:00:00.000Z', '新决策'),
          ],
        },
        { id: 'broken-provider', contribute: () => { throw new Error('secret=knowledge-index-token'); } },
        {
          id: 'malformed-provider',
          contribute: async () => [{
            id: 'malformed',
            kind: 'decision',
            cluster: 'situation',
            scope: { kind: 'project', projectId: 'conv-123' },
            subject: { kind: 'project', id: 'conv-123' },
            producer: 'malformed-provider',
            version: '1',
            content: null,
            visibility: { kind: 'role', archetypes: ['not-a-role'] },
            freshness: { observedAt: 'not-a-date' },
            evidenceRefs: 'not-an-array',
          } as unknown as ContextFragment],
        },
      ],
      now: () => new Date('2026-07-19T01:00:00.000Z'),
    });

    const result = await manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '继续执行',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    });

    expect(result.userPrompt).toContain('新决策');
    expect(result.userPrompt).not.toContain('旧决策');
    expect(result.snapshot.fragmentRefs).toContainEqual(expect.objectContaining({
      id: 'decision:shared',
      version: 'v2',
    }));
    expect(result.snapshot.omissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ fragmentId: 'decision:shared', reason: 'duplicate_replaced' }),
      expect.objectContaining({ fragmentId: 'contributor:broken-provider', reason: 'contributor_failed' }),
      expect.objectContaining({ fragmentId: 'malformed', reason: 'invalid_fragment' }),
    ]));
    expect(result.snapshot.missingRequired).toEqual([]);
    expect(JSON.stringify(result.snapshot.omissions)).not.toContain('knowledge-index-token');
  });

  it('Snapshot id 包含 Fragment kind 与 semantic', async () => {
    const assemble = async (kind: string) => {
      const manager = new ContextManager(mockProviders, noOpMemoryHook, {
        contributors: [{
          id: 'semantic-source',
          contribute: async (query) => [{
            id: 'semantic:shared',
            kind,
            cluster: 'situation',
            scope: { kind: 'project', projectId: query.conversationId },
            subject: { kind: 'project', id: query.conversationId },
            producer: 'semantic-source',
            version: '1',
            content: '相同文本',
            visibility: { kind: 'team' },
            freshness: { observedAt: query.now },
            evidenceRefs: [],
          }],
        }],
        now: () => new Date('2026-07-19T01:00:00.000Z'),
      });
      return manager.assembleContext({
        agentId: 'toad',
        conversationId: 'conv-123',
        rawPrompt: '继续执行',
        trigger: 'resume',
        scenario: 'execution',
        isFirstWake: false,
      });
    };

    const decision = await assemble('decision.architecture');
    const status = await assemble('project.status');

    expect(decision.snapshot.id).not.toBe(status.snapshot.id);
  });

  it('拒绝读取其他项目的 Task 上下文', async () => {
    mockProviders.getTask.mockResolvedValue({
      id: 'task-other',
      title: '其他项目任务',
      conversationId: 'conv-other',
    });
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    await expect(manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      taskId: 'task-other',
      rawPrompt: '继续执行',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    })).rejects.toThrow('context_scope_mismatch');
  });

  it('拒绝调用方提供的越域 Project 与 Message', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook);
    await expect(manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '继续执行',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
      project: { id: 'conv-other', name: 'Other', path: 'C:/other' },
    })).rejects.toThrow('context_scope_mismatch: project');

    mockProviders.getMessages.mockResolvedValue([{
      id: 'message-other',
      agentId: 'toad',
      content: '其他项目消息',
      timestamp: '2026-07-19T00:00:00.000Z',
      conversationId: 'conv-other',
    }]);
    await expect(manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '继续执行',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    })).rejects.toThrow('context_scope_mismatch: message');
  });

  it('拒绝没有 conversationId 的历史消息，不猜测其项目归属', async () => {
    mockProviders.getMessages.mockResolvedValue([{
      id: 'message-unscoped',
      agentId: 'toad',
      content: '没有项目归属的旧消息',
      timestamp: '2026-07-19T00:00:00.000Z',
    }]);
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    await expect(manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '继续执行',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    })).rejects.toThrow('context_scope_missing: message message-unscoped');
  });

  it('required Contributor 未注册时仍然 fail closed', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook);

    await expect(manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      deliveryRunId: 'delivery-run-missing-contributor',
      rawPrompt: '继续自主交付',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    })).rejects.toThrow('required_context_missing: contributor:autonomous-delivery');
  });

  it('Contributor 不能通过伪造 producer 冒名满足 required 门禁', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook, {
      contributors: [{
        id: 'autonomous-delivery',
        required: true,
        contribute: async (query) => [{
          id: 'delivery:spoofed',
          kind: 'goal.contract',
          cluster: 'focus',
          scope: { kind: 'project', projectId: query.conversationId },
          subject: { kind: 'goal', id: query.deliveryRunId ?? 'run' },
          producer: 'different-producer',
          version: '1',
          content: '伪造生产者',
          visibility: { kind: 'team' },
          freshness: { observedAt: query.now },
          evidenceRefs: [],
          required: true,
        }],
      }],
    });

    await expect(manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      deliveryRunId: 'delivery-run-spoofed',
      rawPrompt: '继续自主交付',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    })).rejects.toThrow('required_context_missing');
  });

  it('必需 Fragment 校验失败时阻断执行', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook, {
      contributors: [{
        id: 'invalid-required',
        contribute: async () => [{
          id: 'required:invalid',
          kind: 'goal',
          cluster: 'focus',
          scope: { kind: 'project', projectId: 'conv-123' },
          subject: { kind: 'goal', id: 'goal-1' },
          producer: 'invalid-required',
          version: '1',
          content: null,
          visibility: { kind: 'team' },
          freshness: { observedAt: '2026-07-19T00:00:00.000Z' },
          evidenceRefs: [],
          required: true,
        } as unknown as ContextFragment],
      }],
    });

    await expect(manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '执行',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    })).rejects.toThrow('required_context_missing: required:invalid');
  });

  it('把被场景省略的必需 Fragment 暴露为 missingRequired', async () => {
    const manager = new ContextManager(mockProviders, noOpMemoryHook, {
      contributors: [{
        id: 'required-dialog',
        required: true,
        contribute: async (query) => [{
          id: 'required:user-clarification',
          kind: 'dialog.required',
          cluster: 'dialog',
          scope: { kind: 'project', projectId: query.conversationId },
          subject: { kind: 'agent', id: query.agentId },
          producer: 'required-dialog',
          version: '1',
          content: '必须看到的澄清信息',
          visibility: { kind: 'agent', agentId: query.agentId },
          freshness: { observedAt: '2026-07-19T00:00:00.000Z' },
          evidenceRefs: [],
          required: true,
        }],
      }],
      now: () => new Date('2026-07-19T01:00:00.000Z'),
    });

    await expect(manager.assembleContext({
      agentId: 'toad',
      conversationId: 'conv-123',
      rawPrompt: '执行任务',
      trigger: 'resume',
      scenario: 'execution',
      isFirstWake: false,
    })).rejects.toThrow('required_context_missing: required:user-clarification');
  });
});
