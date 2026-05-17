'use client';

import { useTaskHubStore, selectActiveAgents, selectAvailableRoster, type ChatMessage } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { useMemo, useState } from 'react';
import { PixelAvatar } from './PixelAvatar';
import { CliOutputBlock } from './CliOutputBlock';
import { ProgressMessageCard } from './ProgressMessageCard';
import { cn } from '@/lib/utils';
import { parsePhaseBreakdown } from '@/lib/breakdownParser';
import { User, Lightbulb, Play, Eye, Link2, Copy, ExternalLink } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent';
import { TokenBadge } from './TokenSummary';
import { TaskStatusCard } from './TaskStatusCard';
import { TaskCapsules, type TaskCapsuleRef } from './TaskCapsules';
import { TaskActionCard, type TaskActionCardRef } from './TaskActionCard';
import { ChatPhaseProposals } from './ChatPhaseProposals';
import { ChatApprovalActions } from './ChatApprovalActions';

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

function taskRefsFromMessage(message: ChatMessage): TaskCapsuleRef[] {
  const refs = message.taskRefs ?? message.metadata?.taskRefs;
  if (Array.isArray(refs)) {
    return refs
      .filter((item): item is TaskCapsuleRef =>
        item &&
        typeof item.id === 'string' &&
        typeof item.title === 'string'
      )
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: typeof item.status === 'string' ? item.status : undefined,
        ownerAgentId: typeof item.ownerAgentId === 'string' ? item.ownerAgentId : undefined,
      }));
  }
  if (message.referencedTaskId) {
    return [{ id: message.referencedTaskId, title: message.referencedTaskId }];
  }
  return [];
}

function taskActionsFromMessage(message: ChatMessage): TaskActionCardRef[] {
  const actions = message.metadata?.taskActions;
  if (!Array.isArray(actions)) return [];

  return actions.filter((item): item is TaskActionCardRef =>
    item &&
    typeof item.id === 'string' &&
    typeof item.actionType === 'string' &&
    Array.isArray(item.taskIds)
  );
}

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

  const isHuman = message.agentId === 'human';
  const agent = allAgents.find((a) => a.id === message.agentId);

  const timeString = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const proposals = useMemo(() => parsePhaseBreakdown(message.content), [message.content]);
  const hasPhaseStructure = proposals.length > 0;
  const hasToolEvents = (message.toolEvents?.length ?? 0) > 0;
  const taskRefs = useMemo(() => taskRefsFromMessage(message), [message]);
  const taskActions = useMemo(() => taskActionsFromMessage(message), [message]);

  const [isHovered, setIsHovered] = useState(false);

  // Task status card rendering
  if (message.intent === 'task_status') {
    return (
      <div className="py-1">
        <TaskStatusCard
          taskId={message.metadata?.taskId || ''}
          agentId={message.agentId === 'system' ? (message.metadata?.agentId || '') : message.agentId}
          title={message.metadata?.title || ''}
          status={message.metadata?.status || ''}
          timestamp={message.timestamp}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex gap-3 w-full animate-fade-in',
        isHuman ? 'flex-row-reverse' : 'flex-row'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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

        {/* A2A source label */}
        {!isHuman && message.source === 'a2a' && message.fromAgentId && (
          <span className="text-xs text-gray-400 mb-1 block">
            [{message.fromAgentId} → {message.agentId}]
          </span>
        )}

        {/* Bubble */}
        <div
          className={cn(
            'relative px-3 py-2 text-[12px] leading-relaxed break-words shadow-[var(--shadow-sm)] border',
            'bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))]',
            'rounded-[4px]',
            isHuman
              ? 'border-[hsl(var(--agent-owner-border))] rounded-tr-none'
              : 'border-[hsl(var(--border))] rounded-tl-none'
          )}
        >
          {message.isStreaming && !message.content && !hasToolEvents ? (
            <span className="inline-block w-1.5 h-4 bg-current animate-pulse rounded-full opacity-50" />
          ) : message.content && !(hasToolEvents && message.isStreaming) ? (
            isHuman ? (
              <div className="whitespace-pre-wrap break-words">{formatContentWithMentions(message.content)}</div>
            ) : (
              <MarkdownContent content={message.content} />
            )
          ) : null}

          {message.progressData && (
            <div className="mt-2">
              <ProgressMessageCard
                message={message}
                onTaskClick={(taskId) => setSelectedTaskId(taskId)}
              />
            </div>
          )}

          {hasToolEvents && (
            <CliOutputBlock
              events={message.toolEvents!}
              isStreaming={!!message.isStreaming}
              streamText={message.isStreaming ? message.content : undefined}
            />
          )}

          {!message.isStreaming && message.tokenUsage && hasToolEvents && (
            <div className="mt-1.5">
              <TokenBadge usage={message.tokenUsage} />
            </div>
          )}

          {hasPhaseStructure && (
            <ChatPhaseProposals proposals={proposals} allAgents={allAgents} />
          )}

          {taskRefs.length > 0 && (
            <TaskCapsules
              tasks={taskRefs}
              onSelectTask={setSelectedTaskId}
              className="mt-2"
            />
          )}

          {taskActions.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {taskActions.map((action) => (
                <TaskActionCard
                  key={action.id}
                  action={action}
                  onSelectTask={setSelectedTaskId}
                />
              ))}
            </div>
          )}

          {message.isApprovalRequest && (
            <ChatApprovalActions
              messageId={message.id}
              approvalStatus={message.approvalStatus ?? 'pending'}
              rejectionReason={message.rejectionReason}
              artifactPreview={message.artifactPreview}
              onUpdateStatus={updateChatMessageStatus}
            />
          )}

          {/* Hover Action Bar */}
          {isHovered && (
            <div className="absolute -top-2 right-2 flex gap-0.5 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-[var(--radius-sm)] p-0.5 shadow-sm z-10">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('chat:quote', { detail: message.content }));
                }}
                className="p-1 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] rounded-[2px] hover:bg-[hsl(var(--bg-muted))] transition-colors"
                title="引用此消息"
                aria-label="引用此消息"
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(message.content)}
                className="p-1 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] rounded-[2px] hover:bg-[hsl(var(--bg-muted))] transition-colors"
                title="复制内容"
                aria-label="复制内容"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              {message.referencedTaskId && (
                <button
                  type="button"
                  onClick={() => setSelectedTaskId(message.referencedTaskId!)}
                  className="p-1 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] rounded-[2px] hover:bg-[hsl(var(--bg-muted))] transition-colors"
                  title="跳转到任务"
                  aria-label="跳转到任务"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
