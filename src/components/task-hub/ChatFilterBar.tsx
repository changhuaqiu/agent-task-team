'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Search, Lightbulb, Zap, Eye, BarChart3, MessageCircle, User, ChevronDown, ChevronUp } from 'lucide-react';

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

const INTENT_OPTIONS: { value: string | null; label: string; icon: typeof Lightbulb }[] = [
  { value: null, label: '全部', icon: MessageCircle },
  { value: 'ideate', label: '构思', icon: Lightbulb },
  { value: 'execute', label: '执行', icon: Zap },
  { value: 'review', label: '评审', icon: Eye },
  { value: 'progress', label: '进度', icon: BarChart3 },
  { value: 'general', label: '通用', icon: MessageCircle },
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
      <div className="px-4 py-1.5 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
        <span className="text-[11px] text-[hsl(var(--text-tertiary))]">{messageCount} 条消息</span>
        {messageCount >= 20 && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="text-[11px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] transition-colors inline-flex items-center gap-1"
          >
            筛选 <ChevronDown className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[hsl(var(--bg-app))] border border-[hsl(var(--border))] rounded-[var(--radius-sm)] min-w-[100px]">
        <Search className="w-3 h-3 text-[hsl(var(--text-tertiary))] shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => updateFilter({ search: e.target.value })}
          placeholder="搜索…"
          className="bg-transparent text-[11px] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none w-full"
        />
      </div>

      <div className="flex gap-1 items-center">
        <span className="text-[11px] text-[hsl(var(--text-tertiary))]">意图:</span>
        {INTENT_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => updateFilter({ intent: opt.value })}
              className={cn(
                'text-[11px] px-2 py-1 rounded-full border transition-colors inline-flex items-center gap-1',
                intent === opt.value
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))]',
              )}
            >
              <Icon className="w-3 h-3" />
              {opt.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => updateFilter({ userOnly: !userOnly })}
        className={cn(
          'text-[11px] px-2 py-1 rounded-full border transition-colors inline-flex items-center gap-1',
          userOnly
            ? 'border-[hsl(var(--agent-owner))] bg-[hsl(var(--agent-owner))]/10 text-[hsl(var(--agent-owner))]'
            : 'border-[hsl(var(--border))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))]',
        )}
      >
        <User className="w-3 h-3" />
        仅用户
      </button>

      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="text-[11px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] ml-auto transition-colors inline-flex items-center gap-1"
      >
        收起 <ChevronUp className="w-3 h-3" />
      </button>
    </div>
  );
}
