'use client';

import { useTaskHubStore, type ChatMessage } from '@/store/taskHubStore';
import { useState } from 'react';
import { PixelAvatar } from './PixelAvatar';
import { CliOutputBlock } from './CliOutputBlock';
import { cn } from '@/lib/utils';
import { parsePhaseBreakdown } from '@/lib/breakdownParser';
import { User, Lightbulb, Play, Eye, Link2, Copy, ExternalLink, Activity } from 'lucide-react';
import { openAgentObservabilityDrawer } from '@/components/project/AgentObservabilityDrawer';
import { MarkdownContent } from './MarkdownContent';
import { TokenBadge } from './TokenSummary';
import { TaskCapsules, type TaskCapsuleRef } from './TaskCapsules';
import { TaskActionCard, type TaskActionCardRef } from './TaskActionCard';
import { ChatPhaseProposals } from './ChatPhaseProposals';
import { ChatApprovalActions } from './ChatApprovalActions';
import type { AgentTheme } from '@/store/agentStore';
import { EngineeringCollaborationCard } from './EngineeringCollaborationCard';
import { isEngineeringCollaborationCard } from '@/lib/engineering-collaboration/types';

interface ChatMessageItemProps {
  message: ChatMessage;
  responseSegments?: ChatMessage[];
}

const AVATAR_THEME_CLASSES: Record<AgentTheme, string> = {
  mario: 'bg-[hsl(var(--agent-mario))] border-[hsl(var(--agent-mario-border))]',
  luigi: 'bg-[hsl(var(--agent-luigi))] border-[hsl(var(--agent-luigi-border))]',
  peach: 'bg-[hsl(var(--agent-peach))] border-[hsl(var(--agent-peach-border))]',
  dk: 'bg-[hsl(var(--agent-dk))] border-[hsl(var(--agent-dk-border))]',
};

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

