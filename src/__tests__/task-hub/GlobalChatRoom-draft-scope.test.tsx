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
      runtimeRefreshInProgress: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps an A draft visible but cannot submit it after selection changes to B or empty', () => {
    render(<GlobalChatRoom />);
    const input = screen.getByRole('textbox', { name: '向团队补充要求' }) as HTMLTextAreaElement;
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
    expect((screen.getByTitle('请先选择或新建一个交付') as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      useTaskHubStore.setState({
        selectedConversationId: 'project-a',
        selectedProjectId: 'project-a',
      });
    });
    expect((screen.getByTitle('发送消息') as HTMLButtonElement).disabled).toBe(false);
  });

  it('cannot submit to an arbitrary existing delivery when none is selected', async () => {
    useTaskHubStore.setState({ selectedConversationId: null, selectedProjectId: 'default' });
    render(<GlobalChatRoom />);

    const input = screen.getByRole('textbox', { name: '向团队补充要求' }) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect((screen.getByTitle('请先选择或新建一个交付') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      await useTaskHubStore.getState().addChatMessage({ agentId: 'human', content: 'must stay unscoped' });
    });
    expect(useTaskHubStore.getState().selectedConversationId).toBeNull();
    expect(useTaskHubStore.getState().chatMessagesByConversation).toEqual({});
  });

  it('does not create a bare delivery from the activity input', async () => {
    useTaskHubStore.setState({ conversations: [], selectedConversationId: null, selectedProjectId: 'default' });
    render(<GlobalChatRoom />);

    await act(async () => {
      await useTaskHubStore.getState().addChatMessage({ agentId: 'human', content: 'must use the delivery dialog' });
    });
    expect(useTaskHubStore.getState().conversations).toEqual([]);
    expect(screen.getByText('选择或新建一个交付后，可在这里向团队补充要求。')).toBeDefined();
  });

  it('fills a selected delivery draft from an empty-state suggestion', () => {
    render(<GlobalChatRoom />);
    fireEvent.click(screen.getByRole('button', { name: '补充背景…' }));
    expect((screen.getByRole('textbox', { name: '向团队补充要求' }) as HTMLTextAreaElement).value)
      .toBe('补充背景：');
  });

  it('projects the authoritative message and clears the draft after an accepted receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          receipt: {
            idempotencyKey: command.idempotencyKey,
            commandType: command.type,
            projectPath: command.projectPath,
            deliveryId: command.deliveryId,
            status: 'accepted',
            duplicate: false,
            messageId: 'message-authoritative-1',
            targetAgentIds: ['mario'],
            recordedAt: stamp,
          },
        }),
      } as Response;
    }));
    render(<GlobalChatRoom />);
    const input = screen.getByRole('textbox', { name: '向团队补充要求' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '继续处理', selectionStart: 4 } });
    fireEvent.click(screen.getByTitle('发送消息'));

    await act(async () => { await Promise.resolve(); });
    expect(input.value).toBe('');
    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a'])
      .toContainEqual(expect.objectContaining({
        id: 'message-authoritative-1',
        content: '继续处理',
        agentId: 'human',
      }));
  });

  it('surfaces a server-owned no-recipient receipt and retains the draft', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body));
      return {
        ok: false,
        status: 409,
        json: async () => ({
          receipt: {
            idempotencyKey: command.idempotencyKey,
            commandType: command.type,
            projectPath: command.projectPath,
            deliveryId: command.deliveryId,
            status: 'rejected',
            duplicate: false,
            targetAgentIds: [],
            reasonCode: 'a2a_no_available_agent',
            userMessage: '当前交付没有可接手要求的团队成员',
            recordedAt: stamp,
          },
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);
    render(<GlobalChatRoom />);
    const input = screen.getByRole('textbox', { name: '向团队补充要求' });
    fireEvent.change(input, { target: { value: '继续处理', selectionStart: 4 } });
    fireEvent.click(screen.getByTitle('发送消息'));

    expect((await screen.findByRole('alert')).textContent)
      .toContain('当前交付没有可接手要求的团队成员');
    expect((screen.getByRole('textbox', { name: '向团队补充要求' }) as HTMLTextAreaElement).value)
      .toBe('继续处理');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('发送消息'));
    await screen.findByRole('alert');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstCommand = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    const retryCommand = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body));
    expect(retryCommand.idempotencyKey).toBe(firstCommand.idempotencyKey);
    expect(retryCommand.issuedAt).toBe(firstCommand.issuedAt);
  });
});
