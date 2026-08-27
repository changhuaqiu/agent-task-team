'use client';

import { BellRing, CheckCircle2, ChevronRight } from 'lucide-react';
import { useTaskHubStore, type ChatMessage } from '@/store/taskHubStore';

const STATUS_LABELS: Record<string, string> = {
  backlog: '待安排',
  todo: '待处理',
  ready: '已就绪',
  in_progress: '处理中',
  in_review: '评审中',
  done: '已完成',
  blocked: '已阻塞',
  cancelled: '已取消',
};

function extractTaskTitle(message: ChatMessage): string | undefined {
  if (typeof message.metadata?.title === 'string' && message.metadata.title.trim()) {
    return message.metadata.title.trim();
  }
  return message.content.match(/「([^」]+)」/)?.[1];
}

function activitySummary(message: ChatMessage): string {
  const kind = typeof message.metadata?.kind === 'string' ? message.metadata.kind : '';
  const taskTitle = extractTaskTitle(message);
  const subject = taskTitle ? `“${taskTitle}”` : '任务';
  const statusChange = message.content.match(/状态\s+([\w-]+)\s+→\s+([\w-]+)/);

  if (statusChange) {
    const nextStatus = STATUS_LABELS[statusChange[2]] ?? statusChange[2];
    return `${subject}进入${nextStatus}`;
  }
  if (kind === 'task.file_synced') return `${subject}内容已同步`;
  if (message.agentId === 'task-wakeup') {
    const target = message.content.match(/@([\w-]+)/)?.[1];
    return target ? `已提醒 ${target} 接手下一步` : '已提醒团队接手下一步';
  }
  if (typeof message.metadata?.status === 'string') {
    return `${subject} · ${STATUS_LABELS[message.metadata.status] ?? message.metadata.status}`;
  }
  return taskTitle ? `${subject}有新活动` : '系统活动已更新';
}

export function ChatActivityNotice({ message, repeatCount = 1 }: { message: ChatMessage; repeatCount?: number }) {
  const setSelectedTaskId = useTaskHubStore((state) => state.setSelectedTaskId);
  const taskId = message.referencedTaskId
    ?? (typeof message.metadata?.taskId === 'string' ? message.metadata.taskId : undefined);
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const factType = typeof message.metadata?.factType === 'string' ? message.metadata.factType : undefined;
  if (factType) {
    const factLabel = factType === 'work.created' ? '工作已登记'
      : factType === 'review.created' ? '评审已发起'
        : factType === 'review.decision_recorded' ? '评审结论已记录'
          : '事实已确认';
    return (
      <article className="mx-auto flex w-full max-w-3xl items-start gap-2.5 border-l-2 border-emerald-500/50 px-3 py-2" data-testid="command-fact-card">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="size-3.5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-semibold text-emerald-700">{factLabel}</span>
            <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{time}</span>
            <p className="min-w-0 text-[11px] text-[hsl(var(--text-secondary))]">{message.content}</p>
          </div>
          {taskId && <button type="button" onClick={() => setSelectedTaskId(taskId)} className="mt-1 text-[10px] font-medium text-[hsl(var(--accent))] hover:underline">打开工作</button>}
        </div>
      </article>
    );
  }

  return (
    <div className="flex justify-center" data-testid="chat-activity-notice">
      <details className="group max-w-[88%] rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] open:rounded-xl">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-[10px] [&::-webkit-details-marker]:hidden">
          <BellRing className="h-3 w-3 shrink-0 text-[hsl(var(--text-tertiary))]" />
          <span className="min-w-0 truncate font-medium">{activitySummary(message)}</span>
          {repeatCount > 1 && <span className="shrink-0 rounded-full bg-[hsl(var(--bg-card))] px-1.5 py-0.5 text-[9px]">×{repeatCount}</span>}
          <span className="shrink-0 text-[9px] text-[hsl(var(--text-tertiary))]">{time}</span>
          <ChevronRight className="h-3 w-3 shrink-0 text-[hsl(var(--text-tertiary))] transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-[hsl(var(--border-subtle))] px-3 py-2 text-[10px] leading-relaxed text-[hsl(var(--text-tertiary))]">
          <p className="whitespace-pre-wrap">{message.content}</p>
          {taskId && (
            <button
              type="button"
              onClick={() => setSelectedTaskId(taskId)}
              className="mt-2 font-medium text-[hsl(var(--accent))] hover:underline"
            >
              查看工作项
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
