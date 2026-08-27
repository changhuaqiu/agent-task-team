'use client';

import { ReactNode } from 'react';
import { ChevronRight, FolderOpen, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function WorkspaceSection({
  name,
  fullPath,
  count,
  collapsed,
  onToggle,
  onCreateDelivery,
  children,
}: {
  name: string;
  fullPath: string | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onCreateDelivery?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'flex items-center px-2 py-1 text-left transition-colors w-full',
          'hover:bg-[hsl(var(--bg-card-hover))] group/header'
        )}
      >
        <button type="button" onClick={onToggle} title={fullPath ?? undefined} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-0.5 text-left">
          <ChevronRight
            className={cn(
              'w-3 h-3 shrink-0 text-[hsl(var(--text-tertiary))] transition-transform duration-[var(--duration-fast)]',
              !collapsed && 'rotate-90'
            )}
          />
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--text-tertiary))]" />
          <span className="text-[11px] font-semibold text-[hsl(var(--text-secondary))] truncate min-w-0">{name}</span>
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">{count}</span>
        </button>
        {onCreateDelivery && fullPath && (
          <button type="button" onClick={onCreateDelivery} className="flex size-7 shrink-0 items-center justify-center rounded-md text-[hsl(var(--text-tertiary))] opacity-70 hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))] group-hover/header:opacity-100" aria-label={`在 ${name} 中开始一项工作`} title="开始一项工作">
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-px pb-1">
          {count === 0 ? (
            <button type="button" onClick={onCreateDelivery} className="mx-4 my-1 rounded-md border border-dashed border-[hsl(var(--border))] px-3 py-2 text-left text-[11px] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]">
              开始第一项工作
            </button>
          ) : children}
        </div>
      )}
    </div>
  );
}