export function ChatMessageItem({ message, responseSegments }: ChatMessageItemProps) {
  // 用 effectiveRoster（按当前 conversation 的 runtime roster，含 TeamPack 角色 planner/coder/reviewer），
  // 而非 agentRoster（6 人组初始，不含 TeamPack 角色）——否则消息找不到 agent → 无头像/名字
  const allAgents = useTaskHubStore((s) => s.getEffectiveRoster());

  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const updateChatMessageStatus = useTaskHubStore((s) => s.updateChatMessageStatus);
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);

  const segments = responseSegments?.length ? responseSegments : [message];
  const responseMessage = segments[0];
  const responseText = segments
    .map((segment) => segment.content)
    .filter(Boolean)
    .join('\n\n');
  const isHuman = responseMessage.agentId === 'human';
  const agent = allAgents.find((a) => a.id === responseMessage.agentId);
  const hasToolTrace = !isHuman && segments.some((segment) => (segment.toolEvents?.length ?? 0) > 0);
  const toolEvents = segments.flatMap((segment) => segment.toolEvents ?? []);
  const responseIsStreaming = segments.some((segment) => segment.isStreaming === true);
  const streamingToolText = segments.find((segment) => segment.isStreaming)?.content;
  const tokenUsage = [...segments].reverse().find((segment) => segment.tokenUsage)?.tokenUsage;
  const responseTaskRefs = Array.from(new Map(
    segments.flatMap(taskRefsFromMessage).map((task) => [task.id, task]),
  ).values());
  const responseTaskActions = Array.from(new Map(
    segments.flatMap(taskActionsFromMessage).map((action) => [action.id, action]),
  ).values());
  const responseCollaborationCard = [...segments]
    .reverse()
    .map((segment) => segment.metadata?.collaborationCard)
    .find(isEngineeringCollaborationCard);
  const plainTextSegments = segments.filter((segment) =>
    Boolean(segment.content) && (segment.toolEvents?.length ?? 0) === 0
  );
  const finalPlainTextId = plainTextSegments.at(-1)?.id;
  const intermediateNarrativeSegments = hasToolTrace
    ? plainTextSegments.filter((segment) => segment.id !== finalPlainTextId)
    : [];
  const intermediateNarrativeIds = new Set(intermediateNarrativeSegments.map((segment) => segment.id));

  const timeString = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      data-testid={message.invocationId ? `agent-response-${message.invocationId}` : undefined}
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
            AVATAR_THEME_CLASSES[agent.theme]
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
          <span className="mb-1 inline-flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]">
            <Link2 className="h-3 w-3" />
            接手自 {message.fromAgentId}
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
          {intermediateNarrativeSegments.length > 0 && (
            <details
              data-testid="agent-progress-details"
              className="mb-2 rounded-[3px] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] px-2 py-1.5"
            >
              <summary className="cursor-pointer select-none text-[10px] font-bold text-[hsl(var(--text-secondary))]">
                过程说明 {intermediateNarrativeSegments.length} 条
              </summary>
              <div className="mt-2 space-y-2 border-t border-[hsl(var(--border-subtle))] pt-2 text-[hsl(var(--text-secondary))]">
                {intermediateNarrativeSegments.map((segment) => (
                  <MarkdownContent key={segment.id} content={segment.content} />
                ))}
              </div>
            </details>
          )}

          {segments.map((segment) => {
            const segmentHasToolEvents = (segment.toolEvents?.length ?? 0) > 0;
            const hideSegmentNarrative = segmentHasToolEvents || intermediateNarrativeIds.has(segment.id);
            const segmentProposals = parsePhaseBreakdown(segment.content);

            return (
              <div key={segment.id} data-message-segment-id={segment.id} className="mt-2 first:mt-0">
                {segment.isStreaming && !segment.content && !segmentHasToolEvents ? (
                  <span className="inline-block w-1.5 h-4 bg-current animate-pulse rounded-full opacity-50" />
                ) : segment.content && !hideSegmentNarrative ? (
                  isHuman ? (
                    <div className="whitespace-pre-wrap break-words">{formatContentWithMentions(segment.content)}</div>
                  ) : (
                    <MarkdownContent content={segment.content} />
                  )
                ) : null}

                {segmentProposals.length > 0 && (
                  <ChatPhaseProposals proposals={segmentProposals} allAgents={allAgents} />
                )}

                {segment.isApprovalRequest && (
                  <ChatApprovalActions
                    messageId={segment.id}
                    approvalStatus={segment.approvalStatus ?? 'pending'}
                    rejectionReason={segment.rejectionReason}
                    artifactPreview={segment.artifactPreview}
                    onUpdateStatus={updateChatMessageStatus}
                  />
                )}
              </div>
            );
          })}

          {responseTaskRefs.length > 0 && (
            <TaskCapsules
              tasks={responseTaskRefs}
              onSelectTask={setSelectedTaskId}
              className="mt-2"
            />
          )}

          {responseTaskActions.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {responseTaskActions.map((action) => (
                <TaskActionCard
                  key={action.id}
                  action={action}
                  onSelectTask={setSelectedTaskId}
                />
              ))}
            </div>
          )}

          {responseCollaborationCard && (
            <EngineeringCollaborationCard card={responseCollaborationCard} onSelectTask={setSelectedTaskId} />
          )}

          {toolEvents.length > 0 && (
            <CliOutputBlock
              events={toolEvents}
              isStreaming={responseIsStreaming}
              streamText={responseIsStreaming ? streamingToolText : undefined}
            />
          )}

          {tokenUsage && (
            <div className="mt-1.5">
              <TokenBadge usage={tokenUsage} />
            </div>
          )}

          {/* Hover Action Bar */}
          {isHovered && (
            <div className="absolute -top-2 right-2 flex gap-0.5 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-[var(--radius-sm)] p-0.5 shadow-sm z-10">
              {!isHuman && (message.conversationId || selectedConversationId) && (
                <button
                  type="button"
                  onClick={() => openAgentObservabilityDrawer({
                    conversationId: message.conversationId || selectedConversationId!,
                    invocationId: message.invocationId,
                    agentId: message.agentId,
                    timestamp: message.timestamp,
                  })}
                  className="p-1 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] rounded-[2px] hover:bg-[hsl(var(--bg-muted))] transition-colors"
                  title="查看这次 Agent 调用"
                  aria-label="查看这次 Agent 调用"
                >
                  <Activity className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('chat:quote', { detail: responseText }));
                }}
                className="p-1 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] rounded-[2px] hover:bg-[hsl(var(--bg-muted))] transition-colors"
                title="引用此消息"
                aria-label="引用此消息"
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(responseText)}
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
