'use client';

import { useTaskHubStore, selectActiveAgents, selectAvailableRoster, type ChatMessage } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { useMemo, useState } from 'react';
import { PixelAvatar } from './PixelAvatar';
import { CliOutputBlock } from './CliOutputBlock';
import { ProgressMessageCard } from './ProgressMessageCard';
import { cn } from '@/lib/utils';
import { parsePhaseBreakdown } from '@/lib/breakdownParser';
import { Check, X, User, Lightbulb, Play, Eye } from 'lucide-react';

interface ChatMessageItemProps {
  message: ChatMessage;
}

const IntentIcon = ({ intent }: { intent?: string }) => {
  switch (intent) {
    case 'ideate':
      return <Lightbulb className="w-3 h-3 text-yellow-500" />;
    case 'execute':
      return <Play className="w-3 h-3 text-blue-500" />;
    case 'review':
      return <Eye className="w-3 h-3 text-green-500" />;
    case 'progress':
      return <Play className="w-3 h-3 text-blue-400" />;
    default:
      return null;
  }
};

const INTENT_LABELS: Record<string, string> = {
  ideate: '构思',
  execute: '执行',
  review: '评审',
  progress: '进度',
};

const formatContentWithMentions = (content: string) => {
  const mentionRegex = /(@\w+)/g;
  const parts = content.split(mentionRegex);

  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span
          key={i}
          className="inline-block px-1 bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))] rounded-[2px] font-bold mx-0.5"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

export function ChatMessageItem({ message }: ChatMessageItemProps) {
  const activeAgents = useTaskHubStore(useShallow(selectActiveAgents));
  const availableRoster = useTaskHubStore(useShallow(selectAvailableRoster));
  const allAgents = [...activeAgents, ...availableRoster];
  
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const updateChatMessageStatus = useTaskHubStore((s) => s.updateChatMessageStatus);
  const addTask = useTaskHubStore((s) => s.addTask);
  const inviteAgent = useTaskHubStore((s) => s.inviteAgent);

  const isHuman = message.agentId === 'human';
  const agent = allAgents.find((a) => a.id === message.agentId);

  const timeString = message.timestamp.slice(11, 16);
  const proposals = useMemo(() => parsePhaseBreakdown(message.content), [message.content]);
  const hasPhaseStructure = proposals.length > 0;
  const hasToolEvents = (message.toolEvents?.length ?? 0) > 0;

  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => {
    if (!hasPhaseStructure) return new Set();
    const keys = new Set<string>();
    proposals.forEach((phase, pi) => {
      phase.tasks.forEach((_, ti) => keys.add(`${pi}-${ti}`));
    });
    return keys;
  });

  const toggleCheck = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredProposals = useMemo(() => {
    return proposals.map((phase, pi) => ({
      ...phase,
      tasks: phase.tasks.filter((_, ti) => checkedKeys.has(`${pi}-${ti}`)),
    })).filter((p) => p.tasks.length > 0);
  }, [proposals, checkedKeys]);

  const totalChecked = filteredProposals.reduce((sum, p) => sum + p.tasks.length, 0);

  return (
    <div
      className={cn(
        'flex gap-3 w-full animate-fade-in',
        isHuman ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div className="shrink-0 pt-1">
        {isHuman ? (
          <div className="w-8 h-8 bg-[hsl(var(--agent-owner))] rounded-[4px] flex items-center justify-center text-[hsl(var(--bg-app))] shadow-[var(--shadow-sm)] border border-[hsl(var(--agent-owner-border))]">
            <User className="w-4 h-4" />
          </div>
        ) : agent ? (
          <div className={cn(
            'w-8 h-8 rounded-[4px] flex items-center justify-center shadow-[var(--shadow-sm)] border overflow-hidden',
            `bg-[hsl(var(--agent-${agent.theme}))]`,
            `border-[hsl(var(--agent-${agent.theme}-border))]`
          )}>
            <PixelAvatar theme={agent.theme} size={32} />
          </div>
        ) : (
          <div className="w-8 h-8 bg-gray-500 rounded-[4px]" />
        )}
      </div>

      {/* Message Body */}
      <div className={cn('flex flex-col max-w-[85%]', isHuman && 'items-end')}>
        {/* Header */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-[11px] font-bold text-[hsl(var(--text-secondary))]">
            {isHuman ? '用户' : agent?.name}
          </span>
          <span className="text-[9px] text-[hsl(var(--text-tertiary))] opacity-70">
            {timeString}
          </span>
          {message.intent && message.intent !== 'general' && !isHuman && (
            <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-sm bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border-subtle))] uppercase">
              <IntentIcon intent={message.intent} />
              {INTENT_LABELS[message.intent] ?? message.intent}
            </span>
          )}
        </div>

        {/* Bubble */}
        <div
          className={cn(
            'relative px-3 py-2 text-[12px] leading-relaxed break-words shadow-[var(--shadow-sm)] border',
            // JRPG Dialog Box style
            'bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))]',
            'rounded-[4px]',
            isHuman
              ? 'border-[hsl(var(--agent-owner-border))] rounded-tr-none'
              : 'border-[hsl(var(--border))] rounded-tl-none'
          )}
        >
          {/* Main text content */}
          {message.isStreaming && !message.content && !hasToolEvents ? (
            <span className="inline-block w-1.5 h-4 bg-[hsl(var(--text-primary))] animate-pulse" />
          ) : message.content ? (
            <div className="whitespace-pre-wrap break-words">{formatContentWithMentions(message.content)}</div>
          ) : null}

          {/* Progress Message Card */}
          {message.progressData && (
            <div className="mt-2">
              <ProgressMessageCard
                message={message}
                onTaskClick={(taskId) => setSelectedTaskId(taskId)}
              />
            </div>
          )}

          {/* CLI Output collapsible panel */}
          {hasToolEvents && (
            <CliOutputBlock
              events={message.toolEvents!}
              isStreaming={!!message.isStreaming}
            />
          )}

          {hasPhaseStructure && (
            <div className="mt-3 pt-2 border-t border-dashed border-[hsl(var(--border-subtle))] flex flex-col gap-2">
              {proposals.map((phase, pi) => (
                <div key={pi} className="rounded-[4px] border-2 border-[hsl(var(--border))] overflow-hidden">
                  <div className="px-3 py-1.5 bg-[hsl(var(--bg-muted))] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold bg-[hsl(var(--accent))] text-white px-1.5 py-0.5 rounded-[2px]">
                        阶段 {pi + 1}
                      </span>
                      <span className="text-[11px] font-bold text-[hsl(var(--text-primary))]">{phase.title}</span>
                    </div>
                    <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{phase.tasks.length} 任务</span>
                  </div>
                  <div className="px-2 py-1.5 flex flex-col gap-1">
                    {phase.tasks.map((task, ti) => {
                      const key = `${pi}-${ti}`;
                      const isChecked = checkedKeys.has(key);
                      const suggestedAgent = task.agentId ? allAgents.find((a) => a.id === task.agentId) : undefined;
                      return (
                        <div
                          key={key}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1 rounded-[2px] border transition-colors",
                            isChecked
                              ? "bg-[hsl(var(--bg-app))] border-[hsl(var(--border-subtle))]"
                              : "bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))] opacity-50"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCheck(key)}
                            className={cn(
                              "w-4 h-4 rounded-[2px] border-2 flex items-center justify-center shrink-0 transition-all",
                              isChecked
                                ? "bg-[hsl(var(--accent))] border-[hsl(var(--accent))] text-white"
                                : "bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))]"
                            )}
                          >
                            {isChecked && <span className="text-[8px]">✓</span>}
                          </button>
                          <span className="text-[10px] text-[hsl(var(--text-primary))] flex-1 truncate">{task.title}</span>
                          {suggestedAgent && (
                            <span className="text-[9px] text-[hsl(var(--text-tertiary))] shrink-0">
                              {suggestedAgent.emoji} {suggestedAgent.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  disabled={totalChecked === 0}
                  onClick={() => {
                    const convId = useTaskHubStore.getState().selectedConversationId;
                    if (!convId) return;
                    useTaskHubStore.getState().confirmBreakdown(convId, filteredProposals);
                  }}
                  className="flex-1 py-1.5 text-[10px] font-bold bg-[hsl(var(--accent))] text-white border-2 border-[hsl(var(--accent))] rounded-[2px] shadow-[2px_2px_0px_hsl(var(--accent)/0.4)] hover:shadow-[1px_1px_0px_hsl(var(--accent)/0.4)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ✓ 确认选中 ({totalChecked} 个任务)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const convId = useTaskHubStore.getState().selectedConversationId;
                    if (!convId) return;
                    useTaskHubStore.getState().triggerBreakdown(convId);
                  }}
                  className="py-1.5 px-3 text-[10px] font-bold text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[2px] hover:text-[hsl(var(--text-primary))] transition-colors"
                >
                  重新拆解
                </button>
              </div>
            </div>
          )}

          {/* Reference Task Tag */}
          {message.referencedTaskId && (
            <button
              onClick={() => setSelectedTaskId(message.referencedTaskId!)}
              className="mt-2 block w-fit text-[10px] font-bold text-[hsl(var(--accent))] hover:text-[hsl(var(--accent-soft))] bg-[hsl(var(--accent-soft))] hover:bg-[hsl(var(--accent))] px-2 py-0.5 rounded-[2px] border border-[hsl(var(--accent))] transition-colors"
            >
              #{message.referencedTaskId}
            </button>
          )}

          {/* Approval Actions */}
          {message.isApprovalRequest && (
            <div className="mt-3 pt-2 border-t border-dashed border-[hsl(var(--border-subtle))] flex items-center gap-2">
              {message.approvalStatus === 'pending' ? (
                <>
                  <button
                    onClick={() => updateChatMessageStatus(message.id, 'approved')}
                    className="flex-1 flex items-center justify-center gap-1 bg-[hsl(var(--status-done))] hover:brightness-110 text-[hsl(var(--bg-app))] text-[10px] font-bold py-1.5 px-2 rounded-[2px] shadow-[2px_2px_0px_hsl(var(--text-primary))] transition-transform active:translate-y-[2px] active:shadow-[0px_0px_0px_hsl(var(--text-primary))]"
                  >
                    <Check className="w-3 h-3" /> 同意
                  </button>
                  <button
                    onClick={() => updateChatMessageStatus(message.id, 'rejected')}
                    className="flex-1 flex items-center justify-center gap-1 bg-[hsl(var(--status-rejected))] hover:brightness-110 text-[hsl(var(--bg-app))] text-[10px] font-bold py-1.5 px-2 rounded-[2px] shadow-[2px_2px_0px_hsl(var(--text-primary))] transition-transform active:translate-y-[2px] active:shadow-[0px_0px_0px_hsl(var(--text-primary))]"
                  >
                    <X className="w-3 h-3" /> 拒绝
                  </button>
                </>
              ) : (
                <div
                  className={cn(
                    'w-full text-center text-[10px] font-bold py-1 rounded-[2px] border',
                    message.approvalStatus === 'approved'
                      ? 'bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))] border-[hsl(var(--status-done-border))]'
                      : 'bg-[hsl(var(--status-rejected-bg))] text-[hsl(var(--status-rejected))] border-[hsl(var(--status-rejected-border))]'
                  )}
                >
                  {message.approvalStatus === 'approved' ? '已同意' : '已拒绝'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
