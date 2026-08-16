'use client';

import { AlertTriangle, CheckCircle2, CircleDot } from 'lucide-react';
import type { DeliveryAttentionItem } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

const KIND_META = {
  escalation: { label: '需要决策', icon: AlertTriangle, className: 'text-[hsl(var(--status-blocked))]' },
  manual: { label: '需要处理', icon: CircleDot, className: 'text-[hsl(var(--status-pending))]' },
} as const;

export function DeliveryAttentionSection({
  items,
  onSelectTask,
}: {
  items: DeliveryAttentionItem[];
  onSelectTask: (taskId: string) => void;
}) {
  const visibleItems = items.slice(0, 6);
  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-3 py-2.5">
        <div>
          <h3 className="text-xs font-semibold text-[hsl(var(--text-primary))]">需要关注</h3>
          <p className="mt-0.5 text-[10px] text-[hsl(var(--text-tertiary))]">只显示需要你补充信息、选择或授权的事项</p>
        </div>
        <span className="text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">{items.length}</span>
      </div>
      {visibleItems.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-[hsl(var(--text-tertiary))]">
          <CheckCircle2 className="size-3.5 text-[hsl(var(--status-done))]" />当前没有需要处理的事项
        </div>
      ) : (
        <div className="divide-y divide-[hsl(var(--border-subtle))]">
          {visibleItems.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            return (
              <button key={item.id} type="button" disabled={!item.taskId} onClick={() => item.taskId && onSelectTask(item.taskId)}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--bg-card-hover))]">
                <Icon className={`mt-0.5 size-3.5 shrink-0 ${meta.className}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--text-primary))]">
                    <span className="shrink-0 text-[10px] text-[hsl(var(--text-tertiary))]">{meta.label}</span>
                    <span className="truncate font-medium">{item.title}</span>
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-[10px] text-[hsl(var(--text-tertiary))]">{item.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {items.length > visibleItems.length && (
        <div className="border-t border-[hsl(var(--border-subtle))] px-3 py-2 text-center text-[10px] text-[hsl(var(--text-tertiary))]">
          还有 {items.length - visibleItems.length} 项，可在任务视图中查看
        </div>
      )}
    </section>
  );
}
