'use client';

import { useTaskHubStore, selectActiveAgents } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { suggestAgentForTask } from '@/lib/roleRouting';
import { getCategoryConfig } from './RoleCardBadge';
import { cn } from '@/lib/utils';

export function RoleRecommendation({
  title,
  description,
  currentAgentId,
  onAccept,
}: {
  title: string;
  description: string;
  currentAgentId: string;
  onAccept: (agentId: string) => void;
}) {
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const activeAgents = useTaskHubStore(useShallow(selectActiveAgents));

  if (!title.trim()) return null;

  const suggestion = suggestAgentForTask(title, description, roleCards, activeAgents);
  if (!suggestion || suggestion.agentId === currentAgentId) return null;

  const suggestedAgent = activeAgents.find((a) => a.id === suggestion.agentId);
  const suggestedCard = suggestedAgent ? roleCards.find((c) => c.id === suggestedAgent.roleCardId) : null;
  const cfg = suggestedCard ? getCategoryConfig(suggestedCard.category) : null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-[4px] border-2',
        cfg
          ? `border-[hsl(var(${cfg.themeVar}))] bg-[hsl(var(${cfg.themeVar}-soft))]`
          : 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))]',
      )}
    >
      <span className="text-sm">{cfg?.emoji}</span>
      <span className={cn('text-[11px] font-bold', cfg ? `text-[hsl(var(${cfg.themeVar}))]` : 'text-[hsl(var(--accent))]')}>
        {suggestion.reason}
      </span>
      <button
        type="button"
        onClick={() => onAccept(suggestion.agentId)}
        className={cn(
          'ml-auto text-[10px] font-bold px-2 py-0.5 border-2 rounded-[2px] transition-all whitespace-nowrap',
          cfg
            ? `border-[hsl(var(${cfg.themeVar}))] bg-[hsl(var(${cfg.themeVar}))] text-white shadow-[1px_1px_0px_hsl(var(${cfg.themeVar})/0.4)]`
            : 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-white',
        )}
      >
        采纳
      </button>
    </div>
  );
}
