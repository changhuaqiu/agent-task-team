// src/components/project/StatusDot.tsx
import { cn } from '@/lib/utils';
import type { ProjectHealth } from './getProjectStatus';

const healthColors: Record<ProjectHealth, string> = {
  empty: 'bg-[hsl(var(--text-tertiary)/0.4)]',
  healthy: 'bg-[hsl(var(--status-done))]',
  attention: 'bg-[hsl(var(--status-pending))]',
  blocked: 'bg-[hsl(var(--status-blocked))]',
};

export function StatusDot({ health }: { health: ProjectHealth }) {
  return (
    <span
      className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', healthColors[health])}
      aria-hidden
    />
  );
}
