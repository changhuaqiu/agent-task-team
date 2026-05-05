'use client';

import { useState, useRef, useEffect } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { getCategoryConfig } from '@/components/role-card/RoleCardBadge';
import { AgentBindingPanel } from '@/components/task-hub/AgentBindingPanel';
import { cn } from '@/lib/utils';

export function AgentBar() {
  const activeAgentIds = useTaskHubStore((s) => s.activeAgentIds);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const accounts = useTaskHubStore((s) => s.accounts);
  const setRosterModalOpen = useTaskHubStore((s) => s.setRosterModalOpen);
  const tasks = useTaskHubStore((s) => s.tasks);
  const getEffectiveRoster = useTaskHubStore((s) => s.getEffectiveRoster);

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

  const effectiveRoster = getEffectiveRoster();
  const activeAgents = effectiveRoster.filter((a) => activeAgentIds.includes(a.id));

  if (activeAgents.length === 0) return null;

  return (
    <div ref={containerRef} className="px-4 pt-2 pb-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        {activeAgents.map((agent) => {
          const roleCard = agent.roleCardId
            ? roleCards.find((c) => c.id === agent.roleCardId) ?? null
            : null;
          const cfg = roleCard
            ? getCategoryConfig(roleCard.category)
            : agent.roleLabel
              ? { themeVar: '--color-blue', label: agent.roleLabel }
              : null;
          const boundCount = roleCard?.accountIds.length ?? 0;
          const hasValidAccount = roleCard?.accountIds.some((id) => {
            const acc = accounts.find((a) => a.id === id);
            return acc?.status === 'valid';
          }) ?? false;
          const isExpanded = expandedAgent === agent.id;
          const currentTask = tasks.find((t: { agentId: string; status: string }) => t.agentId === agent.id && t.status === 'in_progress');

          return (
            <div key={agent.id} className="relative">
              <button
                type="button"
                onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-[4px] border-2 transition-all',
                  isExpanded
                    ? 'border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-elevated))] shadow-[2px_2px_0px_hsl(var(--text-primary))]'
                    : currentTask
                      ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_8px_rgba(59,130,246,0.2)] hover:border-blue-400'
                      : cfg
                        ? `border-[hsl(var(${cfg.themeVar})/0.4)] bg-[hsl(var(${cfg.themeVar}-soft)/0.5)] hover:border-[hsl(var(${cfg.themeVar}))]`
                        : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] hover:border-[hsl(var(--text-primary))]',
                )}
              >
                {/* Emoji avatar */}
                <span
                  className={cn(
                    'w-5 h-5 rounded-[2px] flex items-center justify-center text-[11px] border',
                    cfg
                      ? `bg-[hsl(var(${cfg.themeVar}-soft))] border-[hsl(var(${cfg.themeVar})/0.3)]`
                      : 'bg-[hsl(var(--bg-app))] border-[hsl(var(--border))]',
                  )}
                >
                  {agent.emoji}
                </span>

                {/* Name + role */}
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-bold text-[hsl(var(--text-primary))]">
                    {agent.name}
                  </span>
                  {(roleCard || agent.roleLabel) && (
                    <span className={cn(
                      'text-[8px] font-bold tracking-wider uppercase',
                      cfg ? `text-[hsl(var(${cfg.themeVar}))]` : 'text-[hsl(var(--text-tertiary))]',
                    )}>
                      {roleCard ? roleCard.displayName : agent.roleLabel}
                    </span>
                  )}
                </div>

                {currentTask && (
                  <span className="text-[8px] text-blue-400 max-w-[60px] truncate animate-pulse">
                    {currentTask.title}
                  </span>
                )}

                {/* Account status dot */}
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    currentTask ? 'bg-blue-400 animate-pulse' : hasValidAccount ? 'bg-emerald-400' : boundCount > 0 ? 'bg-amber-400' : 'bg-zinc-400',
                  )}
                  title={currentTask ? `执行中: ${currentTask.title}` : hasValidAccount ? '账号已验证' : boundCount > 0 ? '账号待验证' : '未绑定账号'}
                />
              </button>

              {/* Expanded binding panel */}
              {isExpanded && (
                <div className="absolute left-0 top-full mt-1 z-30 w-[280px]">
                  <div className="border-2 border-[hsl(var(--text-primary))] rounded-[4px] bg-[hsl(var(--bg-elevated))] shadow-[3px_3px_0px_hsl(var(--text-primary))]">
                    <AgentBindingPanel agentId={agent.id} agentName={agent.name} />
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
          className="flex items-center gap-1 px-2 py-1 rounded-[4px] border-2 border-dashed border-[hsl(var(--border))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))] hover:text-[hsl(var(--text-primary))] transition-colors"
        >
          <span className="text-[11px]">+</span>
          <span className="text-[10px] font-bold tracking-wider">招募</span>
        </button>
      </div>
    </div>
  );
}
