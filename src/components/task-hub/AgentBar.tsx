'use client';

import { useState, useRef, useEffect } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { AgentBindingPanel } from '@/components/task-hub/AgentBindingPanel';
import { cn } from '@/lib/utils';

export function AgentBar() {
  const accounts = useTaskHubStore((s) => s.accounts);
  const setRosterModalOpen = useTaskHubStore((s) => s.setRosterModalOpen);
  const tasks = useTaskHubStore((s) => s.tasks);
  const activeAgents = useTaskHubStore((s) => s.getAddressableRoster());
  const getAgentRuntimeProfile = useTaskHubStore((s) => s.getAgentRuntimeProfile);

  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close expanded panel when clicking outside
  useEffect(() => {
    if (!expandedAgent) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpandedAgent(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedAgent]);

  if (activeAgents.length === 0) return null;

  return (
    <div ref={containerRef} className="px-4 py-1.5">
      <div className="flex min-h-7 items-center gap-1.5 overflow-x-auto">
        {activeAgents.map((agent) => {
          const profile = getAgentRuntimeProfile(agent.id);
          const boundIds = profile?.agent.accountIds ?? agent.accountIds ?? [];
          const boundCount = boundIds.length;
          const hasValidAccount = boundIds.some((id) => {
            const acc = accounts.find((a) => a.id === id);
            return acc?.status === 'valid';
          });
          const accountStatusLabel = hasValidAccount
            ? '账号已验证'
            : boundCount > 0
              ? '账号待验证'
              : '使用运行环境的登录状态';
          const isExpanded = expandedAgent === agent.id;
          const currentTask = tasks.find((t: { agentId: string; status: string }) => t.agentId === agent.id && t.status === 'in_progress');

          return (
            <div key={agent.id} className="relative">
              <button
                type="button"
                onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2 transition-colors',
                  isExpanded
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))]'
                    : currentTask
                      ? 'border-blue-300 bg-blue-50 hover:border-blue-400 dark:border-blue-900 dark:bg-blue-950/30'
                      : 'border-transparent bg-transparent hover:bg-[hsl(var(--bg-muted))]',
                )}
              >
                {/* Emoji avatar */}
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-[11px]',
                    'bg-[hsl(var(--bg-muted))]',
                  )}
                >
                  {agent.emoji}
                </span>

                <div className="flex items-center leading-none">
                  <span className="text-[10px] font-medium text-[hsl(var(--text-primary))]">
                    {agent.name}
                  </span>
                </div>

                {currentTask && (
                  <span className="max-w-[100px] truncate text-[9px] text-blue-600 dark:text-blue-300">
                    正在处理 · {currentTask.title}
                  </span>
                )}

                {/* Account status dot */}
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    currentTask ? 'bg-blue-400 animate-pulse' : hasValidAccount ? 'bg-emerald-400' : boundCount > 0 ? 'bg-amber-400' : 'bg-zinc-400',
                  )}
                  title={currentTask ? `执行中: ${currentTask.title}` : accountStatusLabel}
                />
              </button>

              {/* Expanded binding panel */}
              {isExpanded && (
                <div className="absolute left-0 top-full mt-1 z-30 w-[280px]">
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-lg">
                    <AgentBindingPanel agentId={agent.id} />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Recruit button */}
        <button
          type="button"
          onClick={() => setRosterModalOpen(true)}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[hsl(var(--text-tertiary))] transition-colors hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))]"
        >
          <span className="text-[11px]">+</span>
          <span className="text-[10px] font-medium">管理 Agent</span>
        </button>
      </div>
    </div>
  );
}
