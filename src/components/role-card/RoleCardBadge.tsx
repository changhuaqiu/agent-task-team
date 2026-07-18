'use client';

import type { RoleCard, RoleCardCategory } from '@/types/roleCard';
import { cn } from '@/lib/utils';

const CATEGORY_CONFIG: Record<RoleCardCategory, { emoji: string; themeVar: string; label: string }> = {
  planner:       { emoji: '⭐', themeVar: '--agent-mario',  label: '规划' },
  frontend:      { emoji: '⚡', themeVar: '--agent-luigi',  label: '前端' },
  // backend/qa 在 4 人组里由 luigi（全栈）和 peach（评审+测试）承担；
  // toad/yoshi 已随 team-simplification 删除，不再有独立 agent（issue #36/#34）。
  backend:       { emoji: '⚡', themeVar: '--agent-luigi',  label: '后端' },
  code_reviewer: { emoji: '🌸', themeVar: '--agent-peach',  label: '评审' },
  arch_reviewer: { emoji: '⚙️', themeVar: '--agent-dk',     label: '架构' },
  qa:            { emoji: '🌸', themeVar: '--agent-peach',  label: '质检' },
};

export function getCategoryConfig(category: RoleCardCategory) {
  return CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.planner;
}

export function RoleCardBadge({
  card,
  size = 'sm',
}: {
  card: RoleCard;
  size?: 'sm' | 'md';
}) {
  const cfg = getCategoryConfig(card.category);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5',
        'border-2 border-[hsl(var(--text-primary))] shadow-[2px_2px_0px_hsl(var(--text-primary))]',
        `bg-[hsl(var(${cfg.themeVar}-soft))]`,
        size === 'sm' ? 'text-[10px]' : 'text-[11px]',
      )}
    >
      <span className="text-[10px]">{cfg.emoji}</span>
      <span className="font-bold text-[hsl(var(--text-primary))]">{card.displayName}</span>
    </span>
  );
}
