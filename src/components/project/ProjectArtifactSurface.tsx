'use client';

import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  Check,
  Clipboard,
  Code2,
  File,
  FileCheck2,
  FileText,
  FlaskConical,
  GitPullRequest,
  Image as ImageIcon,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceProject } from '@/store/taskHubStore';
import type {
  ProjectArtifactLedgerItem,
  ProjectArtifactLedgerKind,
  ProjectArtifactLedgerStatus,
} from '@/shared/project-artifact-ledger';

type StatusFilter = 'all' | ProjectArtifactLedgerStatus;

const KIND_LABEL: Record<ProjectArtifactLedgerKind, string> = {
  code: '代码',
  document: '文档',
  design: '设计',
  test: '测试',
  file: '文件',
  link: '链接',
  pull_request: 'PR',
  review: '评审',
  proof: '证据',
};

const KIND_ICON: Record<ProjectArtifactLedgerKind, ComponentType<{ className?: string }>> = {
  code: Code2,
  document: FileText,
  design: ImageIcon,
  test: FlaskConical,
  file: File,
  link: Link2,
  pull_request: GitPullRequest,
  review: ShieldCheck,
  proof: FileCheck2,
};

const OPERATION_LABEL = {
  create: '创建',
  edit: '修改',
  delete: '删除',
  register: '登记证据',
} as const;

