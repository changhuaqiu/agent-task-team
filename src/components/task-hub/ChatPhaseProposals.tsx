'use client';

import { useMemo, useRef, useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import type { PhaseProposal } from '@/lib/breakdownParser';
import type { Agent } from '@/store/agentStore';
import { createWorkspaceCommandIdempotencyKey } from '@/lib/workspace-command';

interface ChatPhaseProposalsProps {
  proposals: PhaseProposal[];
  allAgents: Agent[];
}

export function ChatPhaseProposals({ proposals, allAgents }: ChatPhaseProposalsProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string>();
  const confirmIntent = useRef<{ idempotencyKey: string; issuedAt: string } | undefined>(undefined);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    proposals.forEach((phase, pi) => {
      phase.tasks.forEach((_, ti) => keys.add(`${pi}-${ti}`));
    });
    return keys;
  });

  const toggleCheck = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredProposals = useMemo(() => {
    return proposals.map((phase, pi) => ({
      ...phase,
      tasks: phase.tasks.filter((_, ti) => checkedKeys.has(`${pi}-${ti}`)),
    })).filter((p) => p.tasks.length > 0);
  }, [proposals, checkedKeys]);

  const totalChecked = filteredProposals.reduce((sum, p) => sum + p.tasks.length, 0);

  return (
    <div className="mt-3 pt-2 border-t border-dashed border-[hsl(var(--border-subtle))] flex flex-col gap-2">
      {proposals.map((phase, pi) => (
        <div key={pi} className="rounded-[4px] border-2 border-[hsl(var(--border))] overflow-hidden">
          <div className="px-3 py-1.5 bg-[hsl(var(--bg-muted))] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold bg-[hsl(var(--accent))] text-white px-1.5 py-0.5 rounded-[2px]">
                阶段 {pi + 1}
              </span>
              <span className="text-[11px] font-bold text-[hsl(var(--text-primary))]">{phase.title}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const keys = new Set(checkedKeys);
                  phase.tasks.forEach((_, ti) => keys.add(`${pi}-${ti}`));
                  setCheckedKeys(keys);
                }}
                className="text-[9px] text-[hsl(var(--accent))] hover:underline"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => {
                  const keys = new Set(checkedKeys);
                  phase.tasks.forEach((_, ti) => keys.delete(`${pi}-${ti}`));
                  setCheckedKeys(keys);
                }}
                className="text-[9px] text-[hsl(var(--text-tertiary))] hover:underline"
              >
                全不选
              </button>
            </div>
          </div>
          <div className="px-2 py-1.5 flex flex-col gap-1">
            {phase.tasks.map((task, ti) => {
              const key = `${pi}-${ti}`;
              const isChecked = checkedKeys.has(key);
              const suggestedAgent = task.agentId ? allAgents.find((a) => a.id === task.agentId) : undefined;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 rounded-[2px] border transition-colors",
                    isChecked
                      ? "bg-[hsl(var(--bg-app))] border-[hsl(var(--border-subtle))]"
                      : "bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))] opacity-50"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleCheck(key)}
                    className={cn(
                      "w-5 h-5 rounded-[2px] border-2 flex items-center justify-center shrink-0 transition-all",
                      isChecked
                        ? "bg-[hsl(var(--accent))] border-[hsl(var(--accent))] text-white"
                        : "bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))]"
                    )}
                  >
                    {isChecked && <Check className="w-3 h-3" />}
                  </button>
                  <span className="text-[10px] text-[hsl(var(--text-primary))] flex-1 truncate">{task.title}</span>
                  {suggestedAgent && (
                    <span className="text-[9px] text-[hsl(var(--text-tertiary))] shrink-0">
                      {suggestedAgent.emoji} {suggestedAgent.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex gap-2 mt-1">
        <button
          type="button"
          disabled={totalChecked === 0 || confirming}
          onClick={async () => {
            const convId = useTaskHubStore.getState().selectedConversationId;
            if (!convId) return;
            confirmIntent.current ??= {
              idempotencyKey: createWorkspaceCommandIdempotencyKey(`${convId}:breakdown.confirm`),
              issuedAt: new Date().toISOString(),
            };
            setConfirming(true);
            setConfirmError(undefined);
            try {
              await useTaskHubStore.getState().confirmBreakdown(
                convId,
                filteredProposals,
                confirmIntent.current,
              );
              confirmIntent.current = undefined;
            } catch (error) {
              setConfirmError(error instanceof Error ? error.message : '工作拆解确认失败');
            } finally {
              setConfirming(false);
            }
          }}
          className="flex-1 py-1.5 text-[10px] font-bold bg-[hsl(var(--accent))] text-white border-2 border-[hsl(var(--accent))] rounded-[2px] shadow-[2px_2px_0px_hsl(var(--accent)/0.4)] hover:shadow-[1px_1px_0px_hsl(var(--accent)/0.4)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {confirming ? '正在确认…' : `✓ 确认选中 (${totalChecked} 个任务)`}
        </button>
        <button
          type="button"
          onClick={() => {
            const convId = useTaskHubStore.getState().selectedConversationId;
            if (!convId) return;
            useTaskHubStore.getState().triggerProposal(convId);
          }}
          className="py-1.5 px-3 text-[10px] font-bold text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[2px] hover:text-[hsl(var(--text-primary))] transition-colors"
        >
          重新出方案
        </button>
      </div>
      {confirmError && (
        <p role="alert" className="text-[10px] text-red-600">{confirmError}</p>
      )}
    </div>
  );
}
