'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Search, Lightbulb, Zap, Eye, BarChart3, MessageCircle, User, SlidersHorizontal, X } from 'lucide-react';

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
  const [collapsed, setCollapsed] = useState(true);

  const updateFilter = (partial: Partial<ChatFilter>) => {
    const next = { search, intent, userOnly, ...partial };
    setSearch(next.search);
    setIntent(next.intent);
    setUserOnly(next.userOnly);
    onFilterChange(next as ChatFilter);
  };

  useEffect(() => {
    onFilterChange({ search: '', intent: null, agentId: null, userOnly: false });
  }, [onFilterChange]);

  if (messageCount < 20) return null;

  if (collapsed) {
    return (
      <div className="flex justify-end px-1 pb-1">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="搜索和筛选消息"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[hsl(var(--text-tertiary))] transition-colors hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))]"
        >
          <SlidersHorizontal className="size-3.5" />
          搜索与筛选
        </button>
      </div>
    );
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-2">
      <div className="flex min-w-[160px] flex-1 items-center gap-1.5 rounded-lg bg-[hsl(var(--bg-card))] px-2.5 py-2">
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
        <span className="text-[10px] text-[hsl(var(--text-tertiary))]">类型</span>
        {INTENT_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => updateFilter({ intent: opt.value })}
              className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] transition-colors',
                intent === opt.value
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                  : 'border-transparent text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--text-primary))]',
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
          'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] transition-colors',
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
        aria-label="收起搜索和筛选"
        className="ml-auto flex size-7 items-center justify-center rounded-lg text-[hsl(var(--text-tertiary))] transition-colors hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--text-primary))]"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
