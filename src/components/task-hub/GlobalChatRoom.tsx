'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { useTaskHubStore, type ChatMessage } from '@/store/taskHubStore';
import type { Agent } from '@/store/agentStore';
import { ChatMessageItem } from './ChatMessageItem';
import { MessageGroup } from './MessageGroup';
import { ChatFilterBar, type ChatFilter } from './ChatFilterBar';
import { AgentMentionPopup } from './AgentMentionPopup';
import { A2APossessionStrip } from './A2APossessionStrip';
import { EmojiPickerButton } from '@/components/ui/EmojiPickerButton';
import { Send, Hash, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { EmptyState } from '@/components/ui/EmptyState';
import { extractTaskReference } from '@/lib/taskReference';
import { createHumanCommandIdempotencyKey } from '@/lib/human-command/types';

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
  const [inputValue, setInputValue] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendInProgress, setSendInProgress] = useState(false);
  const [draftConversationId, setDraftConversationId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChatFilter>({ intent: null, agentId: null, userOnly: false, search: '' });
  const [mentionOpen, setMentionOpen] = useState(false);
  const ime = useIMEGuard();
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionFiltered, setMentionFiltered] = useState<Agent[]>([]);
  const [cursorPos, setCursorPos] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionOpenRef = useRef(false);
  const pendingCommandRef = useRef<{ idempotencyKey: string; issuedAt: string } | null>(null);

  useEffect(() => {
    mentionOpenRef.current = mentionOpen;
  }, [mentionOpen]);

  // Auto-scroll: follows new content when at bottom, ignores when user scrolled up
  useAutoScroll(scrollRef);

  // Quote event listener
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      pendingCommandRef.current = null;
      setInputValue(`> ${detail}\n\n`);
      setDraftConversationId(selectedConversationId);
    };
    window.addEventListener('chat:quote', handler);
    return () => window.removeEventListener('chat:quote', handler);
  }, [selectedConversationId]);

  const draftTargetMismatch = Boolean(inputValue.trim())
    && draftConversationId !== selectedConversationId;

  const handleSend = async () => {
    if (
      !selectedConversationId
      || !inputValue.trim()
      || runtimeRefreshInProgress
      || draftTargetMismatch
      || sendInProgress
    ) return;

    const referencedTaskId = extractTaskReference(inputValue);
    const content = inputValue;
    const pendingCommand = pendingCommandRef.current ?? {
      idempotencyKey: createHumanCommandIdempotencyKey(selectedConversationId),
      issuedAt: new Date().toISOString(),
    };
    pendingCommandRef.current = pendingCommand;
    setSendError(null);
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
        setSendError(result.error);
        return;
      }
      pendingCommandRef.current = null;
      setInputValue('');
      setDraftConversationId(null);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '命令提交失败，请稍后重试');
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
    pendingCommandRef.current = null;
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
    pendingCommandRef.current = null;
    if (!inputValue.trim()) setDraftConversationId(selectedConversationId);
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

  const AGENT_META: Record<string, { emoji: string; name: string; color: string }> = {
    mario:  { emoji: '⭐', name: 'Mario',       color: 'border-red-500/40' },
    luigi:  { emoji: '⚡', name: 'Luigi',       color: 'border-green-500/40' },
    toad:   { emoji: '🛡️', name: 'Toad',       color: 'border-amber-300/40' },
    peach:  { emoji: '🌸', name: 'Peach',       color: 'border-pink-500/40' },
    dk:     { emoji: '⚙️', name: 'Donkey Kong', color: 'border-amber-700/40' },
    yoshi:  { emoji: '🎵', name: 'Yoshi',       color: 'border-green-400/40' },
    system: { emoji: '⚙️', name: '系统', color: 'border-violet-500/40' },
    human:  { emoji: '👤', name: '用户', color: 'border-[hsl(var(--agent-owner))]/40' },
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

      {/* Message List */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-6 scrollbar-thin scroll-smooth"
        style={{ backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 0)', backgroundSize: '16px 16px' }}
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
              pendingCommandRef.current = null;
              setInputValue(value);
              setDraftConversationId(selectedConversationId);
              setSendError(null);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          />
        )}
        {(() => {
          const groups: { agentId: string; messages: ChatMessage[] }[] = [];
          const msgs = filteredMessages;
          for (const msg of msgs) {
            const lastGroup = groups[groups.length - 1];
            if (lastGroup && lastGroup.agentId === msg.agentId) {
              lastGroup.messages.push(msg);
            } else {
              groups.push({ agentId: msg.agentId, messages: [msg] });
            }
          }

          let lastDate = '';
          return groups.map((group) => {
            const groupDate = new Date(group.messages[0].timestamp).toDateString();
            const showDateSep = groupDate !== lastDate;
            lastDate = groupDate;

            const meta = AGENT_META[group.agentId] || { emoji: '?', name: group.agentId, color: 'border-zinc-500/40' };
            const isHuman = group.agentId === 'human';

            return (
              <div key={group.messages[0].id}>
                {showDateSep && (
                  <div className="text-center my-3">
                    <span className="text-[9px] text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-card))] px-3 py-0.5 rounded-full border border-[hsl(var(--border-subtle))]">
                      ── {formatDateSeparator(group.messages[0].timestamp)} ──
                    </span>
                  </div>
                )}
                {isHuman ? (
                  group.messages.map((msg) => (
                    <ChatMessageItem key={msg.id} message={msg} />
                  ))
                ) : (
                  <MessageGroup
                    messages={group.messages}
                    themeColor={meta.color}
                    agentEmoji={meta.emoji}
                    agentName={meta.name}
                    defaultExpanded={false}
                    forceExpand={group.messages.some(m => m.isStreaming)}
                  />
                )}
              </div>
            );
          });
        })()}
      </div>

      {/* Input Area */}
      <div className={cn(
        'shrink-0 p-4 bg-[hsl(var(--bg-card))]',
        variant === 'standalone' ? 'border-t-[2px] border-[hsl(var(--border))] shadow-[0_-4px_12px_rgba(0,0,0,0.02)]' : 'border-t border-[hsl(var(--border-subtle))]',
      )}>
        <div className="relative flex items-end gap-2">
          {mentionOpen && (
            <AgentMentionPopup
              inputValue={inputValue}
              cursorPosition={cursorPos}
              selectedIndex={mentionSelectedIndex}
              onSelect={handleMentionSelect}
              onClose={() => setMentionOpen(false)}
            />
          )}
          <label htmlFor="chat-input" className="sr-only">向团队补充要求</label>
          <textarea
            id="chat-input"
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              const wasEmpty = !inputValue.trim();
              const isEmpty = !e.target.value.trim();
              pendingCommandRef.current = null;
              setSendError(null);
              setInputValue(e.target.value);
              if (isEmpty) setDraftConversationId(null);
              else if (wasEmpty) setDraftConversationId(selectedConversationId);
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
              'w-full bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] text-[13px] placeholder:text-[hsl(var(--text-tertiary))]',
              'rounded-[4px] border-[2px] border-[hsl(var(--border))] px-3 py-2.5',
              'focus:outline-none focus:border-[hsl(var(--accent))] focus:ring-0',
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
            disabled={!selectedConversationId || !inputValue.trim() || runtimeRefreshInProgress || draftTargetMismatch || sendInProgress}
            title={
              !selectedConversationId
                ? '请先选择或新建一个交付'
                : sendInProgress
                ? '正在提交要求…'
                : draftTargetMismatch
                ? '草稿属于先前项目，请切回原项目或清空后重写'
                : runtimeRefreshInProgress
                  ? '运行配置刷新完成后即可发送'
                  : '发送消息'
            }
            className={cn(
              'shrink-0 flex items-center justify-center w-11 h-11 rounded-[4px] transition-all',
              'bg-[hsl(var(--accent))] text-[hsl(var(--bg-app))]',
              'border-[2px] border-[hsl(var(--accent-border, var(--accent)))]',
              'shadow-[2px_2px_0px_hsl(var(--text-primary))]',
              'hover:brightness-110 active:translate-y-[2px] active:translate-x-[2px] active:shadow-none',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-[2px] disabled:translate-x-[2px]'
            )}
          >
            <Send className="w-5 h-5 ml-1" />
          </button>
        </div>
        <p className="text-[9px] font-medium text-[hsl(var(--text-tertiary))] mt-2 ml-1">
          {!selectedConversationId
            ? '请先选择或新建一个交付，再向团队补充要求'
            : draftTargetMismatch
            ? '草稿属于先前项目，请切回原项目或清空后重写'
            : sendInProgress
              ? '正在提交要求，服务端确认后会显示在活动流中'
            : runtimeRefreshInProgress
              ? '正在刷新运行配置，草稿会保留，刷新完成后即可发送'
              : '使用 #TASK-000 引用任务 · 未指定负责人时由团队自动接手'}
        </p>
        {sendError && <p role="alert" className="mt-2 ml-1 text-[10px] text-red-600">{sendError}</p>}
      </div>
    </div>
  );
}
