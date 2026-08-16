// Superseding regression for issue #38: an unscoped human message must not be
// attached to an arbitrary existing delivery. The UI requires explicit scope.

import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('issue #38 superseded — activity submission requires an explicit delivery', () => {
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

  it('does not auto-select the first conversation or persist an unscoped message', async () => {
    // Seed one conversation but leave nothing selected.
    useTaskHubStore.setState({
      conversations: [
        { id: 'conv-1', title: '现有项目', createdAt: '', updatedAt: '' } as any,
      ],
      selectedConversationId: null,
      chatMessagesByConversation: {},
    });

    const result = await useTaskHubStore.getState().addChatMessage({
      agentId: 'human',
      content: '这条消息不该丢',
    });

    const state = useTaskHubStore.getState();
    expect(result).toEqual({ ok: false, error: '请先选择或新建一个交付' });
    expect(state.selectedConversationId).toBeNull();
    expect(state.chatMessagesByConversation['conv-1']).toBeUndefined();
  });
});
