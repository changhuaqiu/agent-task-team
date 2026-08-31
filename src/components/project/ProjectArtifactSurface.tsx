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
type ArtifactCategory = 'implementation' | 'design_docs' | 'verification' | 'external' | 'other';

interface AgentIdentity {
  id: string;
  label: string;
  emoji?: string;
  order: number;
}

interface ContributorColumn {
  identity: AgentIdentity;
  artifacts: ProjectArtifactLedgerItem[];
  categories: Array<{
    category: ArtifactCategory;
    artifacts: ProjectArtifactLedgerItem[];
  }>;
}

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

const CATEGORY_ORDER: ArtifactCategory[] = [
  'implementation',
  'design_docs',
  'verification',
  'external',
  'other',
];

const CATEGORY_LABEL: Record<ArtifactCategory, string> = {
  implementation: '实现',
  design_docs: '设计与文档',
  verification: '验证与评审',
  external: '外部交付',
  other: '其他',
};

const CATEGORY_ICON: Record<ArtifactCategory, ComponentType<{ className?: string }>> = {
  implementation: Code2,
  design_docs: FileText,
  verification: ShieldCheck,
  external: GitPullRequest,
  other: File,
};

const KIND_CATEGORY: Record<ProjectArtifactLedgerKind, ArtifactCategory> = {
  code: 'implementation',
  document: 'design_docs',
  design: 'design_docs',
  test: 'verification',
  proof: 'verification',
  review: 'verification',
  link: 'external',
  pull_request: 'external',
  file: 'other',
};

const OPERATION_LABEL = {
  create: '创建',
  edit: '修改',
  delete: '删除',
  register: '登记证据',
} as const;

export function ProjectArtifactSurface({ project, agents = [], conversationId, workIds }: {
  project: WorkspaceProject;
  agents?: Array<{ id: string; name: string; emoji?: string }>;
  conversationId?: string;
  workIds?: string[];
}) {
  const [artifacts, setArtifacts] = useState<ProjectArtifactLedgerItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const workScopeKey = workIds?.join('\u0000') ?? null;
  const scopedWorkIds = useMemo(
    () => workScopeKey === null ? null : new Set(workScopeKey ? workScopeKey.split('\u0000') : []),
    [workScopeKey],
  );

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const query = new URLSearchParams({ projectId: project.id });
      if (conversationId) query.set('conversationId', conversationId);
      for (const id of scopedWorkIds ?? []) query.append('workId', id);
      const response = await fetch(`/api/artifacts?${query.toString()}`, { cache: 'no-store' });
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
  }, [conversationId, project.id, scopedWorkIds]);

  useEffect(() => {
    const controller = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(controller);
  }, [refresh]);

  const scopedArtifacts = artifacts;
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return scopedArtifacts.filter((artifact) => {
      if (filter !== 'all' && artifact.status !== filter) return false;
      if (!normalizedQuery) return true;
      const identity = agentIdentity(artifact.updatedBy, agents);
      return [
        artifact.label,
        artifact.ref,
        artifact.workTitle,
        artifact.updatedBy,
        identity.label,
        KIND_LABEL[artifact.kind],
        CATEGORY_LABEL[KIND_CATEGORY[artifact.kind]],
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [agents, filter, query, scopedArtifacts]);
  const contributors = useMemo(() => groupByContributor(filtered, agents), [agents, filtered]);
  const selected = filtered.find((artifact) => artifact.id === selectedId)
    ?? contributors[0]?.artifacts[0]
    ?? null;
  const registeredCount = scopedArtifacts.filter((artifact) => artifact.status === 'registered').length;

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

  const scoped = Boolean(conversationId || workIds);

  return <section className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-4 sm:p-6" aria-label={scoped ? '工作项交付件' : '项目产物'}>
    <section className="mx-auto flex min-h-[520px] max-w-7xl flex-col overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
      <header className="border-b border-[hsl(var(--border-subtle))] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{scoped ? '本工作项的角色交付' : '角色交付'}</h3>{scopedArtifacts.length > 0 && <><span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-0.5 text-xs text-[hsl(var(--text-secondary))]">{scopedArtifacts.length} 项</span><span className="text-xs text-[hsl(var(--text-tertiary))]">{registeredCount} 项已登记</span></>}</div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[hsl(var(--text-tertiary))]">先看每个角色交付了什么，再按实现、文档与验证分类；无需另外创建产物。</p>
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
          : scopedArtifacts.length === 0 ? <EmptyLedger />
            : filtered.length === 0 ? <div className="px-5 py-14 text-center"><div className="text-sm font-medium">没有匹配的产物</div><p className="mt-1.5 text-xs text-[hsl(var(--text-tertiary))]">换一个关键词或状态。</p></div>
              : <div className="min-h-0 flex-1">
                <div className="border-b border-[hsl(var(--border-subtle))] px-4 py-4 sm:px-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-medium">按贡献角色查看</div><div className="text-xs text-[hsl(var(--text-tertiary))]">{contributors.length} 位贡献者 · {filtered.length} 项产物</div></div>
                  <div className="flex snap-x gap-3 overflow-x-auto pb-2" aria-label="按贡献角色归类的产物">
                    {contributors.map((contributor) => <ContributorArtifacts key={contributor.identity.id} contributor={contributor} selectedId={selected?.id ?? null} onSelect={setSelectedId} />)}
                  </div>
                </div>
                <div className="min-h-[280px] bg-[hsl(var(--bg-card))]">{selected ? <ArtifactDetail artifact={selected} actorLabel={agentIdentity(selected.updatedBy, agents).label} copied={copied} onCopy={() => void copyReference()} /> : <div className="flex h-full items-center justify-center p-8 text-xs text-[hsl(var(--text-tertiary))]">选择一个产物查看详情</div>}</div>
              </div>}
    </section>
  </section>;
}

