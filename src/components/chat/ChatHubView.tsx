'use client';

import { useMemo } from 'react';
import { ConversationPicker } from '@/components/war-room/ConversationPicker';
import { Timeline } from '@/components/war-room/Timeline';
import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { StatusBadge } from '@/components/task-hub/StatusBadge';
import { STATUS_LABELS, type TaskStatus, useTaskHubStore } from '@/store/taskHubStore';

const statOrder: TaskStatus[] = ['blocked', 'rejected', 'in_progress', 'in_review', 'pending', 'done'];

export function ChatHubView() {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const selectedConversation = useTaskHubStore((s) => s.getSelectedConversation());
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.getOpenBlockersForSelectedConversation());
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);

  const tasksForConversation = useMemo(() => {
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
    for (const t of tasksForConversation) map[t.status]++;
    return map;
  }, [tasksForConversation]);

  const recentTasks = useMemo(() => {
    return [...tasksForConversation]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 6);
  }, [tasksForConversation]);

  return (
    <div className="flex-1 h-full overflow-hidden">
      <div className="h-full overflow-hidden p-6">
        <div className="h-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="min-h-0 flex flex-col gap-4 overflow-hidden">
            <ConversationPicker />
            <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
              <GlobalChatRoom />
            </div>
          </div>

          <div className="hidden lg:flex min-h-0 flex-col gap-4 overflow-hidden">
            <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
              <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                战役摘要
              </div>
              <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))] mt-1">
                {selectedConversation?.title || '请选择/创建会话'}
              </div>
              <div className="text-[12px] text-[hsl(var(--text-tertiary))] mt-1">
                {selectedConversation?.goal || 'Chat-First：先定义目标，再发指令。'}
              </div>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
              <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                进度
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {statOrder.map((s) => (
                  <div key={s} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] px-3 py-2">
                    <span className="text-[11px] font-semibold text-[hsl(var(--text-secondary))]">{STATUS_LABELS[s]}</span>
                    <span className="text-[11px] font-bold tabular-nums text-[hsl(var(--text-primary))]">{counts[s]}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[11px] text-[hsl(var(--text-tertiary))] font-medium tabular-nums">
                {tasksForConversation.length} 个任务
              </div>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
              <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                最新任务
              </div>
              {recentTasks.length === 0 ? (
                <div className="text-[12px] text-[hsl(var(--text-tertiary))] mt-2">
                  还没有任务。你可以在对话里写：TASK: 标题 @jean
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {recentTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTaskId(t.id)}
                      className="text-left rounded-[var(--radius-md)] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] px-3 py-2 hover:bg-[hsl(var(--bg-card-hover))]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono font-bold text-[hsl(var(--text-tertiary))] tracking-wider">
                            {t.id}
                          </div>
                          <div className="text-[12px] font-semibold text-[hsl(var(--text-primary))] truncate">
                            {t.title}
                          </div>
                        </div>
                        <StatusBadge status={t.status} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm overflow-hidden min-h-0 flex flex-col">
              <div className="shrink-0 p-4 border-b border-[hsl(var(--border-subtle))]">
                <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                  时间线
                </div>
              </div>
              <div className="min-h-0 overflow-y-auto p-4 scrollbar-thin">
                <Timeline />
              </div>
            </div>

            {blockers.length > 0 && (
              <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
                <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--danger))]">
                  阻塞项
                </div>
                <div className="mt-2 text-[12px] font-semibold text-[hsl(var(--text-primary))]">
                  {blockers.filter((b) => b.status === 'open').length} 个未解决
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

