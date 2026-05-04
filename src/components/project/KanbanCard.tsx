'use client';

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, Paperclip, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, TaskArtifact } from '@/store/taskHubStore';
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

const artifactIcon: Record<TaskArtifact['type'], React.ReactNode> = {
  file: <Paperclip size={12} className="size-3" />,
  pr: <Paperclip size={12} className="size-3" />,
  log: <Paperclip size={12} className="size-3" />,
  link: <ExternalLink size={12} className="size-3" />,
};

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

  const hasFileArtifact = task.artifacts.some((a) => a.type === 'file' || a.type === 'pr' || a.type === 'log');
  const hasLinkArtifact = task.artifacts.some((a) => a.type === 'link');

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative flex flex-col gap-1 rounded-md border border-l-3 bg-[hsl(var(--bg-card))] p-3 transition-colors duration-150',
        'cursor-grab select-none',
        themeBorder[resolvedTheme],
        isMuted && 'bg-[hsl(var(--bg-muted))] opacity-80',
        isDragging && 'opacity-50',
      )}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-testid={`kanban-card-${task.id}`}
    >
      {/* Phase tag */}
      {task.phaseId && (
        <span className="absolute top-2 right-2 inline-flex items-center rounded-sm bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 text-xs font-medium text-[hsl(var(--text-secondary))]">
          {task.phaseId}
        </span>
      )}

      {/* Title */}
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-mono font-medium text-[hsl(var(--text-tertiary))] tracking-wider">
          {task.id}
        </span>
      </div>
      <h4 className="line-clamp-2 text-sm font-medium leading-snug text-[hsl(var(--text-primary))]">
        {task.title}
      </h4>

      {/* Bottom row */}
      <div className="mt-auto flex items-center gap-2 text-xs text-[hsl(var(--text-secondary))]">
        {/* Agent */}
        {isUnassigned ? (
          <span className="italic">Unassigned</span>
        ) : (
          <span>@{task.agentId}</span>
        )}

        {/* Dependencies */}
        {task.dependencies.length > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <ChevronRight size={12} className="size-3" />
            {task.dependencies.length}
          </span>
        )}

        {/* Artifact icons */}
        {hasFileArtifact && (
          <span title="file" className="inline-flex items-center">
            <Paperclip size={12} className="size-3" />
          </span>
        )}
        {hasLinkArtifact && (
          <span title="link" className="inline-flex items-center">
            <ExternalLink size={12} className="size-3" />
          </span>
        )}
      </div>
    </div>
  );
}
