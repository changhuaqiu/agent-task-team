import { describe, it, expect, beforeEach, vi } from 'vitest';
import { selectUserEntryAgentIds, useTaskHubStore } from '@/store/taskHubStore';

describe('ChatMessage extensions', () => {
  beforeEach(() => {
    // Reset store to a clean state before each test
    useTaskHubStore.setState({
      conversations: [],
      selectedConversationId: null,
      tasks: [],
      chatMessagesByConversation: {},
      eventsByConversation: {},
      blockersByConversation: {},
      a2aByConversation: {},
      activeStreamMessageId: {},
      activeStreamConversationId: {},
      activeAgentIds: ['mario', 'luigi'],
    });
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      setTimeout(() => callback(0), 0);
      return 0;
    };
  });

  describe('user entry routing', () => {
    it('dispatches only the first resolved mention as the team-loop entry', () => {
      expect(selectUserEntryAgentIds(['mario', 'luigi', 'peach'])).toEqual(['mario']);
    });

    it('does not invent an entry when no mention resolves', () => {
      expect(selectUserEntryAgentIds([])).toEqual([]);
    });
  });

  describe('A2A possession view state', () => {
    it('replaces the local view with a server-owned multi-holder projection', () => {
      useTaskHubStore.setState({ selectedConversationId: 'conv-1' });

      useTaskHubStore.getState().replaceA2AProjection({
        conversationId: 'conv-1',
        chainId: 'chain-1',
        revision: 2,
        currentHolderIds: ['luigi', 'peach'],
        status: 'active',
        updatedAt: '2026-07-28T00:00:00.000Z',
        handoffs: [{
          id: 'pass-1',
          chainId: 'chain-1',
          passId: 'pass-1',
          fromAgentId: 'mario',
          toAgentId: 'luigi',
          status: 'started',
          intent: 'implement',
          timestamp: '2026-07-28T00:00:00.000Z',
        }],
      });

      const view = useTaskHubStore.getState().getA2AForSelectedConversation();
      expect(view?.currentHolderIds).toEqual(['luigi', 'peach']);
      expect(view?.handoffs).toHaveLength(1);
      expect(view?.handoffs[0]).toMatchObject({
        passId: 'pass-1',
        fromAgentId: 'mario',
        toAgentId: 'luigi',
        status: 'started',
      });
    });
  });

  describe('getAgentCurrentTask', () => {
    it('returns the in_progress task for a given agent', () => {
      // Set up a conversation and a task
      useTaskHubStore.setState({
        conversations: [
          {
            id: 'conv-1',
            title: 'Test',
            goal: 'Test goal',
            status: 'active',
            priority: 'p1',
            projectPath: '',
            breakdownStatus: 'none',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        selectedConversationId: 'conv-1',
        tasks: [
          {
            id: 'TASK-001',
            conversationId: 'conv-1',
            phaseId: '',
            title: 'Active task',
            description: 'A task in progress',
            status: 'in_progress',
            agentId: 'luigi',
            dependencies: [],
            artifacts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'TASK-002',
            conversationId: 'conv-1',
            phaseId: '',
            title: 'Pending task',
            description: 'A pending task',
            status: 'ready',
            agentId: 'luigi',
            dependencies: [],
            artifacts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const task = useTaskHubStore.getState().getAgentCurrentTask('luigi');
      expect(task).toBeDefined();
      expect(task!.id).toBe('TASK-001');
      expect(task!.status).toBe('in_progress');
    });

    it('returns undefined when no in_progress task exists for agent', () => {
      useTaskHubStore.setState({
        tasks: [
          {
            id: 'TASK-001',
            conversationId: 'conv-1',
            phaseId: '',
            title: 'Pending task',
            description: 'A pending task',
            status: 'ready',
            agentId: 'luigi',
            dependencies: [],
            artifacts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const task = useTaskHubStore.getState().getAgentCurrentTask('luigi');
      expect(task).toBeUndefined();
    });
  });

  describe('streaming message buffer', () => {
    it('flushes buffered text when stream completes before the next animation frame', async () => {
      useTaskHubStore.setState({
        conversations: [
          {
            id: 'conv-1',
            title: 'Test',
            goal: 'Test goal',
            status: 'active',
            priority: 'p1',
            projectPath: '',
            breakdownStatus: 'none',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        selectedConversationId: 'conv-1',
        chatMessagesByConversation: { 'conv-1': [] },
      });

      const store = useTaskHubStore.getState();
      const messageId = store.ensureStreamMessage('mario', 'conv-1');
      store.appendToStreamMessage(messageId, { thinking: '先分析任务。' });
      store.appendToStreamMessage(messageId, { content: '最终答复文本' });
      store.completeStreamMessage('mario');

      const message = useTaskHubStore
        .getState()
        .chatMessagesByConversation['conv-1']
        .find((m) => m.id === messageId);

      expect(message?.content).toBe('最终答复文本');
      expect(message?.thinking).toBe('先分析任务。');
      expect(message?.isStreaming).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe('confirmBreakdown system feedback', () => {
    it('sends a system message after confirming breakdown', async () => {
      const convId = 'conv-1';
      useTaskHubStore.setState({
        conversations: [{ id: convId, title: 'Test', goal: 'Build X', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'reviewed', createdAt: '', updatedAt: '' }],
        selectedConversationId: convId,
        tasks: [],
        chatMessagesByConversation: { [convId]: [] },
        phases: [],
        activeAgentIds: ['mario', 'luigi'],
      });

      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        if (String(input) === '/api/workspace-commands') {
          const command = JSON.parse(String(init?.body));
          const phases = command.phases.map((phase: Record<string, unknown>) => ({
            id: phase.id,
            conversationId: convId,
            title: phase.title,
            description: phase.description,
            order: phase.order,
            status: phase.status,
            createdAt: command.issuedAt,
            updatedAt: command.issuedAt,
          }));
          const tasks = command.phases.flatMap((phase: { id: string; tasks: Array<Record<string, unknown>> }) =>
            phase.tasks.map((task) => ({
              phaseId: phase.id,
              task: {
                id: task.id, conversation_id: convId, title: task.title,
                description: task.description, status: 'ready', agent_id: task.agentId,
                dependencies: '[]', artifacts: '[]', revision: 0, created_at: '', updated_at: '',
              },
            })),
          );
          return { ok: true, status: 200, json: async () => ({ receipt: {
            idempotencyKey: command.idempotencyKey, commandType: command.type,
            projectPath: command.projectPath, deliveryId: command.deliveryId,
            status: 'accepted', duplicate: false, targetAgentIds: [], recordedAt: new Date().toISOString(),
            result: { phases, tasks },
          } }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      });
      await useTaskHubStore.getState().confirmBreakdown(convId, [
        { title: 'Phase 1', description: '', tasks: [
          { title: 'Task A', description: '', agentId: 'luigi' },
          { title: 'Task B', description: '', agentId: 'luigi' },
        ]},
      ]);

      const messages = useTaskHubStore.getState().chatMessagesByConversation[convId];
      const systemMsg = messages?.find(m => m.agentId === 'system' && m.intent !== 'progress');
      expect(systemMsg).toBeDefined();
      expect(systemMsg?.content).toContain('2 个任务');
      expect(systemMsg?.content).toContain('1 个阶段');
    });
  });

  describe('addChatMessage delivery scope', () => {
    it('does not create a bare conversation when none is selected', async () => {
      const store = useTaskHubStore.getState();
      expect(store.conversations.length).toBe(0);
      expect(store.selectedConversationId).toBeNull();

      const result = await useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: 'Hello world, this is a test message',
      });

      const after = useTaskHubStore.getState();
      expect(result).toEqual({ ok: false, error: '请先选择或新建一个交付' });
      expect(after.conversations.length).toBe(0);
      expect(after.selectedConversationId).toBeNull();
      expect(after.chatMessagesByConversation).toEqual({});
    });

    it('does NOT auto-create when conversations already exist', () => {
      // Pre-create a conversation
      useTaskHubStore.setState({
        conversations: [
          {
            id: 'conv-existing',
            title: 'Existing',
            goal: 'Already here',
            status: 'active',
            priority: 'p1',
            projectPath: '',
            breakdownStatus: 'none',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        selectedConversationId: 'conv-existing',
        chatMessagesByConversation: { 'conv-existing': [] },
      });

      const beforeCount = useTaskHubStore.getState().conversations.length;

      // Add a message — should NOT create a new conversation
      useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: 'Just a message',
      });

      const after = useTaskHubStore.getState();
      expect(after.conversations.length).toBe(beforeCount);
    });
  });
});
