import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

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

    it('starts a fresh bubble when the same agent begins a new invocation', () => {
      useTaskHubStore.setState({
        selectedConversationId: 'conv-1',
        chatMessagesByConversation: { 'conv-1': [] },
        activeStreamMessageId: {},
        activeStreamConversationId: {},
      });

      const firstId = useTaskHubStore.getState().ensureStreamMessage('mario', 'conv-1', 'inv-1');
      const secondId = useTaskHubStore.getState().ensureStreamMessage('mario', 'conv-1', 'inv-2');
      const messages = useTaskHubStore.getState().chatMessagesByConversation['conv-1'];

      expect(secondId).not.toBe(firstId);
      expect(messages.find((message) => message.id === firstId)?.isStreaming).toBe(false);
      expect(messages.find((message) => message.id === secondId)).toMatchObject({
        invocationId: 'inv-2',
        isStreaming: true,
      });
    });

    it('does not let a delayed completion close a newer invocation', () => {
      useTaskHubStore.setState({
        selectedConversationId: 'conv-1',
        chatMessagesByConversation: { 'conv-1': [] },
        activeStreamMessageId: {},
        activeStreamConversationId: {},
      });

      const firstId = useTaskHubStore.getState().ensureStreamMessage('mario', 'conv-1', 'inv-1');
      const secondId = useTaskHubStore.getState().ensureStreamMessage('mario', 'conv-1', 'inv-2');
      useTaskHubStore.getState().completeStreamMessage('mario', 'inv-1');

      expect(useTaskHubStore.getState().activeStreamMessageId.mario).toBe(secondId);
      expect(useTaskHubStore.getState().chatMessagesByConversation['conv-1']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: firstId, isStreaming: false }),
          expect.objectContaining({ id: secondId, isStreaming: true }),
        ]),
      );
    });

    it('still closes a legacy stream that was created before invocation correlation', () => {
      useTaskHubStore.setState({
        selectedConversationId: 'conv-1',
        chatMessagesByConversation: { 'conv-1': [] },
        activeStreamMessageId: {},
        activeStreamConversationId: {},
      });

      const messageId = useTaskHubStore.getState().ensureStreamMessage('mario', 'conv-1');
      useTaskHubStore.getState().completeStreamMessage('mario', 'inv-now-known');

      expect(useTaskHubStore.getState().activeStreamMessageId.mario).toBeUndefined();
      expect(useTaskHubStore.getState().chatMessagesByConversation['conv-1'])
        .toContainEqual(expect.objectContaining({ id: messageId, isStreaming: false }));
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
