'use client';

import type { RoleCard } from '@/types/roleCard';
import { RoleCardBadge, getCategoryConfig } from './RoleCardBadge';
import { cn } from '@/lib/utils';

export function RoleCardSummary({ card }: { card: RoleCard }) {
  const cfg = getCategoryConfig(card.category);
  const topResp = card.responsibilities.slice(0, 3);

  return (
    <div className="space-y-1.5">
      <RoleCardBadge card={card} size="md" />
      <p className="text-[11px] text-[hsl(var(--text-secondary))] leading-tight">
        {card.description}
      </p>
      {topResp.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {topResp.map((r) => (
            <span
              key={r}
              className={cn(
                'text-[9px] px-1.5 py-0.5 rounded-[2px] border',
                `border-[hsl(var(${cfg.themeVar}))] bg-[hsl(var(${cfg.themeVar}-soft))] text-[hsl(var(${cfg.themeVar}))]`,
              )}
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
