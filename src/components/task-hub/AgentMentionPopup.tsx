'use client';

import { useEffect } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';

interface AgentMentionPopupProps {
  inputValue: string;
  cursorPosition: number;
  selectedIndex: number;
  onSelect: (mention: string) => void;
  onClose: () => void;
}

export function AgentMentionPopup({ inputValue, cursorPosition, selectedIndex, onSelect, onClose }: AgentMentionPopupProps) {
  const activeAgents = useTaskHubStore((s) => s.getAddressableRoster());

  // Extract the search text after @
  const textBeforeCursor = inputValue.slice(0, cursorPosition);
  const atMatch = textBeforeCursor.match(/@([\w\u4e00-\u9fff-]*)$/);
  const query = atMatch ? atMatch[1].toLowerCase() : '';

  const filtered = activeAgents.filter((agent) => (
    agent.name.toLowerCase().includes(query) || agent.id.toLowerCase().includes(query)
  ));

  // Keyboard: only handle Escape here (navigation/select is handled by parent textarea)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && filtered.length > 0) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, onClose]);

  if (filtered.length === 0 || !atMatch) return null;

  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[240px] max-w-[320px]">
      <div className="overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-elevated))] shadow-xl shadow-black/10">
        <div className="border-b border-[hsl(var(--border-subtle))] px-3 py-2">
          <span className="text-[10px] font-medium text-[hsl(var(--text-tertiary))]">
            提及 Agent
          </span>
        </div>
        <div className="max-h-[220px] overflow-y-auto p-1 scrollbar-thin">
          {filtered.map((agent, i) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelect(agent.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  i === selectedIndex
                    ? 'bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                    : 'text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))]'
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--bg-muted))] text-[14px]">{agent.emoji}</span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{agent.name}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[9px] text-[hsl(var(--text-tertiary))]">
                    <span className={cn('size-1.5 rounded-full', agent.isOnline ? 'bg-emerald-500' : 'bg-[hsl(var(--text-tertiary))]')} />
                    {agent.isOnline ? '可用' : '暂不可用'}
                  </span>
                </div>
              </button>
          ))}
        </div>
      </div>
    </div>
  );
}
