'use client';

import { type TaskStatus, STATUS_LABELS } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import {
  Clock,
  Play,
  Eye,
  CheckCircle2,
  XCircle,
  ShieldAlert,
} from 'lucide-react';

const statusConfig: Record<
  TaskStatus,
  { icon: typeof Clock; dotClass: string; badgeClass: string }
> = {
  pending: {
    icon: Clock,
    dotClass: 'bg-[hsl(var(--status-pending))]',
    badgeClass:
      'bg-[hsl(var(--status-pending-bg))] text-[hsl(var(--status-pending))] border-[hsl(var(--status-pending-border))]',
  },
  in_progress: {
    icon: Play,
    dotClass: 'bg-[hsl(var(--status-progress))] animate-pulse-dot',
    badgeClass:
      'bg-[hsl(var(--status-progress-bg))] text-[hsl(var(--status-progress))] border-[hsl(var(--status-progress-border))]',
  },
  in_review: {
    icon: Eye,
    dotClass: 'bg-[hsl(var(--status-review))]',
    badgeClass:
      'bg-[hsl(var(--status-review-bg))] text-[hsl(var(--status-review))] border-[hsl(var(--status-review-border))]',
  },
  done: {
    icon: CheckCircle2,
    dotClass: 'bg-[hsl(var(--status-done))]',
    badgeClass:
      'bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))] border-[hsl(var(--status-done-border))]',
  },
  rejected: {
    icon: XCircle,
    dotClass: 'bg-[hsl(var(--status-rejected))]',
    badgeClass:
      'bg-[hsl(var(--status-rejected-bg))] text-[hsl(var(--status-rejected))] border-[hsl(var(--status-rejected-border))]',
  },
  blocked: {
    icon: ShieldAlert,
    dotClass: 'bg-[hsl(var(--status-blocked))]',
    badgeClass:
      'bg-[hsl(var(--status-blocked-bg))] text-[hsl(var(--status-blocked))] border-[hsl(var(--status-blocked-border))]',
  },
};

interface StatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
  showIcon?: boolean;
}

export function StatusBadge({
  status,
  size = 'sm',
  showIcon = false,
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border font-medium tracking-wider uppercase whitespace-nowrap rounded-sm',
        config.badgeClass,
        size === 'sm' && 'px-2 py-0.5 text-xs',
        size === 'md' && 'px-2.5 py-1 text-xs'
      )}
    >
      {showIcon ? (
        <Icon className={cn('shrink-0', size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
      ) : (
        <span
          className={cn(
            'shrink-0 rounded-[2px]',
            config.dotClass,
            size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
          )}
        />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}
