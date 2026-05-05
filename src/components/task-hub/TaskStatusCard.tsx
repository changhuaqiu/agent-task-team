'use client';

import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { Agent, AgentTheme } from '@/store/agentStore';

interface TaskStatusCardProps {
  taskId: string;
  agentId: string;
  title: string;
  status: string;
  timestamp: string;
}

const AGENT_COLORS: Record<string, string> = {
  mario: 'var(--agent-opus)',
  luigi: 'var(--agent-codex)',
  toad: 'var(--agent-gemini)',
  peach: 'var(--agent-owner)',
  dk: 'var(--agent-opus)',
  yoshi: 'var(--agent-codex)',
};

export function TaskStatusCard({ taskId, agentId, title, status, timestamp }: TaskStatusCardProps) {
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const getEffectiveRoster = useTaskHubStore((s) => s.getEffectiveRoster);
  const agent = getEffectiveRoster().find((a) => a.id === agentId);
  const emoji = agent?.emoji || '🤖';
  const borderColor = AGENT_COLORS[agentId] || 'var(--border)';
  const timeStr = timestamp
    ? new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <button
      type="button"
      onClick={() => setSelectedTaskId(taskId)}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border-l-2 bg-card px-3 py-2 text-left',
        'transition-opacity opacity-0 animate-in fade-in duration-150',
        'hover:bg-muted cursor-pointer',
      )}
      style={{ borderLeftColor: borderColor }}
    >
      <span className="text-sm">
        {emoji} {agentId}
      </span>
      <span className="flex-1 truncate text-sm font-medium">{taskId}: {title}</span>
      <StatusBadge status={status as any} size="sm" />
      <span className="text-xs text-muted-foreground">{timeStr}</span>
    </button>
  );
}
