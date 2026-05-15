import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('ChatMessage extensions', () => {
  beforeEach(() => {
    // Reset store to a clean state before each test
    const store = useTaskHubStore.getState();
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
    (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
      setTimeout(() => callback(0), 0);
      return 0;
    };
  });

  describe('A2A possession view state', () => {
    it('records pass offer and started possession handoff', () => {
      useTaskHubStore.setState({ selectedConversationId: 'conv-1' });

      useTaskHubStore.getState().recordA2APassOffer({
        conversationId: 'conv-1',
        chainId: 'chain-1',
        passId: 'pass-1',
        fromAgentId: 'mario',
        toAgentId: 'luigi',
      });
      useTaskHubStore.getState().recordA2APossessionChanged({
        conversationId: 'conv-1',
        chainId: 'chain-1',
        currentHolderId: 'luigi',
        passId: 'pass-1',
      });

      const view = useTaskHubStore.getState().getA2AForSelectedConversation();
      expect(view?.currentHolderId).toBe('luigi');
      expect(view?.handoffs).toHaveLength(1);
      expect(view?.handoffs[0]).toMatchObject({
        passId: 'pass-1',
        fromAgentId: 'mario',
        toAgentId: 'luigi',
        status: 'started',
      });
    });

    it('records blocked pass reasons for the selected conversation', () => {
      useTaskHubStore.setState({ selectedConversationId: 'conv-1' });

      useTaskHubStore.getState().recordA2APassBlocked({
        conversationId: 'conv-1',
        chainId: 'chain-1',
        fromAgentId: 'mario',
        toAgentId: 'dk',
        reason: '当前团队没有可接收 @dk 的角色',
      });

      const view = useTaskHubStore.getState().getA2AForSelectedConversation();
      expect(view?.status).toBe('blocked');
      expect(view?.handoffs[0].status).toBe('blocked');
      expect(view?.handoffs[0].reason).toContain('@dk');
    });

    it('keeps only the latest eight handoff events for the timeline', () => {
      useTaskHubStore.setState({ selectedConversationId: 'conv-1' });

      for (let i = 0; i < 10; i++) {
        useTaskHubStore.getState().recordA2APassOffer({
          conversationId: 'conv-1',
          chainId: 'chain-1',
          passId: `pass-${i}`,
          fromAgentId: 'mario',
          toAgentId: 'luigi',
        });
      }

      const view = useTaskHubStore.getState().getA2AForSelectedConversation();
      expect(view?.handoffs).toHaveLength(8);
      expect(view?.handoffs[0].passId).toBe('pass-2');
      expect(view?.handoffs[7].passId).toBe('pass-9');
    });
  });

  describe('getAgentCurrentTask', () => {
    it('returns the in_progress task for a given agent', () => {
      const store = useTaskHubStore.getState();
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
            status: 'pending',
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
            status: 'pending',
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

  describe('createProgressMessage', () => {
    it('builds correct message for start type', () => {
      const msg = useTaskHubStore.getState().createProgressMessage({
        taskId: 'T-001',
        taskTitle: 'Init project',
        type: 'start',
      }, 'conv-1');
      expect(msg.agentId).toBe('system');
      expect(msg.intent).toBe('progress');
      expect(msg.progressData?.type).toBe('start');
      expect(msg.progressData?.taskId).toBe('T-001');
      expect(msg.content).toContain('T-001');
      expect(msg.content).toContain('开始执行');
    });

    it('builds correct message for complete type', () => {
      const msg = useTaskHubStore.getState().createProgressMessage({
        taskId: 'T-001',
        taskTitle: 'Init project',
        type: 'complete',
      }, 'conv-1');
      expect(msg.progressData?.type).toBe('complete');
      expect(msg.content).toContain('执行完成');
    });

    it('builds correct message for update type with steps', () => {
      const msg = useTaskHubStore.getState().createProgressMessage({
        taskId: 'T-001',
        taskTitle: 'Init project',
        type: 'update',
        completedSteps: 2,
        totalSteps: 4,
        steps: [
          { label: 'Install deps', status: 'done' },
          { label: 'Config Tailwind', status: 'done' },
          { label: 'Setup ESLint', status: 'in_progress' },
          { label: 'Create layout', status: 'pending' },
        ],
      }, 'conv-1');
      expect(msg.progressData?.completedSteps).toBe(2);
      expect(msg.progressData?.totalSteps).toBe(4);
      expect(msg.progressData?.steps).toHaveLength(4);
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
      store.appendToStreamMessage(messageId, { content: '最终答复文本' });
      store.completeStreamMessage('mario');

      const message = useTaskHubStore
        .getState()
        .chatMessagesByConversation['conv-1']
        .find((m) => m.id === messageId);

      expect(message?.content).toBe('最终答复文本');
      expect(message?.isStreaming).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe('confirmBreakdown system feedback', () => {
    it('sends a system message after confirming breakdown', () => {
      const convId = 'conv-1';
      useTaskHubStore.setState({
        conversations: [{ id: convId, title: 'Test', goal: 'Build X', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'reviewed', createdAt: '', updatedAt: '' }],
        selectedConversationId: convId,
        tasks: [],
        chatMessagesByConversation: { [convId]: [] },
        phases: [],
        activeAgentIds: ['mario', 'luigi'],
      });

      useTaskHubStore.getState().confirmBreakdown(convId, [
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

  describe('addChatMessage auto-create conversation', () => {
    it('auto-creates a conversation when none selected and none exist', () => {
      const store = useTaskHubStore.getState();
      expect(store.conversations.length).toBe(0);
      expect(store.selectedConversationId).toBeNull();

      // Add a human message — should auto-create a conversation
      useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: 'Hello world, this is a test message',
      });

      const after = useTaskHubStore.getState();
      expect(after.conversations.length).toBe(1);
      expect(after.selectedConversationId).not.toBeNull();

      // The message should be stored in the newly created conversation
      const convId = after.selectedConversationId!;
      const messages = after.chatMessagesByConversation[convId] ?? [];
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('Hello world, this is a test message');
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
