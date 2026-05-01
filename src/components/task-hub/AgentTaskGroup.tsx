'use client';

import { useState, useMemo } from 'react';
import {
  STATUS_ORDER,
} from '@/store/taskHubStore';
import { Agent, useTaskHubStore } from '@/store/taskHubStore';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, LogOut } from 'lucide-react';
import { PixelAvatar } from './PixelAvatar';

/* ---- Agent theme map → CSS variable families ---- */
const themeStyles = {
  jean: {
    headerBg: 'bg-[hsl(var(--agent-jean-soft))]',
    headerBorder: 'border-[hsl(var(--agent-jean-border))]',
    avatarBg: 'bg-[hsl(var(--agent-jean))]',
    countBg: 'bg-[hsl(var(--agent-jean-soft))]',
    countText: 'text-[hsl(var(--agent-jean))]',
    countBorder: 'border-[hsl(var(--agent-jean-border))]',
  },
  keqing: {
    headerBg: 'bg-[hsl(var(--agent-keqing-soft))]',
    headerBorder: 'border-[hsl(var(--agent-keqing-border))]',
    avatarBg: 'bg-[hsl(var(--agent-keqing))]',
    countBg: 'bg-[hsl(var(--agent-keqing-soft))]',
    countText: 'text-[hsl(var(--agent-keqing))]',
    countBorder: 'border-[hsl(var(--agent-keqing-border))]',
  },
  zhongli: {
    headerBg: 'bg-[hsl(var(--agent-zhongli-soft))]',
    headerBorder: 'border-[hsl(var(--agent-zhongli-border))]',
    avatarBg: 'bg-[hsl(var(--agent-zhongli))]',
    countBg: 'bg-[hsl(var(--agent-zhongli-soft))]',
    countText: 'text-[hsl(var(--agent-zhongli))]',
    countBorder: 'border-[hsl(var(--agent-zhongli-border))]',
  },
  nahida: {
    headerBg: 'bg-[hsl(var(--agent-nahida-soft))]',
    headerBorder: 'border-[hsl(var(--agent-nahida-border))]',
    avatarBg: 'bg-[hsl(var(--agent-nahida))]',
    countBg: 'bg-[hsl(var(--agent-nahida-soft))]',
    countText: 'text-[hsl(var(--agent-nahida))]',
    countBorder: 'border-[hsl(var(--agent-nahida-border))]',
  },
  albedo: {
    headerBg: 'bg-[hsl(var(--agent-albedo-soft))]',
    headerBorder: 'border-[hsl(var(--agent-albedo-border))]',
    avatarBg: 'bg-[hsl(var(--agent-albedo))]',
    countBg: 'bg-[hsl(var(--agent-albedo-soft))]',
    countText: 'text-[hsl(var(--agent-albedo))]',
    countBorder: 'border-[hsl(var(--agent-albedo-border))]',
  },
  venti: {
    headerBg: 'bg-[hsl(var(--agent-venti-soft))]',
    headerBorder: 'border-[hsl(var(--agent-venti-border))]',
    avatarBg: 'bg-[hsl(var(--agent-venti))]',
    countBg: 'bg-[hsl(var(--agent-venti-soft))]',
    countText: 'text-[hsl(var(--agent-venti))]',
    countBorder: 'border-[hsl(var(--agent-venti-border))]',
  },
} as const;

interface AgentTaskGroupProps {
  agent: Agent;
}

export function AgentTaskGroup({ agent }: AgentTaskGroupProps) {
  const allTasks = useTaskHubStore((s) => s.tasks);
  const dismissAgent = useTaskHubStore((s) => s.dismissAgent);
  const tasks = useMemo(
    () => allTasks.filter((t) => t.agentId === agent.id),
    [allTasks, agent.id]
  );

  const [isDoneCollapsed, setIsDoneCollapsed] = useState(true);

  const handleDismiss = () => {
    if (tasks.length > 0) {
      alert(`无法移除 ${agent.name}：仍有 ${tasks.length} 个未完成任务，请先重新分配。`);
      return;
    }
    dismissAgent(agent.id);
  };

  // 1. Group tasks by status order
  const sortedActive = useMemo(() => {
    return tasks
      .filter((t) => t.status !== 'done')
      .sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      );
  }, [tasks]);

  const doneTasks = useMemo(
    () => tasks.filter((t) => t.status === 'done'),
    [tasks]
  );

  const activeCount = sortedActive.length;
  const theme = themeStyles[agent.theme];

  return (
    <div className="flex flex-col w-[340px] shrink-0 rounded-[var(--radius-xl)] bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] shadow-[var(--shadow-md)] h-[calc(100vh-10rem)] animate-slide-in-u">
      {/* ── Agent Header ── */}
      <div
        className={cn(
          'flex items-center gap-3 p-4 rounded-t-[var(--radius-xl)] border-b',
          theme.headerBg,
          theme.headerBorder
        )}
      >
        {/* Avatar */}
        <div className="relative">
          <div
            className={cn(
              'w-9 h-9 rounded-[4px] flex items-center justify-center text-white text-sm font-bold shadow-sm overflow-hidden',
              theme.avatarBg
            )}
          >
            <PixelAvatar theme={agent.theme} size={36} />
          </div>
          {/* Online indicator */}
          <div
            className={cn(
              'absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-[2px] border-2 border-[hsl(var(--bg-card))]',
              agent.isOnline ? 'bg-[hsl(var(--status-done))]' : 'bg-[hsl(var(--text-tertiary))]'
            )}
          />
        </div>

        {/* Name & Role */}
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-bold text-[hsl(var(--text-primary))] truncate flex items-center gap-1.5">
            {agent.emoji} {agent.name}
          </h3>
          <p className="text-[11px] text-[hsl(var(--text-secondary))] truncate">
            {agent.roleLabel}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Task count */}
          <span
            className={cn(
              'text-[11px] font-bold px-2 py-0.5 rounded-full border',
              theme.countBg,
              theme.countText,
              theme.countBorder
            )}
          >
            {activeCount}
          </span>

          {/* Dismiss Button */}
          <button
            onClick={handleDismiss}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              "text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-rejected))]",
              "hover:bg-[hsl(var(--status-rejected))]/10"
            )}
            title={`移除 ${agent.name}`}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Task List ── */}
      <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto p-3 scrollbar-thin">
        {sortedActive.map((task) => (
          <TaskCard key={task.id} task={task} agentTheme={agent.theme} />
        ))}

        {/* Done section (collapsible) */}
        {doneTasks.length > 0 && (
          <div className="mt-1 pt-2 border-t border-[hsl(var(--border-subtle))]">
            <button
              type="button"
              onClick={() => setIsDoneCollapsed(!isDoneCollapsed)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-secondary))] w-full mb-1.5 transition-colors duration-150"
            >
              {isDoneCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              已完成（{doneTasks.length}）
            </button>
            {!isDoneCollapsed && (
              <div className="flex flex-col gap-2.5 mt-1">
                {doneTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    agentTheme={agent.theme}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-[hsl(var(--text-tertiary))]">
            <div className="w-8 h-8 mb-2 opacity-40 rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))]" />
            <span className="text-[12px] font-medium">暂无分配任务</span>
            <span className="text-[10px] mt-0.5 opacity-60">该智能体正在待命…</span>
          </div>
        )}
      </div>
    </div>
  );
}
