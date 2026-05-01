'use client';

import {
  type Task,
  type AgentTheme,
  useTaskHubStore,
} from '@/store/taskHubStore';
import { StatusBadge } from './StatusBadge';
import { cn } from '@/lib/utils';
import {
  FileText,
  GitPullRequest,
  FileWarning,
  ExternalLink,
  Link2,
  MessageSquareWarning,
} from 'lucide-react';

const artifactIcons = {
  file: FileText,
  pr: GitPullRequest,
  log: FileWarning,
  link: ExternalLink,
};

/* ---- border-left accent per agent theme ---- */
const themeAccent: Record<AgentTheme, string> = {
  jean:   'border-l-[hsl(var(--agent-jean))]',
  keqing: 'border-l-[hsl(var(--agent-keqing))]',
  zhongli:'border-l-[hsl(var(--agent-zhongli))]',
  nahida: 'border-l-[hsl(var(--agent-nahida))]',
  albedo: 'border-l-[hsl(var(--agent-albedo))]',
  venti:  'border-l-[hsl(var(--agent-venti))]',
};

interface TaskCardProps {
  task: Task;
  agentTheme: AgentTheme;
}

export function TaskCard({ task, agentTheme }: TaskCardProps) {
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const isDone = task.status === 'done';
  const hasDeps = task.dependencies.length > 0;
  const hasArtifacts = task.artifacts.length > 0;

  return (
    <button
      type="button"
      onClick={() => setSelectedTaskId(task.id)}
      className={cn(
        'group relative flex flex-col text-left w-full rounded-[var(--radius-md)] border border-l-[3px] p-3.5 transition-all',
        'bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-card-hover))]',
        'shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)]',
        'cursor-pointer outline-none',
        'duration-200 ease-[var(--ease-out)]',
        'animate-fade-in',
        themeAccent[agentTheme],
        isDone && 'opacity-55',
        !isDone && 'border-[hsl(var(--border))]'
      )}
      aria-label={`Task ${task.id}: ${task.title}`}
    >
      {/* Top row: ID + Status */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-mono font-bold text-[hsl(var(--text-tertiary))] tracking-wider">
          {task.id}
        </span>
        <StatusBadge status={task.status} />
      </div>

      {/* Title */}
      <h4
        className={cn(
          'text-[13px] font-semibold leading-snug text-[hsl(var(--text-primary))] mb-1',
          isDone && 'line-through text-[hsl(var(--text-tertiary))]'
        )}
      >
        {task.title}
      </h4>

      {/* Description */}
      <p
        className={cn(
          'text-[11px] leading-relaxed text-[hsl(var(--text-secondary))] line-clamp-2 mb-2',
          isDone && 'line-through opacity-70'
        )}
      >
        {task.description}
      </p>

      {/* Review Note (if rejected/in_review) */}
      {task.reviewNote && (task.status === 'rejected' || task.status === 'in_review') && (
        <div className="flex items-start gap-1.5 mb-2 p-2 rounded-[var(--radius-sm)] bg-[hsl(var(--status-rejected-bg))] border border-[hsl(var(--status-rejected-border))]">
          <MessageSquareWarning className="w-3 h-3 shrink-0 mt-0.5 text-[hsl(var(--status-rejected))]" />
          <p className="text-[10px] leading-relaxed text-[hsl(var(--status-rejected))]">
            {task.reviewNote}
          </p>
        </div>
      )}

      {/* Footer: Dependencies + Artifacts */}
      {(hasDeps || hasArtifacts) && (
        <div className="flex items-center gap-3 pt-2 mt-auto border-t border-[hsl(var(--border-subtle))]">
          {/* Dependencies */}
          {hasDeps && (
            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]">
              <Link2 className="w-3 h-3" />
              <span>
                {task.dependencies.length} dep{task.dependencies.length > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Artifacts */}
          {hasArtifacts && (
            <div className="flex items-center gap-1.5">
              {task.artifacts.map((art, i) => {
                const Icon = artifactIcons[art.type];
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 rounded-[var(--radius-sm)]"
                    title={art.label}
                  >
                    <Icon className="w-3 h-3" />
                    {art.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </button>
  );
}
