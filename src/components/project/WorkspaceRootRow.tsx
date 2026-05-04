// src/components/project/WorkspaceRootRow.tsx
'use client';

import { ChevronRight, FolderOpen, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/store/taskHubStore';
import { getWorkspaceName, getWorkspaceFullPath } from './getWorkspaceName';

export function WorkspaceRootRow({
  conversations,
  expanded,
  onToggle,
  onCreateProject,
}: {
  conversations: Conversation[];
  expanded: boolean;
  onToggle: () => void;
  onCreateProject: () => void;
}) {
  const name = getWorkspaceName(conversations);
  const fullPath = getWorkspaceFullPath(conversations);
  const count = conversations.length;

  return (
    <div className="px-3 py-3 border-b border-[hsl(var(--border-subtle))]">
      <div
        className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 cursor-pointer select-none hover:bg-[hsl(var(--bg-card-hover))] transition-colors duration-[var(--duration-fast)]"
        onClick={onToggle}
        title={fullPath ?? undefined}
      >
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 shrink-0 text-[hsl(var(--text-tertiary))] transition-transform duration-[var(--duration-fast)]',
            expanded && 'rotate-90'
          )}
        />
        <FolderOpen className="w-4 h-4 shrink-0 text-[hsl(var(--text-tertiary))]" />
        <span className="text-[13px] font-medium text-[hsl(var(--text-primary))] truncate min-w-0">
          {name}
        </span>
        {count > 0 && (
          <span className="text-[11px] text-[hsl(var(--text-tertiary))] ml-auto shrink-0 tabular-nums">
            {count}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateProject();
          }}
          className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors duration-[var(--duration-fast)]"
          title="新建项目"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
