'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface ChatFilter {
  intent: string | null;
  agentId: string | null;
  userOnly: boolean;
  search: string;
}

interface ChatFilterBarProps {
  onFilterChange: (filter: ChatFilter) => void;
  messageCount: number;
}

const INTENT_OPTIONS = [
  { value: null, label: '全部' },
  { value: 'ideate', label: '💡 构思' },
  { value: 'execute', label: '⚡ 执行' },
  { value: 'review', label: '🔍 评审' },
  { value: 'progress', label: '📊 进度' },
  { value: 'general', label: '💬 通用' },
];

export function ChatFilterBar({ onFilterChange, messageCount }: ChatFilterBarProps) {
  const [search, setSearch] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const [userOnly, setUserOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(messageCount < 20);

  const updateFilter = (partial: Partial<ChatFilter>) => {
    const next = { search, intent, userOnly, ...partial };
    setSearch(next.search);
    setIntent(next.intent);
    setUserOnly(next.userOnly);
    onFilterChange(next as ChatFilter);
  };

  if (collapsed) {
    return (
      <div className="px-4 py-1 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{messageCount} 条消息</span>
        {messageCount >= 20 && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="text-[9px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            筛选 ▼
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 px-2 py-0.5 bg-[hsl(var(--bg-app))] border border-[hsl(var(--border))] rounded-[4px] min-w-[100px]">
        <span className="text-[10px] text-[hsl(var(--text-tertiary))]">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => updateFilter({ search: e.target.value })}
          placeholder="搜索…"
          className="bg-transparent text-[11px] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none w-full"
        />
      </div>

      <div className="flex gap-1 items-center">
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">意图:</span>
        {INTENT_OPTIONS.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => updateFilter({ intent: opt.value })}
            className={cn(
              'text-[9px] px-2 py-0.5 rounded-full border transition-colors',
              intent === opt.value
                ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                : 'border-[hsl(var(--border))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => updateFilter({ userOnly: !userOnly })}
        className={cn(
          'text-[9px] px-2 py-0.5 rounded-full border transition-colors',
          userOnly
            ? 'border-[hsl(var(--agent-owner))] bg-[hsl(var(--agent-owner))]/10 text-[hsl(var(--agent-owner))]'
            : 'border-[hsl(var(--border))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))]',
        )}
      >
        👤 仅用户
      </button>

      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="text-[9px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] ml-auto transition-colors"
      >
        收起 ▲
      </button>
    </div>
  );
}
