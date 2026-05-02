'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTaskHubStore, AGENT_ROSTER } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';

interface AgentMentionPopupProps {
  inputValue: string;
  cursorPosition: number;
  onSelect: (mention: string) => void;
  onClose: () => void;
}

export function AgentMentionPopup({ inputValue, cursorPosition, onSelect, onClose }: AgentMentionPopupProps) {
  const activeAgentIds = useTaskHubStore((s) => s.activeAgentIds);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const activeAgents = AGENT_ROSTER.filter((a) => activeAgentIds.includes(a.id));

  // Extract the search text after @
  const textBeforeCursor = inputValue.slice(0, cursorPosition);
  const atMatch = textBeforeCursor.match(/@(\w*)$/);
  const query = atMatch ? atMatch[1].toLowerCase() : '';

  const filtered = activeAgents.filter((agent) => {
    const roleCard = agent.roleCardId
      ? roleCards.find((c) => c.id === agent.roleCardId)
      : null;
    const displayName = roleCard?.displayName || '';
    return (
      agent.name.toLowerCase().includes(query) ||
      agent.id.toLowerCase().includes(query) ||
      displayName.toLowerCase().includes(query)
    );
  });

  const handleSelect = useCallback((index: number) => {
    const agent = filtered[index];
    if (!agent) return;
    onSelect(agent.id);
  }, [filtered, onSelect]);

  // Reset selected index when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelect(selectedIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, selectedIndex, handleSelect, onClose]);

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
            const roleCard = agent.roleCardId
              ? roleCards.find((c) => c.id === agent.roleCardId)
              : null;
            const displayName = roleCard?.displayName || '';

            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => handleSelect(i)}
                onMouseEnter={() => setSelectedIndex(i)}
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
