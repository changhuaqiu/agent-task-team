'use client';

import type { Blocker, InternalEvent, PlatformNoticeEnvelope } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';

const OUTPUT_KIND_LABELS: Record<string, string> = {
  decision_brief: '决策简报',
  execution_plan: '执行计划',
  status_report: '状态报告',
  quality_review_pack: '质量评审包',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  'run.started': '开始执行',
  'run.finished': '执行结束',
  'run.background_waiting': '后台等待',
  'task.status_changed': '任务状态变更',
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toISOString().replace('T', ' ').replace('.000Z', 'Z');
  } catch {
    return iso;
  }
}

export function PlatformNoticeCard({ notice }: { notice: PlatformNoticeEnvelope }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
            {OUTPUT_KIND_LABELS[notice.kind] ?? notice.kind.replace(/_/g, ' ')}
          </div>
          <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))]">
            {notice.summary}
          </div>
          <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
            {formatTime(notice.timestamp)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BlockerCard({ blocker }: { blocker: Blocker }) {
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  return (
    <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--danger))]">
            阻塞项
          </div>
          <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
            {blocker.reasonSummary}
          </div>
          <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
            {formatTime(blocker.createdAt)}
          </div>
        </div>
        <button
          type="button"
          className="h-8 px-3 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[12px] font-semibold"
          onClick={() => setSelectedTaskId(blocker.taskId)}
        >
          打开任务
        </button>
      </div>
    </div>
  );
}

export function EventCard({ event }: { event: InternalEvent }) {
  if (event.type === 'platform.notice') {
    return <PlatformNoticeCard notice={event.payload as PlatformNoticeEnvelope} />;
  }
  if (event.type === 'blocker.opened') {
    return <BlockerCard blocker={event.payload as Blocker} />;
  }

  if (event.type === 'task.status_changed') {
    const payload = event.payload as { taskId?: string; status?: string };
    return (
      <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
        <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
          {EVENT_TYPE_LABELS[event.type] ?? '任务状态'}
        </div>
        <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
          {payload.taskId} → {payload.status}
        </div>
        <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
          {formatTime(event.timestamp)}
        </div>
      </div>
    );
  }

  if (event.type === 'run.started' || event.type === 'run.finished') {
    const payload = event.payload as { runId?: string; agentId?: string; taskId?: string; code?: number };
    return (
      <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
        <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
          {EVENT_TYPE_LABELS[event.type] ?? '执行'}
        </div>
        <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
          {(EVENT_TYPE_LABELS[event.type] ?? event.type)} {payload.taskId ? `· ${payload.taskId}` : ''} {payload.agentId ? `· ${payload.agentId}` : ''}
          {typeof payload.code === 'number' ? ` · 退出码 ${payload.code}` : ''}
        </div>
        <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
          {formatTime(event.timestamp)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
      <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
        {event.type}
      </div>
      <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
        {formatTime(event.timestamp)}
      </div>
    </div>
  );
}
