'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { RoleCardBadge } from './RoleCardBadge';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RoleCardBindingSelector({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const setAgentRoleCardId = useTaskHubStore((s) => s.setAgentRoleCardId);
  const getEffectiveRoster = useTaskHubStore((s) => s.getEffectiveRoster);

  const agent = getEffectiveRoster().find((a) => a.id === agentId);
  if (!agent) return null;

  const currentCardId = agent.roleCardId;

  const handleSelect = (cardId: string) => {
    setAgentRoleCardId(agentId, cardId);
    onClose();
  };

  return (
    <div className="space-y-2">
      {roleCards.map((card) => {
        const isSelected = card.id === currentCardId;
        return (
          <button
            key={card.id}
            onClick={() => handleSelect(card.id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border text-left transition-all',
              isSelected
                ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))]'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] hover:border-[hsl(var(--ring))]'
            )}
          >
            <RoleCardBadge card={card} size="md" />
            <span className="flex-1 text-[11px] text-[hsl(var(--text-secondary))] truncate">
              {card.description}
            </span>
            {isSelected && (
              <Check className="w-4 h-4 text-[hsl(var(--accent))] shrink-0" />
            )}
          </button>
        );
      })}
    </div>
  );
}