export function ProjectArtifactSurface({ project, agents = [] }: {
  project: WorkspaceProject;
  agents?: Array<{ id: string; name: string; emoji?: string }>;
}) {
  const [artifacts, setArtifacts] = useState<ProjectArtifactLedgerItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(`/api/artifacts?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' });
      const payload = await response.json() as { artifacts?: ProjectArtifactLedgerItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'artifact_load_failed');
      const next = payload.artifacts ?? [];
      setArtifacts(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '产物加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [project.id]);

  useEffect(() => {
    const controller = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(controller);
  }, [refresh]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return artifacts.filter((artifact) => {
      if (filter !== 'all' && artifact.status !== filter) return false;
      if (!normalizedQuery) return true;
      return [artifact.label, artifact.ref, artifact.workTitle, artifact.updatedBy]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [artifacts, filter, query]);
  const selected = filtered.find((artifact) => artifact.id === selectedId) ?? filtered[0] ?? null;
  const registeredCount = artifacts.filter((artifact) => artifact.status === 'registered').length;

  async function copyReference() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.ref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-4 sm:p-6" aria-label="项目产物">
    <section className="mx-auto flex min-h-[520px] max-w-5xl flex-col overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
      <header className="border-b border-[hsl(var(--border-subtle))] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">最近产物</h3>{artifacts.length > 0 && <span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--text-secondary))]">{registeredCount}/{artifacts.length} 已登记</span>}</div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[hsl(var(--text-tertiary))]">自动汇总 Agent 的实际写入与已提交证据；不需要另外创建产物。</p>
          </div>
          <button type="button" onClick={() => void refresh(true)} disabled={refreshing} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-2.5 text-xs hover:bg-[hsl(var(--bg-muted))] disabled:opacity-50"><RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />刷新</button>
        </div>
        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--text-tertiary))]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件、工作或 Agent" aria-label="搜索产物" className="field h-9 pl-8 text-xs" /></div>
          <div className="flex shrink-0 items-center rounded-lg bg-[hsl(var(--bg-muted))] p-0.5" aria-label="产物状态筛选">
            {([['all', '全部'], ['registered', '已登记'], ['working', '处理中']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={cn('h-7 rounded-md px-2.5 text-[11px] text-[hsl(var(--text-tertiary))]', filter === value && 'bg-[hsl(var(--bg-card))] font-medium text-[hsl(var(--text-primary))] shadow-sm')}>{label}</button>)}
          </div>
        </div>
      </header>

      {loading ? <div className="flex flex-1 items-center justify-center gap-2 px-6 py-16 text-xs text-[hsl(var(--text-tertiary))]"><RefreshCw className="size-3.5 animate-spin" />正在发现项目产物</div>
        : error ? <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center"><div role="alert" className="text-sm font-medium">产物暂时无法加载</div><p className="mt-1.5 text-xs text-[hsl(var(--text-tertiary))]">{error}</p><button type="button" onClick={() => void refresh()} className="mt-4 h-8 rounded-md border border-[hsl(var(--border))] px-3 text-xs">重试</button></div>
          : artifacts.length === 0 ? <EmptyLedger />
            : <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(280px,0.92fr)_minmax(340px,1.08fr)]">
              <div className="border-b border-[hsl(var(--border-subtle))] lg:border-b-0 lg:border-r">
                {filtered.length === 0 ? <div className="px-5 py-14 text-center"><div className="text-sm font-medium">没有匹配的产物</div><p className="mt-1.5 text-xs text-[hsl(var(--text-tertiary))]">换一个关键词或状态。</p></div>
                  : <div className="divide-y divide-[hsl(var(--border-subtle))]">{filtered.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} selected={artifact.id === selected?.id} onSelect={() => setSelectedId(artifact.id)} />)}</div>}
              </div>
              <div className="min-h-[280px] bg-[hsl(var(--bg-card))]">{selected ? <ArtifactDetail artifact={selected} actorLabel={actorLabel(selected.updatedBy, agents)} copied={copied} onCopy={() => void copyReference()} /> : <div className="flex h-full items-center justify-center p-8 text-xs text-[hsl(var(--text-tertiary))]">选择一个产物查看来源</div>}</div>
            </div>}
    </section>
  </main>;
}

function ArtifactRow({ artifact, selected, onSelect }: { artifact: ProjectArtifactLedgerItem; selected: boolean; onSelect: () => void }) {
  const Icon = KIND_ICON[artifact.kind];
  return <button type="button" onClick={onSelect} className={cn('flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[hsl(var(--bg-card-hover))]', selected && 'bg-[hsl(var(--bg-muted))]')}>
    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]"><Icon className="size-3.5 text-[hsl(var(--text-secondary))]" /></span>
    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-xs font-medium">{artifact.label}</span><StatusDot status={artifact.status} /></span><span className="mt-1 block truncate font-mono text-[10px] text-[hsl(var(--text-tertiary))]">{artifact.ref}</span><span className="mt-1.5 block truncate text-[10px] text-[hsl(var(--text-tertiary))]">{artifact.workTitle ? `${artifact.workTitle} · ` : ''}{relativeTime(artifact.updatedAt)}</span></span>
  </button>;
}

function ArtifactDetail({ artifact, actorLabel, copied, onCopy }: { artifact: ProjectArtifactLedgerItem; actorLabel: string; copied: boolean; onCopy: () => void }) {
  const Icon = KIND_ICON[artifact.kind];
  return <article className="p-5 sm:p-6">
    <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--bg-muted))]"><Icon className="size-4" /></span><div className="min-w-0"><h4 className="truncate text-sm font-semibold">{artifact.label}</h4><div className="mt-1.5 flex flex-wrap items-center gap-2"><StatusBadge status={artifact.status} /><span className="text-[10px] text-[hsl(var(--text-tertiary))]">{KIND_LABEL[artifact.kind]}</span></div></div></div><button type="button" onClick={onCopy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-2.5 text-[11px] hover:bg-[hsl(var(--bg-muted))]">{copied ? <Check className="size-3.5 text-emerald-600" /> : <Clipboard className="size-3.5" />}{copied ? '已复制' : '复制引用'}</button></div>
    <dl className="mt-6 space-y-4">
      <DetailFact label="引用"><code className="block break-all rounded-lg bg-[hsl(var(--bg-muted))] px-3 py-2.5 text-[11px] leading-5">{artifact.ref}</code></DetailFact>
      <div className="grid gap-4 sm:grid-cols-2"><DetailFact label="来源"><span>{actorLabel}</span></DetailFact><DetailFact label="最后变化"><span>{formatTime(artifact.updatedAt)}</span></DetailFact></div>
      {artifact.workTitle && <DetailFact label="关联工作"><span>{artifact.workTitle}</span></DetailFact>}
      <DetailFact label="发生过"><div className="flex flex-wrap gap-1.5">{artifact.operations.map((operation) => <span key={operation} className="rounded-md bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px]">{OPERATION_LABEL[operation]}</span>)}</div></DetailFact>
    </dl>
    <div className={cn('mt-6 rounded-xl border p-4', artifact.status === 'registered' ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-amber-500/20 bg-amber-500/[0.06]')}>
      <div className="flex items-center gap-2 text-xs font-medium">{artifact.status === 'registered' ? <FileCheck2 className="size-3.5 text-emerald-600" /> : <RefreshCw className="size-3.5 text-amber-600" />}{artifact.status === 'registered' ? '已成为正式证据' : 'Agent 正在形成结果'}</div>
      <p className="mt-1.5 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">{artifact.status === 'registered' ? '该引用已随工作结果提交，可以用于评审、发布与后续 Agent 接力。' : '平台已观察到成功写入，但尚未随工作结果登记；它会进入后续 Agent 的项目上下文，不会被误判为已经交付。'}</p>
    </div>
  </article>;
}

function StatusDot({ status }: { status: ProjectArtifactLedgerStatus }) {
  return <span aria-label={status === 'registered' ? '已登记' : '处理中'} className={cn('size-1.5 shrink-0 rounded-full', status === 'registered' ? 'bg-emerald-500' : 'bg-amber-500')} />;
}

function StatusBadge({ status }: { status: ProjectArtifactLedgerStatus }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', status === 'registered' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400')}>{status === 'registered' ? '已登记' : '处理中'}</span>;
}

function DetailFact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="mb-1.5 text-[10px] font-medium text-[hsl(var(--text-tertiary))]">{label}</dt><dd className="text-xs text-[hsl(var(--text-secondary))]">{children}</dd></div>;
}

function EmptyLedger() {
  return <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center"><span className="flex size-11 items-center justify-center rounded-2xl bg-[hsl(var(--bg-muted))]"><FileCheck2 className="size-5 text-[hsl(var(--text-tertiary))]" /></span><div className="mt-4 text-sm font-medium">项目还没有可追踪的产物</div><p className="mt-1.5 max-w-md text-xs leading-5 text-[hsl(var(--text-tertiary))]">Agent 成功写入文件后会自动出现在这里；提交工作结果时引用该文件，它会升级为已登记证据。无需手工创建。</p></div>;
}

function relativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 0) return formatTime(value);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} 天前` : formatTime(value);
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function actorLabel(actorId: string, agents: Array<{ id: string; name: string; emoji?: string }>): string {
  const agent = agents.find((item) => item.id === actorId);
  if (agent) return `${agent.emoji ? `${agent.emoji} ` : ''}${agent.name}`;
  return actorId === 'system' ? '系统' : actorId;
}
