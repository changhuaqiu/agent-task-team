'use client';

import { AlertCircle, CheckCircle2, Clock3, FileCheck2, ListChecks } from 'lucide-react';
import type { ProjectWorkItem } from '@/lib/project-work-items';
import type { WorkspaceProject } from '@/store/taskHubStore';

export function ProjectOverviewSurface({ project, workItems, artifactCount, onOpenWork, onCreate }: {
  project: WorkspaceProject;
  workItems: ProjectWorkItem[];
  artifactCount: number;
  onOpenWork: (workItem?: ProjectWorkItem) => void;
  onCreate: () => void;
}) {
  const active = workItems.filter((item) => ['ready', 'proposed', 'in_progress'].includes(item.status));
  const blocked = workItems.filter((item) => item.status === 'blocked');
  const review = workItems.filter((item) => item.status === 'in_review');
  const done = workItems.filter((item) => item.status === 'done');

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))]" aria-label="项目概览">
    <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-7">
      <section className="rounded-2xl bg-[hsl(var(--bg-card))] p-5 sm:p-6" aria-labelledby="project-overview-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-[11px] font-medium text-[hsl(var(--text-tertiary))]">PROJECT OVERVIEW</p><h3 id="project-overview-heading" className="mt-1 text-xl font-semibold">{project.name}</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-[hsl(var(--text-tertiary))]">从工作项进入具体目标、任务、交付件和讨论；项目层只汇总已确认的进度。</p></div>
          <button type="button" onClick={onCreate} className="h-9 rounded-lg bg-[hsl(var(--text-primary))] px-3.5 text-xs font-medium text-[hsl(var(--text-inverse))]">创建工作项</button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewMetric icon={Clock3} label="进行中" value={active.length} />
          <OverviewMetric icon={AlertCircle} label="需要处理" value={blocked.length} tone="blocked" />
          <OverviewMetric icon={ListChecks} label="待评审" value={review.length} />
          <OverviewMetric icon={FileCheck2} label="正式交付件" value={artifactCount} />
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl bg-[hsl(var(--bg-card))]" aria-labelledby="recent-work-heading">
        <header className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-5 py-4"><div><h3 id="recent-work-heading" className="text-sm font-semibold">近期工作项</h3><p className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">{workItems.length} 项工作 · {done.length} 项完成</p></div>{workItems.length > 0 && <button type="button" onClick={() => onOpenWork()} className="text-xs font-medium text-[hsl(var(--text-secondary))] hover:underline">查看全部</button>}</header>
        {workItems.length > 0 ? <div className="divide-y divide-[hsl(var(--border-subtle))]">{workItems.slice(0, 6).map((item) => <button key={`${item.conversationId}:${item.id}`} type="button" onClick={() => onOpenWork(item)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-[hsl(var(--bg-card-hover))]"><WorkState status={item.status} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{item.title}</span><span className="mt-1 block truncate text-[11px] text-[hsl(var(--text-tertiary))]">{item.description || `${item.tasks.length} 个任务`}</span></span><span className="shrink-0 text-[10px] text-[hsl(var(--text-tertiary))]">{relativeTime(item.updatedAt)}</span></button>)}</div>
          : <div className="px-6 py-14 text-center"><CheckCircle2 className="mx-auto size-6 text-[hsl(var(--text-tertiary))]" /><h4 className="mt-3 text-sm font-medium">还没有工作项</h4><p className="mt-1.5 text-xs text-[hsl(var(--text-tertiary))]">创建后，每项工作会拥有独立的任务、活动与交付上下文。</p></div>}
      </section>
    </div>
  </main>;
}

function OverviewMetric({ icon: Icon, label, value, tone }: { icon: typeof Clock3; label: string; value: number; tone?: 'blocked' }) {
  return <div className="rounded-xl bg-[hsl(var(--bg-muted))]/60 px-4 py-3.5"><div className="flex items-center gap-2 text-[11px] text-[hsl(var(--text-tertiary))]"><Icon className={tone === 'blocked' && value > 0 ? 'size-3.5 text-[hsl(var(--status-blocked))]' : 'size-3.5'} />{label}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div></div>;
}

function WorkState({ status }: { status: ProjectWorkItem['status'] }) {
  const color = status === 'done' ? 'bg-emerald-500' : status === 'blocked' ? 'bg-red-500' : status === 'in_review' ? 'bg-violet-500' : status === 'in_progress' ? 'bg-blue-500' : 'bg-slate-400';
  return <span className={`size-2.5 shrink-0 rounded-full ${color}`} aria-label={`状态：${status}`} />;
}

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(value).toLocaleDateString('zh-CN');
}

