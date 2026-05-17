'use client';

import { useMemo, useState } from 'react';
import { GitBranch, GitMerge, Link2, PackageCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TaskGraphMapTask {
  id: string;
  title: string;
  status: string;
  agent_id: string;
}

export interface TaskGraphMapEdge {
  id: string;
  from_task_id: string;
  to_task_id: string;
  type: string;
}

export interface TaskGraphMapArtifact {
  id: string;
  task_id: string;
  kind: string;
  label: string;
}

export interface TaskGraphMapView {
  conversationId: string;
  tasks: TaskGraphMapTask[];
  edges: TaskGraphMapEdge[];
  artifacts: TaskGraphMapArtifact[];
}

interface TaskGraphMapProps {
  graph: TaskGraphMapView;
  onSelectTask?: (taskId: string) => void;
  className?: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  in_review: '评审中',
  done: '完成',
  blocked: '阻塞',
  merged: '已合并',
  reopened: '重开',
  cancelled: '取消',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function TaskGraphMap({ graph, onSelectTask, className }: TaskGraphMapProps) {
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const owners = useMemo(() => uniqueSorted(graph.tasks.map((task) => task.agent_id).filter(Boolean)), [graph.tasks]);
  const statuses = useMemo(() => uniqueSorted(graph.tasks.map((task) => task.status).filter(Boolean)), [graph.tasks]);
  const taskById = useMemo(() => new Map(graph.tasks.map((task) => [task.id, task])), [graph.tasks]);
  const artifactsByTask = useMemo(() => {
    const grouped = new Map<string, TaskGraphMapArtifact[]>();
    for (const artifact of graph.artifacts) {
      grouped.set(artifact.task_id, [...(grouped.get(artifact.task_id) ?? []), artifact]);
    }
    return grouped;
  }, [graph.artifacts]);

  const visibleTasks = graph.tasks.filter((task) => {
    if (ownerFilter !== 'all' && task.agent_id !== ownerFilter) return false;
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    return true;
  });

  const splitLines = graph.edges
    .filter((edge) => edge.type === 'subtask_of')
    .reduce<Map<string, string[]>>((lines, edge) => {
      lines.set(edge.to_task_id, [...(lines.get(edge.to_task_id) ?? []), edge.from_task_id]);
      return lines;
    }, new Map());

  const mergeLines = graph.edges
    .filter((edge) => edge.type === 'merged_into')
    .reduce<Map<string, string[]>>((lines, edge) => {
      lines.set(edge.to_task_id, [...(lines.get(edge.to_task_id) ?? []), edge.from_task_id]);
      return lines;
    }, new Map());

  const dependenciesByTask = graph.edges
    .filter((edge) => edge.type === 'depends_on' || edge.type === 'blocks')
    .reduce<Map<string, string[]>>((lines, edge) => {
      lines.set(edge.from_task_id, [...(lines.get(edge.from_task_id) ?? []), edge.to_task_id]);
      return lines;
    }, new Map());

  return (
    <section className={cn('rounded-[6px] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-3', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-bold text-[hsl(var(--text-primary))]">任务地图</h3>
          <p className="text-[10px] text-[hsl(var(--text-tertiary))]">看见拆分、合并、阻塞与产出物的流转。</p>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[9px] font-bold text-[hsl(var(--text-secondary))]">
            <span className="rounded-[2px] bg-[hsl(var(--bg-muted))] px-1.5 py-0.5">任务 {graph.tasks.length}</span>
            <span className="rounded-[2px] bg-[hsl(var(--bg-muted))] px-1.5 py-0.5">产出 {graph.artifacts.length}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-secondary))]">
            负责人
            <select
              aria-label="负责人"
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              className="rounded-[3px] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-1.5 py-1 text-[10px]"
            >
              <option value="all">全部</option>
              {owners.map((owner) => (
                <option key={owner} value={owner}>@{owner}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-secondary))]">
            状态
            <select
              aria-label="状态"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-[3px] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-1.5 py-1 text-[10px]"
            >
              <option value="all">全部</option>
              {statuses.map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mb-3 grid gap-2 md:grid-cols-2">
        {Array.from(splitLines.entries()).map(([parentTaskId, childTaskIds]) => (
          <div key={`split-${parentTaskId}`} className="rounded-[4px] border border-blue-400/30 bg-blue-500/10 px-2 py-1.5 text-[10px] font-bold text-blue-600">
            <GitBranch className="mr-1 inline h-3 w-3" />
            {parentTaskId} → {childTaskIds.join('、')}
          </div>
        ))}
        {Array.from(mergeLines.entries()).map(([targetTaskId, sourceTaskIds]) => (
          <div key={`merge-${targetTaskId}`} className="rounded-[4px] border border-cyan-400/30 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-bold text-cyan-600">
            <GitMerge className="mr-1 inline h-3 w-3" />
            {sourceTaskIds.join('、')} → {targetTaskId}
          </div>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {visibleTasks.map((task) => {
          const dependencies = dependenciesByTask.get(task.id) ?? [];
          const artifacts = artifactsByTask.get(task.id) ?? [];
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onSelectTask?.(task.id)}
              aria-label={`打开 ${task.title}`}
              className="min-w-0 rounded-[4px] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-2 text-left transition-colors hover:border-[hsl(var(--accent))]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-bold text-[hsl(var(--text-primary))]">{task.title}</span>
                <span className="shrink-0 rounded-[2px] bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--text-secondary))]">
                  {statusLabel(task.status)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-[hsl(var(--text-tertiary))]">
                <span>@{task.agent_id}</span>
                {dependencies.map((dependencyId) => (
                  <span key={dependencyId} className="inline-flex items-center gap-0.5 rounded-[2px] bg-amber-500/10 px-1 py-0.5 text-amber-700">
                    <Link2 className="h-2.5 w-2.5" />
                    依赖 {taskById.get(dependencyId)?.id ?? dependencyId}
                  </span>
                ))}
                {artifacts.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded-[2px] bg-emerald-500/10 px-1 py-0.5 text-emerald-700">
                    <PackageCheck className="h-2.5 w-2.5" />
                    产出 {artifacts.length}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
