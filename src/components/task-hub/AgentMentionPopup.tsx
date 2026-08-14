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
  const activeAgentIds = useTaskHubStore((s) => s.activeAgentIds);
  const effectiveRoster = useTaskHubStore((s) => s.getEffectiveRoster());
  const getAgentRoleCard = useTaskHubStore((s) => s.getAgentRoleCard);

  const activeAgents = effectiveRoster.filter((a) => activeAgentIds.includes(a.id));

  // Extract the search text after @
  const textBeforeCursor = inputValue.slice(0, cursorPosition);
  const atMatch = textBeforeCursor.match(/@([\w\u4e00-\u9fff-]*)$/);
  const query = atMatch ? atMatch[1].toLowerCase() : '';

  const filtered = activeAgents.filter((agent) => {
    const roleCard = getAgentRoleCard(agent.id);
    const displayName = roleCard?.displayName || '';
    return (
      agent.name.toLowerCase().includes(query) ||
      agent.id.toLowerCase().includes(query) ||
      displayName.toLowerCase().includes(query)
    );
  });

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
    <div className="absolute bottom-full left-0 mb-1 z-50 min-w-[200px]">
      <div className="border-2 border-[hsl(var(--text-primary))] rounded-[4px] bg-[hsl(var(--bg-elevated))] shadow-[3px_3px_0px_hsl(var(--text-primary))] overflow-hidden">
        <div className="px-2 py-1 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))]">
          <span className="text-[9px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
            选择 Agent
          </span>
        </div>
        <div className="py-1 max-h-[180px] overflow-y-auto scrollbar-thin">
          {filtered.map((agent, i) => {
            const roleCard = getAgentRoleCard(agent.id);
            const displayName = roleCard?.displayName || '';

            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelect(agent.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                  i === selectedIndex
                    ? 'bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                    : 'text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))]'
                )}
              >
                <span className="text-[13px]">{agent.emoji}</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold">{agent.name}</span>
                  {displayName && (
                    <span className="text-[9px] text-[hsl(var(--text-tertiary))] truncate">
                      {displayName}
                    </span>
                  )}
                </div>
                <span className="ml-auto text-[9px] font-mono text-[hsl(var(--text-tertiary))]">
                  @{agent.id}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
