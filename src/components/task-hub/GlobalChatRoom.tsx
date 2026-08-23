'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { Agent } from '@/store/agentStore';
import { ChatMessageItem } from './ChatMessageItem';
import { ChatActivityNotice } from './ChatActivityNotice';
import { projectChatTimeline } from './chatTimelineProjection';
import { ChatFilterBar, type ChatFilter } from './ChatFilterBar';
import { AgentMentionPopup } from './AgentMentionPopup';
import { A2APossessionStrip } from './A2APossessionStrip';
import { EmojiPickerButton } from '@/components/ui/EmojiPickerButton';
import { ChevronDown, CornerUpLeft, Hash, Send, Shield, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { EmptyState } from '@/components/ui/EmptyState';
import { extractTaskReference } from '@/lib/taskReference';
import { createWorkspaceCommandIdempotencyKey } from '@/lib/workspace-command';
import { useDeliveryRequirementDraft } from '@/hooks/useDeliveryRequirementDraft';

export const INITIAL_TIMELINE_ITEM_LIMIT = 120;

type ChatQuoteTarget = {
  id: string;
  author: string;
  content: string;
};

function quoteExcerpt(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function GlobalChatRoom({ variant = 'standalone' }: { variant?: 'standalone' | 'embedded' }) {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const chatMessages = useTaskHubStore((s) => s.getChatMessagesForSelectedConversation());
  const addChatMessage = useTaskHubStore((s) => s.addChatMessage);
  const runtimeRefreshInProgress = useTaskHubStore((s) => s.runtimeRefreshInProgress);
  const messageHistory = useTaskHubStore((s) => selectedConversationId
    ? s.messageHistoryByConversation[selectedConversationId]
    : undefined);
  const loadOlderConversationMessages = useTaskHubStore((s) => s.loadOlderConversationMessages);
  const { value: inputValue, setValue: setInputValue, clear: clearInputValue } = useDeliveryRequirementDraft(selectedConversationId);
  const [sendErrorState, setSendErrorState] = useState<{ conversationId: string; message: string }>();
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [sendInProgress, setSendInProgress] = useState(false);
  const [quoteTargets, setQuoteTargets] = useState<Record<string, ChatQuoteTarget>>({});
  const [readTimeline, setReadTimeline] = useState({
    conversationId: selectedConversationId,
    count: chatMessages.length,
  });
  const [filter, setFilter] = useState<ChatFilter>({ intent: null, agentId: null, userOnly: false, search: '' });
  const [mentionOpen, setMentionOpen] = useState(false);
  const ime = useIMEGuard();
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionFiltered, setMentionFiltered] = useState<Agent[]>([]);
  const [cursorPos, setCursorPos] = useState(0);
  const [timelineWindow, setTimelineWindow] = useState({
    conversationId: selectedConversationId,
    count: INITIAL_TIMELINE_ITEM_LIMIT,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionOpenRef = useRef(false);
  const pendingCommandsRef = useRef(new Map<string, { idempotencyKey: string; issuedAt: string }>());
  const quoteTarget = selectedConversationId ? quoteTargets[selectedConversationId] : undefined;
  const sendError = sendErrorState?.conversationId === selectedConversationId
    ? sendErrorState.message
    : undefined;

  useEffect(() => {
    mentionOpenRef.current = mentionOpen;
  }, [mentionOpen]);

  // Auto-scroll: follows new content when at bottom, ignores when user scrolled up
  const markTimelineRead = useCallback(() => {
    setReadTimeline((current) => {
      if (current.conversationId === selectedConversationId && current.count === chatMessages.length) return current;
      return { conversationId: selectedConversationId, count: chatMessages.length };
    });
  }, [chatMessages.length, selectedConversationId]);
  const { isAtBottom, scrollToBottom } = useAutoScroll(scrollRef, {
    scopeKey: selectedConversationId,
    onAtBottom: markTimelineRead,
  });
  const newActivityCount = readTimeline.conversationId === selectedConversationId
    ? Math.max(0, chatMessages.length - readTimeline.count)
    : 0;

  // Quote event listener
  useEffect(() => {
    const handler = (e: Event) => {
      if (!selectedConversationId) return;
      const detail: unknown = (e as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;
      const candidate = detail as Partial<ChatQuoteTarget>;
      if (typeof candidate.id !== 'string' || typeof candidate.content !== 'string') return;
      pendingCommandsRef.current.delete(selectedConversationId);
      setQuoteTargets((current) => ({
        ...current,
        [selectedConversationId]: {
          id: candidate.id!,
          author: typeof candidate.author === 'string' && candidate.author ? candidate.author : '团队成员',
          content: candidate.content!,
        },
      }));
      setSendErrorState(undefined);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener('chat:quote', handler);
    return () => window.removeEventListener('chat:quote', handler);
  }, [selectedConversationId]);

  const handleSend = async () => {
    if (
      !selectedConversationId
      || !inputValue.trim()
      || runtimeRefreshInProgress
      || sendInProgress
    ) return;

    const content = quoteTarget
      ? `> 引用 ${quoteTarget.author}：${quoteExcerpt(quoteTarget.content)}\n\n${inputValue.trim()}`
      : inputValue;
    const referencedTaskId = extractTaskReference(content);
    const pendingCommand = pendingCommandsRef.current.get(selectedConversationId) ?? {
      idempotencyKey: createWorkspaceCommandIdempotencyKey(selectedConversationId),
      issuedAt: new Date().toISOString(),
    };
    pendingCommandsRef.current.set(selectedConversationId, pendingCommand);
    setSendErrorState(undefined);
    setSendInProgress(true);

    try {
      const result = await addChatMessage({
        agentId: 'human',
        content,
        referencedTaskId,
        conversationId: selectedConversationId,
        commandIdempotencyKey: pendingCommand.idempotencyKey,
        commandIssuedAt: pendingCommand.issuedAt,
      });
      if (!result.ok) {
        setSendErrorState({ conversationId: selectedConversationId, message: result.error });
        return;
      }
      pendingCommandsRef.current.delete(selectedConversationId);
      clearInputValue();
      setQuoteTargets((current) => {
        const remaining = { ...current };
        delete remaining[selectedConversationId];
        return remaining;
      });
      scrollToBottom();
    } catch (error) {
      setSendErrorState({
        conversationId: selectedConversationId,
        message: error instanceof Error ? error.message : '命令提交失败，请稍后重试',
      });
    } finally {
      setSendInProgress(false);
    }
  };

  const handleMentionSelect = (agentId: string) => {
    const textBefore = inputValue.slice(0, cursorPos);
    const atMatch = textBefore.match(/@\w*$/);
    if (!atMatch) return;
    const atStart = textBefore.lastIndexOf('@');
    const before = inputValue.slice(0, atStart);
    const after = inputValue.slice(cursorPos);
    const newValue = `${before}@${agentId} ${after}`;
    if (selectedConversationId) pendingCommandsRef.current.delete(selectedConversationId);
    setInputValue(newValue);
    setMentionOpen(false);
    // Focus back to textarea
    requestAnimationFrame(() => {
      const pos = atStart + agentId.length + 2; // @agentId + space
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const handleEmojiInsert = useCallback((emoji: string) => {
    if (selectedConversationId) pendingCommandsRef.current.delete(selectedConversationId);
    const textarea = textareaRef.current;
    if (!textarea) {
      setInputValue((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart ?? inputValue.length;
    const end = textarea.selectionEnd ?? start;
    const next = inputValue.slice(0, start) + emoji + inputValue.slice(end);
    setInputValue(next);
    requestAnimationFrame(() => {
      const pos = start + emoji.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  }, [inputValue, selectedConversationId, setInputValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !ime.isComposing()) {
      e.preventDefault();
      void handleSend();
    }
  };

  const filteredMessages = useMemo(() => {
    let msgs = chatMessages;
    if (filter.intent) msgs = msgs.filter(m => m.intent === filter.intent);
    if (filter.agentId) msgs = msgs.filter(m => m.agentId === filter.agentId);
    if (filter.userOnly) msgs = msgs.filter(m => m.agentId === 'human');
    if (filter.search) {
      const q = filter.search.toLowerCase();
      msgs = msgs.filter(m => m.content.toLowerCase().includes(q));
    }
    return msgs;
  }, [chatMessages, filter]);
  const timelineItems = useMemo(() => projectChatTimeline(filteredMessages), [filteredMessages]);
  const visibleTimelineItemCount = timelineWindow.conversationId === selectedConversationId
    ? timelineWindow.count
    : INITIAL_TIMELINE_ITEM_LIMIT;
  const hiddenTimelineItemCount = Math.max(0, timelineItems.length - visibleTimelineItemCount);
  const visibleTimelineItems = useMemo(
    () => timelineItems.slice(-visibleTimelineItemCount),
    [timelineItems, visibleTimelineItemCount],
  );

  return (
    <div
      className={cn(
        'flex flex-col h-full min-h-0 bg-[hsl(var(--bg-app))] w-full',
        variant === 'standalone'
          ? 'border-l-[2px] border-[hsl(var(--border))] shadow-[-4px_0_12px_rgba(0,0,0,0.05)]'
          : ''
      )}
    >
      {/* Header — standalone only */}
      {variant === 'standalone' && (
        <div className="shrink-0 h-[60px] flex items-center justify-between px-5 bg-[hsl(var(--bg-card))] border-b-[2px] border-[hsl(var(--border))]">
          <h2 className="text-[14px] font-bold text-[hsl(var(--text-primary))] flex items-center gap-2">
            <Hash className="w-4 h-4 text-[hsl(var(--accent))]" />
            对话
          </h2>
          <span className="text-[10px] font-bold text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-muted))] px-2 py-1 rounded-[4px] border border-[hsl(var(--border-subtle))]">
            {chatMessages.length} 条消息
          </span>
        </div>
      )}

      {/* Stable activity timeline */}
      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-[hsl(var(--bg-muted))] px-4 py-3 scrollbar-thin scroll-smooth sm:px-6"
      >
        <ChatFilterBar
          onFilterChange={setFilter}
          messageCount={chatMessages.length}
        />
        <A2APossessionStrip />
        {!selectedConversationId && chatMessages.length === 0 && (
          <EmptyState
            icon={Shield}
            title="交付活动"
            description="选择或新建一个交付后，可在这里向团队补充要求。"
          />
        )}
        {selectedConversationId && chatMessages.length === 0 && (
          <EmptyState
            icon={Hash}
            title="等待团队活动"
            description="系统会在这里汇总关键讨论、工作变化和交接。你也可以补充要求。"
            actions={[
              { label: '补充背景…', value: '补充背景：' },
              { label: '调整验收标准…', value: '调整验收标准：' },
            ]}
            onAction={(value) => {
              if (selectedConversationId) pendingCommandsRef.current.delete(selectedConversationId);
              setInputValue(value);
              setSendErrorState(undefined);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          />
        )}
        {(hiddenTimelineItemCount > 0 || messageHistory?.hasMore) && (
          <button
            type="button"
            disabled={messageHistory?.isLoadingOlder}
            onClick={async () => {
              setHistoryLoadError(null);
              if (hiddenTimelineItemCount > 0) {
                setTimelineWindow({
                  conversationId: selectedConversationId,
                  count: visibleTimelineItemCount + INITIAL_TIMELINE_ITEM_LIMIT,
                });
                return;
              }
              if (!selectedConversationId || !messageHistory?.hasMore) return;
              try {
                await loadOlderConversationMessages(selectedConversationId);
                setTimelineWindow({
                  conversationId: selectedConversationId,
                  count: visibleTimelineItemCount + 500,
                });
              } catch (error) {
                setHistoryLoadError(error instanceof Error ? error.message : '更早活动加载失败');
              }
            }}
            className="self-center rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-3 py-1.5 text-[10px] font-semibold text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]"
          >
            {hiddenTimelineItemCount > 0
              ? `显示更早的 ${Math.min(INITIAL_TIMELINE_ITEM_LIMIT, hiddenTimelineItemCount)} 条活动`
              : messageHistory?.isLoadingOlder ? '正在加载更早活动…' : '加载更早活动'}
          </button>
        )}
        {historyLoadError && (
          <div className="self-center text-[10px] text-rose-600">{historyLoadError}</div>
        )}
        {(() => {
          return visibleTimelineItems.map((item, index) => {
            const firstMessage = item.kind === 'activity' ? item.message : item.messages[0];
            const groupDate = new Date(firstMessage.timestamp).toDateString();
            const previousItem = index > 0 ? visibleTimelineItems[index - 1] : undefined;
            const previousMessage = previousItem?.kind === 'activity'
              ? previousItem.message
              : previousItem?.messages[0];
            const previousDate = previousMessage
              ? new Date(previousMessage.timestamp).toDateString()
              : '';
            const showDateSep = groupDate !== previousDate;

            return (
              <div key={item.id}>
                {showDateSep && (
                  <div className="text-center my-3">
                    <span className="text-[9px] text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-card))] px-3 py-0.5 rounded-full border border-[hsl(var(--border-subtle))]">
                      ── {formatDateSeparator(firstMessage.timestamp)} ──
                    </span>
                  </div>
                )}
                {item.kind === 'activity' ? (
                  <ChatActivityNotice message={item.message} />
                ) : (
                  <ChatMessageItem
                    message={item.messages[0]}
                    responseSegments={item.messages}
                  />
                )}
              </div>
            );
          });
        })()}
      </div>
      {!isAtBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 right-5 inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-3 py-2 text-[11px] font-semibold text-[hsl(var(--text-secondary))] shadow-lg transition-colors hover:text-[hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]"
          aria-label={newActivityCount > 0 ? `回到最新，${newActivityCount} 条新活动` : '回到最新'}
        >
          <ChevronDown className="size-3.5" />
          {newActivityCount > 0 ? `${newActivityCount} 条新活动` : '回到最新'}
        </button>
      )}
      </div>

      {/* Delivery-scoped composer */}
      <div className={cn(
        'shrink-0 border-t border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-4 py-3 sm:px-6',
        variant === 'standalone' && 'shadow-[0_-4px_12px_rgba(0,0,0,0.02)]',
      )}>
        <div className="relative mx-auto max-w-4xl rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] shadow-sm focus-within:border-[hsl(var(--accent))] focus-within:ring-1 focus-within:ring-[hsl(var(--accent))]">
          {mentionOpen && (
            <AgentMentionPopup
              inputValue={inputValue}
              cursorPosition={cursorPos}
              selectedIndex={mentionSelectedIndex}
              onSelect={handleMentionSelect}
              onClose={() => setMentionOpen(false)}
            />
          )}
          {quoteTarget && (
            <div className="flex items-center gap-2 border-b border-[hsl(var(--border-subtle))] px-3 py-2" data-testid="chat-quote-preview">
              <CornerUpLeft className="size-3.5 shrink-0 text-[hsl(var(--accent))]" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold text-[hsl(var(--accent))]">引用回复 {quoteTarget.author}</div>
                <div className="truncate text-[10px] text-[hsl(var(--text-tertiary))]">{quoteExcerpt(quoteTarget.content)}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!selectedConversationId) return;
                  setQuoteTargets((current) => {
                    const remaining = { ...current };
                    delete remaining[selectedConversationId];
                    return remaining;
                  });
                }}
                className="rounded-full p-1 text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]"
                aria-label="取消引用回复"
                title="取消引用回复"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-1.5 px-2 py-1.5">
          <label htmlFor="chat-input" className="sr-only">向团队补充要求</label>
          <textarea
            id="chat-input"
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              if (selectedConversationId) pendingCommandsRef.current.delete(selectedConversationId);
              setSendErrorState(undefined);
              setInputValue(e.target.value);
              setCursorPos(e.target.selectionStart ?? e.target.value.length);
              const textBefore = e.target.value.slice(0, e.target.selectionStart ?? e.target.value.length);
              const atMatch = textBefore.match(/@([\w\u4e00-\u9fff-]*)$/);
              const hasAt = !!atMatch;
              setMentionOpen(hasAt);
              if (hasAt && atMatch) {
                const query = atMatch[1].toLowerCase();
                const store = useTaskHubStore.getState();
                const roster = store.getEffectiveRoster();
                const activeAgents = roster.filter((a) => store.activeAgentIds.includes(a.id));
                const filtered = activeAgents.filter((agent) => {
                  const roleCard = store.getAgentRoleCard(agent.id);
                  const displayName = roleCard?.displayName || '';
                  return (
                    agent.name.toLowerCase().includes(query) ||
                    agent.id.toLowerCase().includes(query) ||
                    displayName.toLowerCase().includes(query)
                  );
                });
                setMentionFiltered(filtered);
                setMentionSelectedIndex(0);
              }
            }}
            onKeyDown={(e) => {
              if (ime.isComposing()) return;
              if (mentionOpenRef.current && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape')) {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Tab') {
                  const agent = mentionFiltered[mentionSelectedIndex];
                  if (agent) handleMentionSelect(agent.id);
                } else if (e.key === 'Escape') {
                  setMentionOpen(false);
                } else if (e.key === 'ArrowDown') {
                  setMentionSelectedIndex((i) => (i + 1) % (mentionFiltered.length || 1));
                } else if (e.key === 'ArrowUp') {
                  setMentionSelectedIndex((i) => (i - 1 + (mentionFiltered.length || 1)) % (mentionFiltered.length || 1));
                }
                return;
              }
              handleKeyDown(e);
            }}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            placeholder="向团队补充要求…"
            disabled={!selectedConversationId || sendInProgress}
            rows={1}

            className={cn(
              'w-full border-0 bg-transparent px-2 py-2.5 text-[13px] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))]',
              'focus:outline-none focus:ring-0',
              'resize-none scrollbar-thin overflow-y-auto min-h-[44px] max-h-[120px]'
            )}
            style={{
              // Auto-grow hack approximation
              height: inputValue ? `${Math.min(120, Math.max(44, inputValue.split('\n').length * 20 + 24))}px` : '44px'
            }}
          />
          <EmojiPickerButton onEmojiSelect={handleEmojiInsert} placement="top-end" />
          <button
            onClick={() => void handleSend()}
            disabled={!selectedConversationId || !inputValue.trim() || runtimeRefreshInProgress || sendInProgress}
            title={
              !selectedConversationId
                ? '请先选择或新建一个交付'
                : sendInProgress
                ? '正在提交要求…'
                : runtimeRefreshInProgress
                  ? '运行配置刷新完成后即可发送'
                  : '发送消息'
            }
            className={cn(
              'mb-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--bg-app))] transition-colors',
              'hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-40'
            )}
          >
            <Send className="w-5 h-5 ml-1" />
          </button>
          </div>
        </div>
        <p className="mx-auto mt-1.5 max-w-4xl px-2 text-[9px] font-medium text-[hsl(var(--text-tertiary))]">
          {!selectedConversationId
            ? '请先选择或新建一个交付，再向团队补充要求'
            : sendInProgress
              ? '正在提交要求，服务端确认后会显示在活动流中'
            : runtimeRefreshInProgress
              ? '正在刷新运行配置，草稿会保留，刷新完成后即可发送'
              : '使用 #TASK-000 引用任务 · 未指定负责人时由团队自动接手'}
        </p>
        {sendError && <p role="alert" className="mx-auto mt-2 max-w-4xl px-2 text-[10px] text-red-600">{sendError}</p>}
      </div>
    </div>
  );
}
