'use client';

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, Paperclip, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from '@/store/taskHubStore';
import type { AgentTheme } from '@/store/agentStore';

const themeBorder: Record<AgentTheme, string> = {
  mario: 'border-l-[hsl(var(--agent-mario))]',
  luigi: 'border-l-[hsl(var(--agent-luigi))]',
  toad: 'border-l-[hsl(var(--agent-toad))]',
  peach: 'border-l-[hsl(var(--agent-peach))]',
  dk: 'border-l-[hsl(var(--agent-dk))]',
  yoshi: 'border-l-[hsl(var(--agent-yoshi))]',
};

function themeFromAgentId(agentId: string): AgentTheme {
  const map: Record<string, AgentTheme> = {
    mario: 'mario', luigi: 'luigi', toad: 'toad',
    peach: 'peach', dk: 'dk', yoshi: 'yoshi',
  };
  return map[agentId] ?? 'mario';
}


interface KanbanCardProps {
  task: Task;
  theme?: AgentTheme;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function KanbanCard({ task, theme, onClick, onContextMenu }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const resolvedTheme = theme ?? themeFromAgentId(task.agentId);
  const isUnassigned = !task.agentId || task.agentId === '-';
  const isMuted = task.status === 'blocked' || task.status === 'rejected';

  const hasFileArtifact = task.artifacts?.some((a) => a.type === 'file' || a.type === 'pr' || a.type === 'log');
  const hasLinkArtifact = task.artifacts?.some((a) => a.type === 'link');
  const hasDeps = task.dependencies && task.dependencies.length > 0;
  const hasBottomRow = true;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative flex flex-col gap-1 rounded-md border bg-[hsl(var(--bg-card))] p-2.5 transition-colors duration-150',
        'cursor-grab active:cursor-grabbing select-none',
        !isUnassigned ? `border-l-3 ${themeBorder[resolvedTheme]}` : 'border-l-3 border-l-[hsl(var(--border-subtle))]',
        isMuted && 'bg-[hsl(var(--bg-muted))] opacity-80',
        isDragging && 'opacity-50',
      )}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-testid={`kanban-card-${task.id}`}
    >
      {/* Phase tag — only show non-empty */}
      {task.phaseId && task.phaseId !== '-' && (
        <span className="absolute top-1.5 right-1.5 inline-flex items-center rounded-[var(--radius-sm)] bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--text-tertiary))]">
          {task.phaseId}
        </span>
      )}

      {/* ID + Title */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] font-mono text-[hsl(var(--text-tertiary))] shrink-0">
          {task.id}
        </span>
        <h4 className="line-clamp-2 text-xs font-medium leading-snug text-[hsl(var(--text-primary))]">
          {task.title}
        </h4>
      </div>

      {/* Bottom row — only render if there's content */}
      {hasBottomRow && (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-[hsl(var(--text-tertiary))]">
          {isUnassigned ? (
            <span className="font-medium text-[hsl(var(--text-secondary))]">Unassigned</span>
          ) : (
            <span className="font-medium text-[hsl(var(--text-secondary))]">@{task.agentId}</span>
          )}

          {hasDeps && (
            <span className="inline-flex items-center gap-0.5">
              <ChevronRight size={10} className="size-2.5" />
              {task.dependencies.length}
            </span>
          )}

          {hasFileArtifact && (
            <span title="file" className="inline-flex items-center">
              <Paperclip size={10} className="size-2.5" />
            </span>
          )}
          {hasLinkArtifact && (
            <span title="link" className="inline-flex items-center">
              <ExternalLink size={10} className="size-2.5" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
