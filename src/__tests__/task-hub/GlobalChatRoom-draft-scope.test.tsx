// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { useTaskHubStore } from '@/store/taskHubStore';

vi.mock('@/hooks/useAutoScroll', () => ({ useAutoScroll: () => {} }));
vi.mock('@/components/task-hub/MessageGroup', () => ({ MessageGroup: () => null }));
vi.mock('@/components/task-hub/ChatFilterBar', () => ({ ChatFilterBar: () => null }));
vi.mock('@/components/task-hub/AgentMentionPopup', () => ({ AgentMentionPopup: () => null }));
vi.mock('@/components/task-hub/A2APossessionStrip', () => ({ A2APossessionStrip: () => null }));
vi.mock('@/components/ui/EmojiPickerButton', () => ({ EmojiPickerButton: () => null }));

const stamp = '2026-07-26T00:00:00.000Z';
const conversations = [
  {
    id: 'project-a',
    title: 'Project A',
    goal: '',
    status: 'active' as const,
    priority: 'p1' as const,
    projectPath: 'C:/project-a',
    breakdownStatus: 'none' as const,
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: 'project-b',
    title: 'Project B',
    goal: '',
    status: 'active' as const,
    priority: 'p1' as const,
    projectPath: 'C:/project-b',
    breakdownStatus: 'none' as const,
    createdAt: stamp,
    updatedAt: stamp,
  },
];

describe('GlobalChatRoom draft scope', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      conversations,
      selectedConversationId: 'project-a',
      selectedProjectId: 'project-a',
      chatMessagesByConversation: {},
      pendingDispatches: {},
      runtimeRefreshInProgress: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps an A draft visible but cannot submit it after selection changes to B or empty', () => {
    render(<GlobalChatRoom />);
    const input = screen.getByRole('textbox', { name: '消息输入' }) as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'command for project A', selectionStart: 21 } });

    act(() => {
      useTaskHubStore.setState({
        selectedConversationId: 'project-b',
        selectedProjectId: 'project-b',
      });
    });

    expect(input.value).toBe('command for project A');
    expect(document.activeElement).toBe(input);
    expect((screen.getByTitle('草稿属于先前项目，请切回原项目或清空后重写') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useTaskHubStore.getState().chatMessagesByConversation['project-b']).toBeUndefined();

    act(() => {
      useTaskHubStore.setState({
        selectedConversationId: null,
        selectedProjectId: 'default',
      });
    });
    expect(input.value).toBe('command for project A');
    expect((screen.getByTitle('草稿属于先前项目，请切回原项目或清空后重写') as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      useTaskHubStore.setState({
        selectedConversationId: 'project-a',
        selectedProjectId: 'project-a',
      });
    });
    expect((screen.getByTitle('发送消息') as HTMLButtonElement).disabled).toBe(false);
  });
});
