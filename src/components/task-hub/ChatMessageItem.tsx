'use client';

import { useTaskHubStore, selectActiveAgents, selectAvailableRoster, type ChatMessage } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import { PixelAvatar } from './PixelAvatar';
import { cn } from '@/lib/utils';
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
    default:
      return null;
  }
};

const INTENT_LABELS: Record<string, string> = {
  ideate: '构思',
  execute: '执行',
  review: '评审',
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

type TaskProposal = {
  title: string;
  description: string;
  agentId?: string;
};

const parseTaskProposals = (content: string): TaskProposal[] => {
  const lines = content.split('\n');
  const proposals: TaskProposal[] = [];
  for (const raw of lines) {
    const m = /^\s*(?:-|\*)?\s*TASK\s*:\s*(.+)\s*$/i.exec(raw);
    if (!m) continue;
    const rest = m[1] || '';
    const agentMatch = /@(\w+)/.exec(rest);
    const agentId = agentMatch ? agentMatch[1] : undefined;
    const cleaned = rest.replace(/@(\w+)/g, '').trim();
    const [titlePart, ...descParts] = cleaned.split('|');
    const title = (titlePart || '').trim();
    const description = descParts.join('|').trim();
    if (!title) continue;
    proposals.push({ title, description, agentId });
  }
  return proposals.slice(0, 3);
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
  const proposals = useMemo(() => parseTaskProposals(message.content), [message.content]);

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
          {formatContentWithMentions(message.content)}

          {proposals.length > 0 && (
            <div className="mt-3 pt-2 border-t border-dashed border-[hsl(var(--border-subtle))] flex flex-col gap-2">
              {proposals.map((p, idx) => {
                const suggestedAgent = p.agentId ? allAgents.find((a) => a.id === p.agentId) : undefined;
                const resolvedAgentId = suggestedAgent?.id ?? activeAgents[0]?.id ?? '';
                const canCreate = Boolean(resolvedAgentId);
                return (
                  <div
                    key={idx}
                    className="rounded-[var(--radius-md)] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                          提案任务
                        </div>
                        <div className="text-[12px] font-semibold text-[hsl(var(--text-primary))] mt-0.5">
                          {p.title}
                        </div>
                        {p.description && (
                          <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-0.5">
                            {p.description}
                          </div>
                        )}
                        {suggestedAgent && (
                          <div className="text-[10px] text-[hsl(var(--text-tertiary))] mt-1">
                            建议：{suggestedAgent.emoji} {suggestedAgent.name}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={!canCreate}
                        onClick={() => {
                          if (!resolvedAgentId) return;
                          if (p.agentId && !activeAgents.some((a) => a.id === p.agentId)) {
                            inviteAgent(p.agentId);
                          }
                          addTask({
                            title: p.title,
                            description: p.description,
                            status: 'pending',
                            agentId: resolvedAgentId,
                            dependencies: [],
                            artifacts: [],
                          });
                        }}
                        className={cn(
                          'h-8 px-3 rounded-[var(--radius-md)] text-[11px] font-bold border transition-colors',
                          canCreate
                            ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))] hover:opacity-90'
                            : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border-[hsl(var(--border))]'
                        )}
                      >
                        创建
                      </button>
                    </div>
                  </div>
                );
              })}
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
