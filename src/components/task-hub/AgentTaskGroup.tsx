'use client';

import { useState, useMemo } from 'react';
import {
  STATUS_ORDER,
} from '@/store/taskHubStore';
import { Agent, useTaskHubStore } from '@/store/taskHubStore';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, LogOut, Settings } from 'lucide-react';
import { PixelAvatar } from './PixelAvatar';
import { AgentBindingPanel } from './AgentBindingPanel';
import { RoleCardBadge } from '@/components/role-card/RoleCardBadge';

/* ---- Agent theme map → CSS variable families ---- */
const themeStyles = {
  mario: {
    headerBg: 'bg-[hsl(var(--agent-mario-soft))]',
    headerBorder: 'border-[hsl(var(--agent-mario-border))]',
    avatarBg: 'bg-[hsl(var(--agent-mario))]',
    countBg: 'bg-[hsl(var(--agent-mario-soft))]',
    countText: 'text-[hsl(var(--agent-mario))]',
    countBorder: 'border-[hsl(var(--agent-mario-border))]',
  },
  luigi: {
    headerBg: 'bg-[hsl(var(--agent-luigi-soft))]',
    headerBorder: 'border-[hsl(var(--agent-luigi-border))]',
    avatarBg: 'bg-[hsl(var(--agent-luigi))]',
    countBg: 'bg-[hsl(var(--agent-luigi-soft))]',
    countText: 'text-[hsl(var(--agent-luigi))]',
    countBorder: 'border-[hsl(var(--agent-luigi-border))]',
  },
  toad: {
    headerBg: 'bg-[hsl(var(--agent-toad-soft))]',
    headerBorder: 'border-[hsl(var(--agent-toad-border))]',
    avatarBg: 'bg-[hsl(var(--agent-toad))]',
    countBg: 'bg-[hsl(var(--agent-toad-soft))]',
    countText: 'text-[hsl(var(--agent-toad))]',
    countBorder: 'border-[hsl(var(--agent-toad-border))]',
  },
  peach: {
    headerBg: 'bg-[hsl(var(--agent-peach-soft))]',
    headerBorder: 'border-[hsl(var(--agent-peach-border))]',
    avatarBg: 'bg-[hsl(var(--agent-peach))]',
    countBg: 'bg-[hsl(var(--agent-peach-soft))]',
    countText: 'text-[hsl(var(--agent-peach))]',
    countBorder: 'border-[hsl(var(--agent-peach-border))]',
  },
  dk: {
    headerBg: 'bg-[hsl(var(--agent-dk-soft))]',
    headerBorder: 'border-[hsl(var(--agent-dk-border))]',
    avatarBg: 'bg-[hsl(var(--agent-dk))]',
    countBg: 'bg-[hsl(var(--agent-dk-soft))]',
    countText: 'text-[hsl(var(--agent-dk))]',
    countBorder: 'border-[hsl(var(--agent-dk-border))]',
  },
  yoshi: {
    headerBg: 'bg-[hsl(var(--agent-yoshi-soft))]',
    headerBorder: 'border-[hsl(var(--agent-yoshi-border))]',
    avatarBg: 'bg-[hsl(var(--agent-yoshi))]',
    countBg: 'bg-[hsl(var(--agent-yoshi-soft))]',
    countText: 'text-[hsl(var(--agent-yoshi))]',
    countBorder: 'border-[hsl(var(--agent-yoshi-border))]',
  },
} as const;

interface AgentTaskGroupProps {
  agent: Agent;
}

export function AgentTaskGroup({ agent }: AgentTaskGroupProps) {
  const allTasks = useTaskHubStore((s) => s.tasks);
  const dismissAgent = useTaskHubStore((s) => s.dismissAgent);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const tasks = useMemo(
    () => allTasks.filter((t) => t.agentId === agent.id),
    [allTasks, agent.id]
  );

  const [isDoneCollapsed, setIsDoneCollapsed] = useState(true);
  const [showBinding, setShowBinding] = useState(false);

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
          {agent.roleCardId ? (
            <div className="mt-0.5">
              <RoleCardBadge card={roleCards.find((c) => c.id === agent.roleCardId)!} size="sm" />
            </div>
          ) : (
            <p className="text-[11px] text-[hsl(var(--text-secondary))] truncate">
              {agent.roleLabel}
            </p>
          )}
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

          <button
            onClick={() => setShowBinding(!showBinding)}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              showBinding
                ? "text-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))]"
                : "text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-muted))]"
            )}
            title="账号绑定"
          >
            <Settings className={cn("w-3.5 h-3.5 transition-transform", showBinding && "rotate-90")} />
          </button>

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
        {showBinding && (
          <AgentBindingPanel agentId={agent.id} agentName={agent.name} />
        )}

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
