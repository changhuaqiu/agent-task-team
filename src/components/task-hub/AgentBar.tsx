'use client';

import { useState } from 'react';
import { useTaskHubStore, AGENT_ROSTER } from '@/store/taskHubStore';
import { getCategoryConfig } from '@/components/role-card/RoleCardBadge';
import { AgentBindingPanel } from '@/components/task-hub/AgentBindingPanel';
import { cn } from '@/lib/utils';

export function AgentBar() {
  const activeAgentIds = useTaskHubStore((s) => s.activeAgentIds);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const accounts = useTaskHubStore((s) => s.accounts);
  const setRosterModalOpen = useTaskHubStore((s) => s.setRosterModalOpen);

  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const activeAgents = AGENT_ROSTER.filter((a) => activeAgentIds.includes(a.id));

  if (activeAgents.length === 0) return null;

  return (
    <div className="px-4 pt-2 pb-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        {activeAgents.map((agent) => {
          const roleCard = agent.roleCardId
            ? roleCards.find((c) => c.id === agent.roleCardId)
            : null;
          const cfg = roleCard ? getCategoryConfig(roleCard.category) : null;
          const boundCount = roleCard?.accountIds.length ?? 0;
          const hasValidAccount = roleCard?.accountIds.some((id) => {
            const acc = accounts.find((a) => a.id === id);
            return acc?.status === 'valid';
          }) ?? false;
          const isExpanded = expandedAgent === agent.id;

          return (
            <div key={agent.id} className="relative">
              <button
                type="button"
                onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-[4px] border-2 transition-all',
                  isExpanded
                    ? 'border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-elevated))] shadow-[2px_2px_0px_hsl(var(--text-primary))]'
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
                  {roleCard && (
                    <span className={cn(
                      'text-[8px] font-bold tracking-wider uppercase',
                      cfg ? `text-[hsl(var(${cfg.themeVar}))]` : 'text-[hsl(var(--text-tertiary))]',
                    )}>
                      {roleCard.displayName}
                    </span>
                  )}
                </div>

                {/* Account status dot */}
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    hasValidAccount ? 'bg-emerald-400' : boundCount > 0 ? 'bg-amber-400' : 'bg-zinc-400',
                  )}
                  title={hasValidAccount ? '账号已验证' : boundCount > 0 ? '账号待验证' : '未绑定账号'}
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
