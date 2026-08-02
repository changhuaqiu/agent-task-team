'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/store/taskHubStore';
import { ChatMessageItem } from './ChatMessageItem';

interface MessageGroupProps {
  messages: ChatMessage[];
  themeColor: string;
  agentEmoji: string;
  agentName: string;
  defaultExpanded: boolean;
  forceExpand?: boolean;
}

import React from 'react';

interface AgentResponse {
  id: string;
  messages: ChatMessage[];
}

export function groupMessagesIntoAgentResponses(messages: ChatMessage[]): AgentResponse[] {
  const responses: AgentResponse[] = [];

  for (const message of messages) {
    const previous = responses[responses.length - 1];
    const belongsToPreviousInvocation = Boolean(
      message.invocationId
      && previous?.messages[0].invocationId === message.invocationId,
    );

    if (belongsToPreviousInvocation) {
      previous.messages.push(message);
      continue;
    }

    responses.push({
      id: message.invocationId ?? message.id,
      messages: [message],
    });
  }

  return responses;
}

export const MessageGroup = React.memo(function MessageGroup({ messages, themeColor, agentEmoji, agentName, defaultExpanded, forceExpand }: MessageGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // External force-expand (e.g. when a message in this group starts streaming)
  useEffect(() => {
    if (forceExpand) setExpanded(true);
  }, [forceExpand]);
  if (messages.length === 0) return null;

  const responses = groupMessagesIntoAgentResponses(messages);

  if (responses.length === 1) {
    return (
      <ChatMessageItem
        message={responses[0].messages[0]}
        responseSegments={responses[0].messages}
      />
    );
  }

  const firstTime = new Date(messages[0].timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const lastTime = new Date(messages[messages.length - 1].timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div className={cn('border-l-2 pl-2.5', themeColor)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left mb-1 group"
      >
        <span className="text-[11px]">{agentEmoji}</span>
        <span className="text-[10px] font-bold text-[hsl(var(--text-secondary))]">{agentName}</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{responses.length} 次回复</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">· {firstTime}-{lastTime}</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))] ml-auto group-hover:text-[hsl(var(--text-primary))] transition-colors">
          {expanded ? '▼ 收起' : '▶ 展开'}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-4">
          {responses.map((response) => (
            <ChatMessageItem
              key={response.id}
              message={response.messages[0]}
              responseSegments={response.messages}
            />
          ))}
        </div>
      )}
    </div>
  );
});
