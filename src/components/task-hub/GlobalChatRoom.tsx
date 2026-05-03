'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTaskHubStore, AGENT_ROSTER, type ChatMessage, type PendingDispatch } from '@/store/taskHubStore';
import { ChatMessageItem } from './ChatMessageItem';
import { MessageGroup } from './MessageGroup';
import { ChatFilterBar, type ChatFilter } from './ChatFilterBar';
import { AgentMentionPopup } from './AgentMentionPopup';
import { Send, Hash, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoScroll } from '@/hooks/useAutoScroll';

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
  const pendingDispatches = useTaskHubStore(useShallow((s) => s.pendingDispatches));
  const clearPendingDispatches = useTaskHubStore((s) => s.clearPendingDispatches);
  const forceSendDispatch = useTaskHubStore((s) => s.forceSendDispatch);
  const hasPending = Object.keys(pendingDispatches).some((k) => (pendingDispatches[k]?.length ?? 0) > 0);
  const [inputValue, setInputValue] = useState('');
  const [filter, setFilter] = useState<ChatFilter>({ intent: null, agentId: null, userOnly: false, search: '' });
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionFiltered, setMentionFiltered] = useState<typeof AGENT_ROSTER>([]);
  const [cursorPos, setCursorPos] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionOpenRef = useRef(false);
  mentionOpenRef.current = mentionOpen;

  // Auto-scroll: follows new content when at bottom, ignores when user scrolled up
  useAutoScroll(scrollRef);

  // Quote event listener
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setInputValue(`> ${detail}\n\n`);
    };
    window.addEventListener('chat:quote', handler);
    return () => window.removeEventListener('chat:quote', handler);
  }, []);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    // Basic regex to detect `#TASK-XXX` references
    const taskRefMatch = inputValue.match(/#TASK-\d{3}/i);

    addChatMessage({
      agentId: 'human',
      content: inputValue,
      referencedTaskId: taskRefMatch ? taskRefMatch[0].toUpperCase() : undefined,
      conversationId: selectedConversationId || undefined,
    });

    setInputValue('');
  };

  const handleMentionSelect = (agentId: string) => {
    const textBefore = inputValue.slice(0, cursorPos);
    const atMatch = textBefore.match(/@\w*$/);
    if (!atMatch) return;
    const atStart = textBefore.lastIndexOf('@');
    const before = inputValue.slice(0, atStart);
    const after = inputValue.slice(cursorPos);
    const newValue = `${before}@${agentId} ${after}`;
    setInputValue(newValue);
    setMentionOpen(false);
    // Focus back to textarea
    requestAnimationFrame(() => {
      const pos = atStart + agentId.length + 2; // @agentId + space
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
        'flex flex-col h-full bg-[hsl(var(--bg-app))] w-full',
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
        className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 scrollbar-thin scroll-smooth"
        style={{ backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 0)', backgroundSize: '16px 16px' }}
      >
        <ChatFilterBar
          onFilterChange={setFilter}
          messageCount={chatMessages.length}
        />
        {!selectedConversationId && chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 py-12 px-4">
            <div className="text-3xl">⚔️</div>
            <div className="text-center">
              <h3 className="text-[14px] font-bold text-[hsl(var(--text-primary))]">
                作战指挥室
              </h3>
              <p className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1 max-w-[280px] leading-relaxed">
                描述你想构建的东西，或 @Agent 下达具体指令。
                <br />首次发送将自动创建项目。
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                '@Mario 帮我规划一下…',
                '@Luigi 写一个…',
                '@Peach 审查…',
              ].map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => setInputValue(hint)}
                  className="text-[10px] px-3 py-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))] hover:text-[hsl(var(--text-primary))] transition-colors"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}
        {selectedConversationId && chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 py-8 px-4">
            <div className="text-2xl">🔑</div>
            <p className="text-[11px] text-[hsl(var(--text-tertiary))] text-center max-w-[260px]">
              @jean 可以帮你分析项目、出技术方案，或直接 @Agent 下达指令
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-1">
              {['@Mario 帮我规划一下…', '@Luigi 直接开始…'].map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => setInputValue(hint)}
                  className="text-[10px] px-3 py-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))] hover:text-[hsl(var(--text-primary))] transition-colors"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
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
          return groups.map((group, gi) => {
            const groupDate = new Date(group.messages[0].timestamp).toDateString();
            const showDateSep = groupDate !== lastDate;
            lastDate = groupDate;

            const meta = AGENT_META[group.agentId] || { emoji: '?', name: group.agentId, color: 'border-zinc-500/40' };
            const isLatestGroup = gi === groups.length - 1;
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
                    defaultExpanded={isLatestGroup}
                    forceExpand={group.messages.some(m => m.isStreaming)}
                  />
                )}
              </div>
            );
          });
        })()}
      </div>

      {/* Pending Queue Indicator */}
      {hasPending && (
        <div className="shrink-0 px-4 py-2 bg-[hsl(var(--bg-muted))] border-t border-[hsl(var(--border-subtle))]">
          <div className="flex flex-col gap-1.5">
            {Object.entries(pendingDispatches).map(([agentId, queue]) => {
              if (!queue || queue.length === 0) return null;
              const agent = AGENT_ROSTER.find((a) => a.id === agentId);
              return (
                <div key={agentId} className="flex items-start gap-2">
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    <Clock className="w-3 h-3 text-[hsl(var(--text-tertiary))]" />
                    <span className="text-[10px] font-bold text-[hsl(var(--text-secondary))]">
                      {agent?.emoji} {agent?.name ?? agentId}
                    </span>
                    <span className="text-[9px] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))] px-1 rounded-[2px]">{queue.length}</span>
                  </div>
                  <div className="flex-1 flex flex-col gap-1 min-w-0">
                    {queue.map((item, i) => (
                      <div
                        key={`${agentId}-${i}`}
                        className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-card))] rounded-[2px] border border-[hsl(var(--border-subtle))] px-2 py-1"
                      >
                        <span className="truncate flex-1 text-[hsl(var(--text-primary))]">{item.prompt.slice(0, 80)}{item.prompt.length > 80 ? '…' : ''}</span>
                        {i === 0 && (
                          <button
                            type="button"
                            onClick={() => forceSendDispatch({ agentId, prompt: item.prompt, referencedTaskId: item.referencedTaskId })}
                            className="shrink-0 text-[hsl(var(--text-tertiary))] hover:text-amber-400"
                            title="强制发送（中断当前任务）"
                          >
                            <Zap className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const next = queue.filter((_, j) => j !== i);
                            const pd = { ...useTaskHubStore.getState().pendingDispatches };
                            if (next.length > 0) {
                              pd[agentId] = next;
                            } else {
                              delete pd[agentId];
                            }
                            useTaskHubStore.setState({ pendingDispatches: pd });
                          }}
                          className="shrink-0 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-rejected))]"
                          title="移除此条"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => clearPendingDispatches(agentId)}
                    className="shrink-0 text-[9px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-rejected))] mt-0.5"
                    title="清空全部"
                  >
                    全部清空
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setCursorPos(e.target.selectionStart ?? e.target.value.length);
              const textBefore = e.target.value.slice(0, e.target.selectionStart ?? e.target.value.length);
              const atMatch = textBefore.match(/@(\w*)$/);
              const hasAt = !!atMatch;
              setMentionOpen(hasAt);
              if (hasAt && atMatch) {
                const query = atMatch[1].toLowerCase();
                const store = useTaskHubStore.getState();
                const activeAgents = AGENT_ROSTER.filter((a) => store.activeAgentIds.includes(a.id));
                const filtered = activeAgents.filter((agent) => {
                  const roleCard = agent.roleCardId ? store.roleCards.find((c) => c.id === agent.roleCardId) : null;
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
            placeholder="发送消息或 @智能体…"
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
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
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
          使用 #TASK-000 引用任务 · @Agent 提及智能体
        </p>
      </div>
    </div>
  );
}
