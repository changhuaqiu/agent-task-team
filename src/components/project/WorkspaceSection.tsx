'use client';

import { ReactNode } from 'react';
import { ChevronRight, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

export function WorkspaceSection({
  name,
  fullPath,
  count,
  collapsed,
  onToggle,
  children,
}: {
  name: string;
  fullPath: string | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        title={fullPath ?? undefined}
        className={cn(
          'flex items-center gap-1.5 px-4 py-1.5 text-left transition-colors w-full',
          'hover:bg-[hsl(var(--bg-card-hover))] group/header'
        )}
      >
        <ChevronRight
          className={cn(
            'w-3 h-3 shrink-0 text-[hsl(var(--text-tertiary))] transition-transform duration-[var(--duration-fast)]',
            !collapsed && 'rotate-90'
          )}
        />
        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--text-tertiary))]" />
        <span className="text-[11px] font-semibold text-[hsl(var(--text-secondary))] truncate min-w-0">
          {name}
        </span>
        <span className="text-[10px] text-[hsl(var(--text-tertiary))] tabular-nums ml-auto shrink-0">
          {count}
        </span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-px pb-1">
          {children}
        </div>
      )}
    </div>
  );
}
