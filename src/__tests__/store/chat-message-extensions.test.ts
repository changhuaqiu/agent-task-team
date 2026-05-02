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
      activeAgentIds: ['jean', 'keqing'],
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
            agentId: 'keqing',
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
            agentId: 'keqing',
            dependencies: [],
            artifacts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const task = useTaskHubStore.getState().getAgentCurrentTask('keqing');
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
            agentId: 'keqing',
            dependencies: [],
            artifacts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const task = useTaskHubStore.getState().getAgentCurrentTask('keqing');
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