function ContributorArtifacts({ contributor, selectedId, onSelect }: {
  contributor: ContributorColumn;
  selectedId: string | null;
  onSelect: (artifactId: string) => void;
}) {
  const registered = contributor.artifacts.filter((artifact) => artifact.status === 'registered').length;
  return <section aria-label={`${contributor.identity.label} 的交付`} className="w-[min(82vw,300px)] shrink-0 snap-start overflow-hidden rounded-xl bg-[hsl(var(--bg-muted))]/55">
    <header className="flex items-center justify-between gap-3 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--bg-card))] text-sm">{contributor.identity.emoji ?? '●'}</span><div className="min-w-0"><h4 className="truncate text-sm font-medium">{contributor.identity.label.replace(/^\S+\s/, '')}</h4><p className="text-xs text-[hsl(var(--text-tertiary))]">{contributor.artifacts.length} 项 · {registered} 项已登记</p></div></div>
    </header>
    <div className="max-h-[460px] space-y-4 overflow-y-auto px-2 pb-3">
      {contributor.categories.map(({ category, artifacts }) => {
        const Icon = CATEGORY_ICON[category];
        return <section key={category} aria-label={CATEGORY_LABEL[category]}>
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-[hsl(var(--text-secondary))]"><Icon className="size-3.5" />{CATEGORY_LABEL[category]}<span className="font-normal text-[hsl(var(--text-tertiary))]">{artifacts.length}</span></div>
          <div className="space-y-1.5">{artifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} selected={artifact.id === selectedId} onSelect={() => onSelect(artifact.id)} />)}</div>
        </section>;
      })}
    </div>
  </section>;
}

function ArtifactRow({ artifact, selected, onSelect }: { artifact: ProjectArtifactLedgerItem; selected: boolean; onSelect: () => void }) {
  const Icon = KIND_ICON[artifact.kind];
  return <button type="button" onClick={onSelect} aria-label={`${artifact.label}，${artifact.status === 'registered' ? '已登记' : '处理中'}`} aria-pressed={selected} className={cn('flex w-full items-start gap-2.5 rounded-lg bg-[hsl(var(--bg-card))] px-3 py-3 text-left transition-colors hover:bg-[hsl(var(--bg-card-hover))]', selected && 'ring-1 ring-[hsl(var(--text-secondary))]')}>
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--bg-muted))]"><Icon className="size-3.5 text-[hsl(var(--text-secondary))]" /></span>
    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-xs font-medium">{artifact.label}</span><StatusDot status={artifact.status} /></span><span className="mt-1 block truncate font-mono text-xs text-[hsl(var(--text-tertiary))]">{artifact.ref}</span><span className="mt-1.5 block truncate text-xs text-[hsl(var(--text-tertiary))]">{artifact.workTitle ? `${artifact.workTitle} · ` : ''}{relativeTime(artifact.updatedAt)}</span></span>
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

function agentIdentity(
  actorId: string,
  agents: Array<{ id: string; name: string; emoji?: string }>,
): AgentIdentity {
  const order = agents.findIndex((item) => item.id === actorId);
  const agent = order >= 0 ? agents[order] : undefined;
  if (agent) {
    return {
      id: agent.id,
      label: `${agent.emoji ? `${agent.emoji} ` : ''}${agent.name}`,
      ...(agent.emoji ? { emoji: agent.emoji } : {}),
      order,
    };
  }
  return actorId === 'system'
    ? { id: actorId, label: '系统', emoji: '⚙️', order: agents.length }
    : { id: actorId, label: actorId, order: agents.length + 1 };
}

function groupByContributor(
  artifacts: ProjectArtifactLedgerItem[],
  agents: Array<{ id: string; name: string; emoji?: string }>,
): ContributorColumn[] {
  const byContributor = new Map<string, ProjectArtifactLedgerItem[]>();
  for (const artifact of artifacts) {
    const current = byContributor.get(artifact.updatedBy) ?? [];
    current.push(artifact);
    byContributor.set(artifact.updatedBy, current);
  }
  return [...byContributor.entries()]
    .map(([actorId, contributorArtifacts]): ContributorColumn => {
      const categories = CATEGORY_ORDER.flatMap((category) => {
        const categoryArtifacts = contributorArtifacts.filter(
          (artifact) => KIND_CATEGORY[artifact.kind] === category,
        );
        return categoryArtifacts.length > 0 ? [{ category, artifacts: categoryArtifacts }] : [];
      });
      return {
        identity: agentIdentity(actorId, agents),
        artifacts: contributorArtifacts,
        categories,
      };
    })
    .sort((left, right) => (
      left.identity.order - right.identity.order
      || left.identity.label.localeCompare(right.identity.label, 'zh-CN')
    ));
}
