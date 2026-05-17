'use client';

import { GitMerge, GitPullRequestArrow, Handshake, PauseCircle, PlayCircle, RotateCcw, Split, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TaskActionCardRef {
  id: string;
  actionType: string;
  taskIds: string[];
  actorAgentId?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

interface TaskActionCardProps {
  action: TaskActionCardRef;
  onSelectTask?: (taskId: string) => void;
  className?: string;
}

const ACTION_META: Record<string, { label: string; tone: string; Icon: typeof Split }> = {
  'task.created': {
    label: '新任务入场',
    tone: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-600',
    Icon: GitPullRequestArrow,
  },
  'task.split': {
    label: '任务分身术',
    tone: 'border-blue-400/50 bg-blue-500/10 text-blue-600',
    Icon: Split,
  },
  'task.claimed': {
    label: '任务认领',
    tone: 'border-sky-400/50 bg-sky-500/10 text-sky-600',
    Icon: GitPullRequestArrow,
  },
  'task.status_changed': {
    label: '状态变化',
    tone: 'border-slate-400/50 bg-slate-500/10 text-slate-600',
    Icon: PlayCircle,
  },
  'task.artifact_attached': {
    label: '产出入袋',
    tone: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-600',
    Icon: GitPullRequestArrow,
  },
  'task.review_requested': {
    label: '请求审查',
    tone: 'border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-600',
    Icon: GitPullRequestArrow,
  },
  'task.merge_requested': {
    label: '请求合并',
    tone: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-600',
    Icon: GitMerge,
  },
  'task.merged': {
    label: '任务合体',
    tone: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-600',
    Icon: GitMerge,
  },
  'task.handoff_requested': {
    label: '请求接力',
    tone: 'border-violet-400/50 bg-violet-500/10 text-violet-600',
    Icon: Handshake,
  },
  'task.handoff_accepted': {
    label: '接力成功',
    tone: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-600',
    Icon: Handshake,
  },
  'task.blocked': {
    label: '任务卡住了',
    tone: 'border-amber-400/60 bg-amber-500/10 text-amber-700',
    Icon: PauseCircle,
  },
  'task.resumed': {
    label: '任务继续跑',
    tone: 'border-lime-400/50 bg-lime-500/10 text-lime-700',
    Icon: PlayCircle,
  },
  'task.reopened': {
    label: '任务重开',
    tone: 'border-orange-400/50 bg-orange-500/10 text-orange-600',
    Icon: RotateCcw,
  },
  'task.cancelled': {
    label: '任务退场',
    tone: 'border-gray-400/50 bg-gray-500/10 text-gray-600',
    Icon: XCircle,
  },
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function lineageLabel(action: TaskActionCardRef): string {
  if (action.actionType === 'task.merged') {
    const sourceTaskIds = stringArray(action.payload?.sourceTaskIds);
    const targetTaskId = stringValue(action.payload?.targetTaskId) ?? action.taskIds[action.taskIds.length - 1];
    if (sourceTaskIds.length > 0 && targetTaskId) {
      return `${sourceTaskIds.join('、')} → ${targetTaskId}`;
    }
  }

  if (action.actionType === 'task.split' && action.taskIds.length > 1) {
    const [rootTaskId, ...childTaskIds] = action.taskIds;
    return `${rootTaskId} → ${childTaskIds.join('、')}`;
  }

  return action.taskIds.join('、');
}

export function TaskActionCard({ action, onSelectTask, className }: TaskActionCardProps) {
  const meta = ACTION_META[action.actionType] ?? {
    label: '任务动态',
    tone: 'border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))]',
    Icon: GitPullRequestArrow,
  };
  const { Icon } = meta;
  const lineage = lineageLabel(action);

  return (
    <div
      className={cn(
        'rounded-[4px] border px-2.5 py-2 text-[11px] shadow-[var(--shadow-sm)]',
        meta.tone,
        className,
      )}
      data-action-id={action.id}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-bold">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span>{meta.label}</span>
          {action.actorAgentId && (
            <span className="truncate text-[10px] font-semibold opacity-75">@{action.actorAgentId}</span>
          )}
        </div>
        {action.createdAt && (
          <time className="shrink-0 text-[9px] opacity-65">
            {new Date(action.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </time>
        )}
      </div>

      {action.summary && (
        <div className="mt-1 leading-relaxed text-[hsl(var(--text-primary))]">
          {action.summary}
        </div>
      )}

      {lineage && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-[2px] bg-[hsl(var(--bg-card))]/70 px-1.5 py-0.5 font-mono text-[10px]">
            {lineage}
          </span>
          {action.taskIds.map((taskId) => (
            <button
              key={taskId}
              type="button"
              onClick={() => onSelectTask?.(taskId)}
              className="rounded-[2px] border border-current/20 bg-[hsl(var(--bg-card))]/50 px-1.5 py-0.5 text-[9px] font-bold hover:bg-[hsl(var(--bg-card))]"
              aria-label={`查看 ${taskId}`}
            >
              查看 {taskId}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
