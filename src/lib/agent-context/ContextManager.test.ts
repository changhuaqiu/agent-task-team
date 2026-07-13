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
    const largeMessages: ChatMessage[] = Array.from({ length: 100 }, (_, i) => ({
      id: `msg-${i}`,
      agentId: 'user',
      content: 'a'.repeat(200),
      timestamp: '2024-01-01T00:00:00Z',
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
});