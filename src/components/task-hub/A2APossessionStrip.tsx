'use client';

import { useState } from 'react';
import { ChevronDown, GitBranch, ShieldAlert, UserRoundCheck } from 'lucide-react';
import { useTaskHubStore, type A2APossessionView } from '@/store/taskHubStore';
import type { Agent } from '@/store/agentStore';
import { cn } from '@/lib/utils';

function agentLabel(agentId: string | undefined, roster: Agent[]) {
  if (!agentId) return '待定';
  if (agentId === 'user' || agentId === 'human') return '用户';
  const agent = roster.find((item) => item.id === agentId);
  return agent ? `${agent.emoji} ${agent.name}` : agentId;
}

function statusLabel(status: A2APossessionView['handoffs'][number]['status']) {
  switch (status) {
    case 'offered':
      return '已发起交接';
    case 'started':
      return '已接球';
    case 'blocked':
      return '交接被阻止';
    case 'timeout':
      return '交接超时';
    case 'completed':
      return '已完成';
    default:
      return status;
  }
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function A2APossessionStrip() {
  const [expanded, setExpanded] = useState(false);
  const a2a = useTaskHubStore((state) => state.getA2AForSelectedConversation());
  const getEffectiveRoster = useTaskHubStore((state) => state.getEffectiveRoster);
  const roster = getEffectiveRoster();

  if (!a2a || a2a.handoffs.length === 0) return null;

  const latest = a2a.handoffs[a2a.handoffs.length - 1];
  const holder = agentLabel(a2a.currentHolderId, roster);
  const from = agentLabel(latest.fromAgentId, roster);
  const to = agentLabel(latest.toAgentId, roster);
  const isBlocked = latest.status === 'blocked' || latest.status === 'timeout';
  const timeline = [...a2a.handoffs].reverse();

  return (
    <div
      className={cn(
        'rounded-[6px] border-2 bg-[hsl(var(--bg-card))] px-3 py-2 shadow-[2px_2px_0px_hsl(var(--border))]',
        isBlocked ? 'border-amber-400/60' : 'border-[hsl(var(--accent))]/40'
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <UserRoundCheck className="w-3.5 h-3.5 text-[hsl(var(--accent))]" />
            <span className="text-[10px] font-bold text-[hsl(var(--text-tertiary))]">当前持球</span>
            <span className="text-[11px] font-bold text-[hsl(var(--text-primary))]">{holder}</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            {isBlocked ? (
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <GitBranch className="w-3.5 h-3.5 text-[hsl(var(--accent))]" />
            )}
            <span className="text-[10px] font-bold text-[hsl(var(--text-tertiary))]">{statusLabel(latest.status)}</span>
            <span className="text-[11px] text-[hsl(var(--text-secondary))] truncate">
              {from} → {to}
            </span>
          </div>
        </div>
        {timeline.length > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="shrink-0 flex items-center gap-1 rounded-[4px] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:border-[hsl(var(--text-primary))]"
            aria-expanded={expanded}
          >
            交接记录 {timeline.length}
            <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      {latest.reason && (
        <div className="mt-1 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
          {latest.reason}
        </div>
      )}
      {expanded && (
        <div className="mt-2 border-t border-[hsl(var(--border-subtle))] pt-2">
          <div className="flex flex-col gap-1.5">
            {timeline.map((handoff, index) => {
              const blocked = handoff.status === 'blocked' || handoff.status === 'timeout';
              return (
                <div
                  key={handoff.id}
                  className="grid grid-cols-[52px_1fr] gap-2 rounded-[4px] bg-[hsl(var(--bg-muted))] px-2 py-1.5"
                >
                  <div className="text-[9px] font-bold tabular-nums text-[hsl(var(--text-tertiary))]">
                    {formatTime(handoff.timestamp)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={cn(
                        'text-[10px] font-bold',
                        blocked ? 'text-amber-500' : index === 0 ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--text-secondary))]'
                      )}>
                        {statusLabel(handoff.status)}
                      </span>
                      <span className="text-[10px] text-[hsl(var(--text-secondary))] truncate">
                        {agentLabel(handoff.fromAgentId, roster)} → {agentLabel(handoff.toAgentId, roster)}
                      </span>
                    </div>
                    {handoff.reason && (
                      <div className="mt-0.5 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
                        {handoff.reason}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
