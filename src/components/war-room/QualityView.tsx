'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { useMemo } from 'react';

export function QualityView() {
  const blockers = useTaskHubStore((s) => s.getOpenBlockersForSelectedConversation());
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);

  const openBlockers = useMemo(() => blockers.filter((b) => b.status === 'open'), [blockers]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
          <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
            Blockers
          </div>
          <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
            {openBlockers.length} open
          </div>
        </div>

        {openBlockers.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm text-[12px] text-[hsl(var(--text-tertiary))] font-semibold">
            No blockers.
          </div>
        ) : (
          openBlockers.map((b) => (
            <button
              key={b.id}
              type="button"
              className="text-left rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm hover:bg-[hsl(var(--bg-app))]"
              onClick={() => setSelectedTaskId(b.taskId)}
            >
              <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--danger))]">
                {b.type.replace(/_/g, ' ')}
              </div>
              <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
                {b.taskId} · {b.reasonSummary}
              </div>
              <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
                {new Date(b.createdAt).toLocaleString()}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
