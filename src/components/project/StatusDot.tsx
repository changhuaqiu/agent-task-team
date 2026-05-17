'use client';

import { Circle, Check, AlertTriangle, XCircle } from 'lucide-react';
import type { ProjectHealth } from './getProjectStatus';

const STATUS_CONFIG: Record<ProjectHealth, { icon: typeof Circle; bgVar: string; borderVar: string; fgVar: string }> = {
  empty:     { icon: Circle,        bgVar: '--bg-muted',           borderVar: '--border-subtle',       fgVar: '--text-tertiary' },
  healthy:   { icon: Check,         bgVar: '--status-done-bg',     borderVar: '--status-done-border',  fgVar: '--status-done' },
  attention: { icon: AlertTriangle,  bgVar: '--status-pending-bg', borderVar: '--status-pending-border', fgVar: '--status-pending' },
  blocked:   { icon: XCircle,       bgVar: '--status-blocked-bg',  borderVar: '--status-blocked-border', fgVar: '--status-blocked' },
};

export function StatusPill({ health }: { health: ProjectHealth }) {
  const config = STATUS_CONFIG[health];
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-[hsl(var(${config.bgVar}))] border-[hsl(var(${config.borderVar}))] text-[hsl(var(${config.fgVar}))]`}
    >
      <Icon className="w-3 h-3" />
    </span>
  );
}
