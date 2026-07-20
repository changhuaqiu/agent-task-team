'use client';

import { useMemo } from 'react';
import { useTaskHubStore, type TaskStatus, STATUS_LABELS } from '@/store/taskHubStore';
import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { AgentBar } from '@/components/task-hub/AgentBar';
import { AutonomousDeliveryPanel } from './AutonomousDeliveryPanel';

const order: TaskStatus[] = ['blocked', 'rejected', 'in_progress', 'in_review', 'pending', 'done'];

export function ProjectChatPanel() {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const selectedConversation = useTaskHubStore((s) => s.getSelectedConversation());
  const getEffectiveRoster = useTaskHubStore((s) => s.getEffectiveRoster);
  const tasks = useTaskHubStore((s) => s.tasks);
  const proposalAgent = getEffectiveRoster()[0];
  const proposalAgentName = proposalAgent?.name ?? '当前团队';

  const scoped = useMemo(() => {
    if (!selectedConversationId) return [];
    return tasks.filter((t) => t.conversationId === selectedConversationId);
  }, [selectedConversationId, tasks]);

  const counts = useMemo(() => {
    const map: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      rejected: 0,
      blocked: 0,
    };
    for (const t of scoped) map[t.status]++;
    return map;
  }, [scoped]);

  return (
    <section className="flex-1 min-w-0 h-full bg-[hsl(var(--bg-app))] flex flex-col">
      <div className="px-4 pt-2.5 pb-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]">
        {/* Title row */}
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-[hsl(var(--text-primary))] truncate">
              {selectedConversation?.title || '⚔️ 作战指挥室'}
            </div>
          </div>
          {selectedConversationId && (
            <div className="shrink-0 flex gap-1.5">
              {order.map((s) => counts[s] > 0 && (
                <div
                  key={s}
                  className="flex items-center gap-1 rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-2 py-0.5"
                >
                  <span className="text-[9px] font-semibold text-[hsl(var(--text-tertiary))]">
                    {STATUS_LABELS[s]}
                  </span>
                  <span className="text-[9px] font-bold tabular-nums text-[hsl(var(--text-secondary))]">
                    {counts[s]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {selectedConversation?.goal && (
          <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1 truncate">
            {selectedConversation.goal}
          </div>
        )}
        {selectedConversation?.breakdownStatus === 'no_account' && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="text-[10px] font-bold text-red-400">为 {proposalAgentName} 配置账号后可分析项目</span>
          </div>
        )}
        {selectedConversation?.breakdownStatus === 'proposal' && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-bold text-amber-500">{proposalAgentName} 正在分析项目…</span>
          </div>
        )}
        <AgentBar />
      </div>

      <div className="flex-1 min-h-0">
        {selectedConversationId && (
          <AutonomousDeliveryPanel conversationId={selectedConversationId} />
        )}
        <GlobalChatRoom variant="embedded" />
      </div>
    </section>
  );
}
