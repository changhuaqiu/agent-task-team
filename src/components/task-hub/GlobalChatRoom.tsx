'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { FocusedMessage } from '@/components/project/FocusedMessage';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { Agent } from '@/store/agentStore';
import { ChatMessageItem } from './ChatMessageItem';
import { ChatActivityNotice } from './ChatActivityNotice';
import { projectChatTimeline } from './chatTimelineProjection';
import { ChatFilterBar, type ChatFilter } from './ChatFilterBar';
import { AgentMentionPopup } from './AgentMentionPopup';
import { EmojiPickerButton } from '@/components/ui/EmojiPickerButton';
import { ArrowUp, AtSign, ChevronDown, CornerUpLeft, Hash, LoaderCircle, Shield, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { EmptyState } from '@/components/ui/EmptyState';
import { extractTaskReference } from '@/lib/taskReference';
import { createWorkspaceCommandIdempotencyKey } from '@/lib/workspace-command';
import { useDeliveryRequirementDraft } from '@/hooks/useDeliveryRequirementDraft';

export const INITIAL_TIMELINE_ITEM_LIMIT = 120;
const EMPTY_CHAT_FILTER: ChatFilter = { intent: null, agentId: null, userOnly: false, search: '' };

type ChatQuoteTarget = {
  id: string;
  rootId: string;
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

export function GlobalChatRoom({ variant = 'standalone', focusMessageId }: { variant?: 'standalone' | 'embedded'; focusMessageId?: string }) {
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
  const [filterState, setFilterState] = useState<{
    conversationId: string | null;
    value: ChatFilter;
  }>({ conversationId: selectedConversationId, value: EMPTY_CHAT_FILTER });
  const [mentionOpen, setMentionOpen] = useState(false);
  const ime = useIMEGuard();
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionFiltered, setMentionFiltered] = useState<Agent[]>([]);
  const [mentionConversationId, setMentionConversationId] = useState<string | null>(null);
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
  const filter = chatMessages.length >= 20 && filterState.conversationId === selectedConversationId
    ? filterState.value
    : EMPTY_CHAT_FILTER;
  const handleFilterChange = useCallback((value: ChatFilter) => {
    setFilterState({ conversationId: selectedConversationId, value });
  }, [selectedConversationId]);
  const roster = useTaskHubStore((state) => state.getEffectiveRoster());
  const addressedAgents = useMemo(() => {
    const ids = new Set(
      Array.from(inputValue.matchAll(/@([\w\u4e00-\u9fff-]+)(?=\s|$)/g), (match) => match[1].toLowerCase()),
    );
    return roster.filter((agent) => ids.has(agent.id.toLowerCase()));
  }, [inputValue, roster]);
  const mentionIsCurrentConversation = mentionOpen
    && mentionConversationId === selectedConversationId;

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
          rootId: typeof candidate.rootId === 'string' && candidate.rootId ? candidate.rootId : candidate.id!,
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

    const content = inputValue.trim();
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
        metadata: quoteTarget ? {
          replyToMessageId: quoteTarget.id,
          threadRootId: quoteTarget.rootId,
          replyAuthor: quoteTarget.author,
          replyPreview: quoteExcerpt(quoteTarget.content),
        } : undefined,
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
    const atMatch = textBefore.match(/@[\w\u4e00-\u9fff-]*$/);
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

  const openMentionPicker = () => {
    if (!selectedConversationId || sendInProgress) return;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? inputValue.length;
    const end = textarea?.selectionEnd ?? start;
    const textBefore = inputValue.slice(0, start);
    const hasOpenMention = /@[\w\u4e00-\u9fff-]*$/.test(textBefore);
    const nextValue = hasOpenMention
      ? inputValue
      : `${inputValue.slice(0, start)}@${inputValue.slice(end)}`;
    const nextCursor = hasOpenMention ? start : start + 1;
    const store = useTaskHubStore.getState();
    const activeAgents = store.getAddressableRoster();

    if (!hasOpenMention) {
      pendingCommandsRef.current.delete(selectedConversationId);
      setInputValue(nextValue);
    }
    setCursorPos(nextCursor);
    setMentionFiltered(activeAgents);
    setMentionSelectedIndex(0);
    setMentionConversationId(selectedConversationId);
    setMentionOpen(activeAgents.length > 0);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
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

      {focusMessageId && selectedConversationId && <FocusedMessage key={`${selectedConversationId}:${focusMessageId}`} messageId={focusMessageId} conversationId={selectedConversationId} />}
      {/* Stable activity timeline */}
      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto bg-[hsl(var(--bg-card))] px-4 py-3 scrollbar-thin scroll-smooth sm:px-6"
      >
        {chatMessages.length >= 20 && (
          <ChatFilterBar
            key={selectedConversationId ?? 'no-conversation'}
            onFilterChange={handleFilterChange}
            messageCount={chatMessages.length}
          />
        )}
        {!selectedConversationId && chatMessages.length === 0 && (
          <EmptyState
            icon={Shield}
            title="项目协作"
            description="选择或添加一个项目后，可在这里向团队提出目标。"
          />
        )}
        {selectedConversationId && chatMessages.length === 0 && (
          <EmptyState
            icon={Hash}
            title="开始项目协作"
            description="直接描述目标或提及 Agent；工作、评审和产物会作为正式事实回到这里。"
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
                  <div className="my-4 flex items-center gap-3" aria-label={formatDateSeparator(firstMessage.timestamp)}>
                    <span className="h-px flex-1 bg-[hsl(var(--border-subtle))]" />
                    <span className="text-[10px] font-medium text-[hsl(var(--text-tertiary))]">
                      {formatDateSeparator(firstMessage.timestamp)}
                    </span>
                    <span className="h-px flex-1 bg-[hsl(var(--border-subtle))]" />
                  </div>
                )}
                {item.kind === 'activity' ? (
                  <ChatActivityNotice message={item.message} repeatCount={item.repeatCount} />
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

      {/* Project-scoped conversation composer */}
      <div className={cn(
        'shrink-0 bg-[hsl(var(--bg-card))] px-4 pb-4 pt-2 sm:px-6',
        variant === 'standalone' && 'border-t border-[hsl(var(--border-subtle))]',
      )}>
        <div className="relative mx-auto max-w-4xl rounded-[18px] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] shadow-[0_1px_3px_rgba(15,23,42,0.08)] transition-[border-color,box-shadow] focus-within:border-[hsl(var(--border))] focus-within:shadow-[0_2px_8px_rgba(15,23,42,0.10)]">
          {mentionIsCurrentConversation && (
            <AgentMentionPopup
              inputValue={inputValue}
              cursorPosition={cursorPos}
              selectedIndex={mentionSelectedIndex}
              onSelect={handleMentionSelect}
              onClose={() => setMentionOpen(false)}
            />
          )}
          {quoteTarget && (
            <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg bg-[hsl(var(--bg-muted))] px-3 py-2" data-testid="chat-quote-preview">
              <span className="h-8 w-0.5 shrink-0 rounded-full bg-[hsl(var(--accent))]" />
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
          <label htmlFor="chat-input" className="sr-only">发消息给团队</label>
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
              setMentionConversationId(hasAt ? selectedConversationId : null);
              setMentionOpen(hasAt);
              if (hasAt && atMatch) {
                const query = atMatch[1].toLowerCase();
                const store = useTaskHubStore.getState();
                const activeAgents = store.getAddressableRoster();
                const filtered = activeAgents.filter((agent) => (
                  agent.name.toLowerCase().includes(query) || agent.id.toLowerCase().includes(query)
                ));
                setMentionFiltered(filtered);
                setMentionSelectedIndex(0);
              }
            }}
            onKeyDown={(e) => {
              if (ime.isComposing()) return;
              const hasMentionCandidates = mentionOpenRef.current
                && mentionConversationId === selectedConversationId
                && mentionFiltered.length > 0;
              const selectsMention = (e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab';
              if (hasMentionCandidates && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || selectsMention)) {
                e.preventDefault();
                e.stopPropagation();
                if (selectsMention) {
                  const agent = mentionFiltered[mentionSelectedIndex];
                  if (agent) handleMentionSelect(agent.id);
                } else if (e.key === 'ArrowDown') {
                  setMentionSelectedIndex((i) => (i + 1) % mentionFiltered.length);
                } else if (e.key === 'ArrowUp') {
                  setMentionSelectedIndex((i) => (i - 1 + mentionFiltered.length) % mentionFiltered.length);
                }
                return;
              }
              if (mentionOpenRef.current
                && mentionConversationId === selectedConversationId
                && e.key === 'Escape') {
                e.preventDefault();
                setMentionOpen(false);
                return;
              }
              handleKeyDown(e);
            }}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onSelect={(event) => setCursorPos(event.currentTarget.selectionStart ?? inputValue.length)}
            placeholder={selectedConversationId ? '发消息给团队…' : '先选择一个项目'}
            disabled={!selectedConversationId || sendInProgress}
            rows={1}

            className={cn(
              'w-full border-0 bg-transparent px-4 pb-2 pt-3 text-[13px] leading-5 text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))]',
              'focus:outline-none focus:ring-0',
              'resize-none scrollbar-thin overflow-y-auto min-h-[48px] max-h-[160px]'
            )}
            style={{
              height: inputValue ? `${Math.min(160, Math.max(48, inputValue.split('\n').length * 20 + 28))}px` : '48px'
            }}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={openMentionPicker}
                disabled={!selectedConversationId || sendInProgress}
                aria-label={addressedAgents.length > 0
                  ? `已触达 ${addressedAgents.map((agent) => agent.name).join('、')}，继续添加 Agent`
                  : '提及 Agent'}
                title={addressedAgents.length > 0
                  ? `发送给 ${addressedAgents.map((agent) => agent.name).join('、')}`
                  : '提及 Agent'}
                className="flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-1.5 text-[hsl(var(--text-tertiary))] transition-colors hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] disabled:pointer-events-none disabled:opacity-40"
              >
                <AtSign className="size-[18px]" />
                {addressedAgents.slice(0, 3).map((agent) => (
                  <span
                    key={agent.id}
                    className="flex size-5 items-center justify-center rounded-full bg-[hsl(var(--bg-muted))] text-[11px]"
                    aria-hidden="true"
                  >
                    {agent.emoji}
                  </span>
                ))}
                {addressedAgents.length > 3 && (
                  <span className="pr-0.5 text-[9px] font-medium" aria-hidden="true">+{addressedAgents.length - 3}</span>
                )}
              </button>
              <EmojiPickerButton
                onEmojiSelect={handleEmojiInsert}
                placement="top-start"
                disabled={!selectedConversationId || sendInProgress}
                className="[&_button]:size-8 [&_button]:rounded-lg"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!selectedConversationId || !inputValue.trim() || runtimeRefreshInProgress || sendInProgress}
              title={
                !selectedConversationId
                  ? '请先选择或添加一个项目'
                  : sendInProgress
                    ? '正在发送…'
                    : runtimeRefreshInProgress
                      ? '正在准备 Agent，请稍候'
                      : '发送消息'
              }
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] transition-[opacity,transform,background-color]',
                'hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:bg-[hsl(var(--bg-muted))] disabled:text-[hsl(var(--text-tertiary))] disabled:opacity-100'
              )}
            >
              {sendInProgress
                ? <LoaderCircle className="size-4 animate-spin" />
                : <ArrowUp className="size-4" strokeWidth={2.4} />}
            </button>
          </div>
        </div>
        {sendError && <p role="alert" className="mx-auto mt-2 max-w-4xl px-2 text-[10px] text-red-600">{sendError}</p>}
      </div>
    </div>
  );
}
