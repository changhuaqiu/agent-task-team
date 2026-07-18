// Regression test for issue #38 Bug 1: a human message sent when projects exist
// but none is selected must not be silently dropped. Previously addChatMessage
// returned early at `if (!conversationId) return`, losing the message. The fix
// auto-selects the first conversation as a fallback.

import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('issue #38 Bug 1 — message not dropped when project exists but none selected', () => {
  beforeEach(() => {
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
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    };
  });

  it('auto-selects the first conversation and keeps the message instead of dropping it', async () => {
    // Seed one conversation but leave nothing selected.
    useTaskHubStore.setState({
      conversations: [
        { id: 'conv-1', title: '现有项目', createdAt: '', updatedAt: '' } as any,
      ],
      selectedConversationId: null,
      chatMessagesByConversation: {},
    });

    await useTaskHubStore.getState().addChatMessage({
      agentId: 'human',
      content: '这条消息不该丢',
    });

    const state = useTaskHubStore.getState();
    // Fallback selection happened.
    expect(state.selectedConversationId).toBe('conv-1');
    // Message was attached to that conversation, not dropped.
    const msgs = state.chatMessagesByConversation['conv-1'] ?? [];
    expect(msgs.some((m: any) => m.content === '这条消息不该丢')).toBe(true);
  });
});
