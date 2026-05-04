'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useTaskHubStore, type Task } from '@/store/taskHubStore';
import { MiniKanban } from './MiniKanban';
import { cn } from '@/lib/utils';
import { GripHorizontal } from 'lucide-react';

type NextItem = {
  label: string;
  taskId?: string;
};

function buildNextItems(tasks: Task[]): NextItem[] {
  const items: NextItem[] = [];

  for (const t of tasks) {
    if (t.status === 'blocked') items.push({ label: `解除阻塞：${t.id} ${t.title}`, taskId: t.id });
  }
  for (const t of tasks) {
    if (t.status === 'in_review') items.push({ label: `等待评审：${t.id} ${t.title}`, taskId: t.id });
  }
  for (const t of tasks) {
    if (t.status === 'pending') items.push({ label: `可开始：${t.id} ${t.title}`, taskId: t.id });
  }

  return items.slice(0, 6);
}

export function ProjectRightPanel() {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.getOpenBlockersForSelectedConversation());
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);

  // Kanban drawer: draggable height
  const [kanbanHeight, setKanbanHeight] = useState(320);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onHandleDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startH.current = kanbanHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [kanbanHeight]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientY - startY.current;
      setKanbanHeight(Math.min(800, Math.max(160, startH.current + delta)));
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const isExpanded = kanbanHeight > 400;

  const scoped = useMemo(() => {
    if (!selectedConversationId) return [];
    return tasks.filter((t) => t.conversationId === selectedConversationId);
  }, [selectedConversationId, tasks]);

  const nextItems = useMemo(() => buildNextItems(scoped), [scoped]);
  const openBlockers = useMemo(() => blockers.filter((b) => b.status === 'open'), [blockers]);

  return (
    <aside className="w-[320px] shrink-0 h-full border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] flex flex-col">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 flex flex-col gap-0">
        {/* Kanban drawer with drag handle */}
        <div style={{ height: kanbanHeight }} className="shrink-0 overflow-hidden">
          <MiniKanban expanded={isExpanded} />
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onHandleDown}
          className="flex items-center justify-center h-3 cursor-row-resize group"
        >
          <GripHorizontal className="w-5 h-3 text-[hsl(var(--text-tertiary))] group-hover:text-[hsl(var(--text-primary))] transition-colors" />
        </div>

        {/* Next actions */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
          <div className="p-3 border-b border-[hsl(var(--border-subtle))]">
            <div className="text-xs font-medium tracking-wider uppercase text-[hsl(var(--text-tertiary))]">
              代办
            </div>
          </div>
          <div className="p-3 flex flex-col gap-2">
            {nextItems.length === 0 ? (
              <div className="text-xs text-[hsl(var(--text-tertiary))] p-2">
                暂无代办。
              </div>
            ) : (
              nextItems.map((it, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => it.taskId && setSelectedTaskId(it.taskId)}
                  className={cn(
                    'text-left rounded-sm border px-3 py-2 transition-colors',
                    'bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))]',
                    'border-[hsl(var(--border-subtle))]'
                  )}
                >
                  <div className="text-xs text-[hsl(var(--text-primary))]">
                    {it.label}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Blockers */}
        <div className="mt-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
          <div className="p-3 border-b border-[hsl(var(--border-subtle))]">
            <div className="text-xs font-medium tracking-wider uppercase text-[hsl(var(--danger))]">
              风险 / 阻塞
            </div>
            <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">
              {openBlockers.length} 个未解决
            </div>
          </div>
          <div className="p-3 flex flex-col gap-2">
            {openBlockers.length === 0 ? (
              <div className="text-xs text-[hsl(var(--text-tertiary))] p-2">
                暂无风险项。
              </div>
            ) : (
              openBlockers.slice(0, 6).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedTaskId(b.taskId)}
                  className={cn(
                    'text-left rounded-sm border px-3 py-2 transition-colors',
                    'bg-[hsl(var(--status-rejected-bg))] hover:bg-[hsl(var(--bg-card-hover))]',
                    'border-[hsl(var(--status-rejected-border))]'
                  )}
                >
                  <div className="text-xs text-[hsl(var(--text-primary))]">
                    {b.taskId} · {b.reasonSummary}
                  </div>
                  {b.evidenceRef && (
                    <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">
                      {b.evidenceRef}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
