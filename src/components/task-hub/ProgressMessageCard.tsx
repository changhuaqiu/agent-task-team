'use client';

import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/store/taskHubStore';

interface ProgressMessageCardProps {
  message: ChatMessage;
  onTaskClick?: (taskId: string) => void;
}

const TYPE_STYLES = {
  start: { border: 'border-blue-500/40', bg: 'bg-blue-500/5', icon: '▶', color: 'text-blue-400' },
  update: { border: 'border-yellow-500/40', bg: 'bg-yellow-500/5', icon: '⟳', color: 'text-yellow-400' },
  complete: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/5', icon: '✓', color: 'text-emerald-400' },
};

export function ProgressMessageCard({ message, onTaskClick }: ProgressMessageCardProps) {
  const data = message.progressData;
  if (!data) return null;

  const style = TYPE_STYLES[data.type];
  if (!style) return null; // 未知 type 不渲染，避免 crash

  return (
    <div className={cn('rounded-[4px] border-2 p-2.5', style.border, style.bg)}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={cn('text-[11px] font-bold', style.color)}>
          {style.icon} {message.content}
        </span>
      </div>

      {data.totalSteps > 0 && (
        <div className="mb-2">
          <div className="h-[3px] bg-[hsl(var(--bg-muted))] rounded-[2px] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[hsl(var(--accent))] to-blue-400 rounded-[2px] transition-all duration-300"
              style={{ width: `${data.totalSteps > 0 ? (data.completedSteps / data.totalSteps) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{data.completedSteps}/{data.totalSteps} 步骤</span>
          </div>
        </div>
      )}

      {data.steps.length > 0 && (
        <div className="space-y-0.5 font-mono text-[10px] leading-relaxed">
          {data.steps.map((step, i) => (
            <div key={i} className={cn(
              step.status === 'done' && 'text-emerald-400',
              step.status === 'in_progress' && 'text-yellow-400',
              step.status === 'pending' && 'text-[hsl(var(--text-tertiary))]',
            )}>
              {step.status === 'done' && '✓ '}
              {step.status === 'in_progress' && '⟳ '}
              {step.status === 'pending' && '○ '}
              {step.label}
            </div>
          ))}
        </div>
      )}

      {data.type === 'complete' && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => onTaskClick?.(data.taskId)}
            className="text-[9px] font-bold px-2 py-1 rounded-[2px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            📋 查看产出
          </button>
          <button
            type="button"
            onClick={() => onTaskClick?.(data.taskId)}
            className="text-[9px] font-bold px-2 py-1 rounded-[2px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            🔍 查看终端
          </button>
        </div>
      )}
    </div>
  );
}
