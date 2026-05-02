'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/store/taskHubStore';
import { ChatMessageItem } from './ChatMessageItem';

interface MessageGroupProps {
  messages: ChatMessage[];
  themeColor: string;
  agentEmoji: string;
  agentName: string;
  defaultExpanded: boolean;
}

export function MessageGroup({ messages, themeColor, agentEmoji, agentName, defaultExpanded }: MessageGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (messages.length === 0) return null;

  if (messages.length === 1) {
    return <ChatMessageItem message={messages[0]} />;
  }

  const firstTime = messages[0].timestamp.slice(11, 16);
  const lastTime = messages[messages.length - 1].timestamp.slice(11, 16);

  return (
    <div className={cn('border-l-2 pl-2.5', themeColor)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left mb-1 group"
      >
        <span className="text-[11px]">{agentEmoji}</span>
        <span className="text-[10px] font-bold text-[hsl(var(--text-secondary))]">{agentName}</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{messages.length} 条</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">· {firstTime}-{lastTime}</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))] ml-auto group-hover:text-[hsl(var(--text-primary))] transition-colors">
          {expanded ? '▼ 收起' : '▶ 展开'}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-4">
          {messages.map((msg) => (
            <ChatMessageItem key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}
