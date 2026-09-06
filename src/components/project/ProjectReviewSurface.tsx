'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, GitCompareArrows, GitPullRequest, Plus, RefreshCw, XCircle } from 'lucide-react';
import type { WorkspaceProject } from '@/store/taskHubStore';
import type { ProjectReview, ProjectReviewStatus } from '@/shared/project-review';

const STATUS_LABEL: Record<ProjectReviewStatus, string> = {
  open: '开放',
  changes_requested: '需要修改',
  approved: '已通过',
  closed: '已关闭',
};

type ProjectReviewSurfaceProps = {
  project: WorkspaceProject;
  refreshToken?: number;
  initialReviewId?: string;
  onCreate?: () => void;
};

export function ProjectReviewSurface(props: ProjectReviewSurfaceProps) {
  return <ProjectReviewBrowser key={`${props.project.id}:${props.initialReviewId ?? ''}`} {...props} />;
}

function ProjectReviewBrowser({ project, refreshToken = 0, initialReviewId, onCreate }: ProjectReviewSurfaceProps) {
  const [reviews, setReviews] = useState<ProjectReview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialReviewId ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const decisionIds = useRef(new Map<string, string>());
  const selected = useMemo(() => reviews.find((review) => review.id === selectedId) ?? null, [reviews, selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      fetch(`/api/reviews?projectId=${encodeURIComponent(project.id)}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as { reviews?: ProjectReview[]; error?: string };
          if (!response.ok) throw new Error(payload.error ?? '评审加载失败');
          setReviews(payload.reviews ?? []);
        })
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setError(cause instanceof Error ? cause.message : '评审加载失败');
        })
        .finally(() => setLoading(false));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [project.id, refreshToken]);

  async function recordDecision(status: Extract<ProjectReviewStatus, 'approved' | 'changes_requested' | 'closed'>) {
    if (!selected || !summary.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    const signature = `${selected.id}:${selected.revision}:${status}:${summary.trim()}`;
    const commandId = decisionIds.current.get(signature)
      ?? `webui:review.decide:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    decisionIds.current.set(signature, commandId);
    try {
      const response = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'review.record_decision',
          commandId,
          idempotencyKey: commandId,
          projectId: project.id,
          expectedRevision: selected.revision,
          input: { reviewId: selected.id, status, summary: summary.trim() },
        }),
      });
      const receipt = await response.json() as { reasonCode?: string; result?: { review?: ProjectReview } };
      if (!response.ok || !receipt.result?.review) {
        const message = receipt.reasonCode === 'review_revision_conflict'
          ? '评审已被更新，请刷新后重试。'
          : '评审决定未被接纳，请重试。';
        throw new Error(message);
      }
      const updated = receipt.result.review;
      setReviews((current) => current.map((review) => review.id === updated.id ? updated : review));
      setSummary('');
      decisionIds.current.delete(signature);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '评审决定提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (selected) {
    const canDecide = selected.status === 'open' || selected.status === 'changes_requested';
    return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-6" aria-label="评审详情">
      <section className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
        <header className="border-b border-[hsl(var(--border-subtle))] px-5 py-4">
          <button type="button" onClick={() => setSelectedId(null)} className="mb-3 inline-flex items-center gap-1 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"><ArrowLeft className="size-3.5" />返回评审列表</button>
          <div className="flex items-start justify-between gap-4"><div><h3 className="text-base font-semibold">{selected.title}</h3><div className="mt-2 flex items-center gap-2 text-xs text-[hsl(var(--text-secondary))]"><GitCompareArrows className="size-3.5" /><code>{selected.baseRef}</code><span>←</span><code>{selected.compareRef}</code></div></div><span className="rounded-full bg-[hsl(var(--bg-muted))] px-2.5 py-1 text-[10px] font-medium">{STATUS_LABEL[selected.status]}</span></div>
        </header>
        <div className="space-y-5 p-5">
          {selected.description && <p className="whitespace-pre-wrap text-sm leading-6 text-[hsl(var(--text-secondary))]">{selected.description}</p>}
          <div className="grid gap-3 rounded-lg bg-[hsl(var(--bg-muted))] p-4 text-xs sm:grid-cols-2"><Fact label="仓库" value={selected.repositoryRoot} /><Fact label="对象引用" value={selected.reference} /><Fact label="版本" value={`r${selected.revision}`} /><Fact label="更新时间" value={new Date(selected.updatedAt).toLocaleString()} /></div>
          {selected.decisionSummary && <div className="rounded-lg border border-[hsl(var(--border-subtle))] p-4"><div className="text-[11px] font-semibold">最近决定</div><p className="mt-2 text-sm leading-6 text-[hsl(var(--text-secondary))]">{selected.decisionSummary}</p></div>}
          {canDecide && <div className="space-y-3 border-t border-[hsl(var(--border-subtle))] pt-5"><label className="block"><span className="mb-1.5 block text-[11px] font-semibold">评审结论</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} placeholder="写明通过依据，或需要修改的具体问题" className="field min-h-24 py-2" /></label><div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={!summary.trim() || submitting} onClick={() => void recordDecision('changes_requested')} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-3 text-xs disabled:opacity-40"><XCircle className="size-3.5" />要求修改</button><button type="button" disabled={!summary.trim() || submitting} onClick={() => void recordDecision('approved')} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[hsl(var(--text-primary))] px-3 text-xs text-[hsl(var(--text-inverse))] disabled:opacity-40"><CheckCircle2 className="size-3.5" />通过评审</button></div></div>}
          {error && <p role="alert" className="text-xs text-[hsl(var(--status-rejected))]">{error}</p>}
        </div>
      </section>
    </main>;
  }

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-6" aria-label="评审列表">
    <section className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
      <header className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border-subtle))] px-4 py-3.5"><div><h3 className="text-sm font-medium">评审</h3><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">每个评审都指向明确的仓库与分支，不由任务状态代替。</p></div>{onCreate && <button type="button" onClick={onCreate} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-2.5 text-xs hover:bg-[hsl(var(--bg-muted))]"><Plus className="size-3.5" />发起评审</button>}</header>
      {loading ? <div className="flex items-center justify-center gap-2 px-6 py-14 text-xs text-[hsl(var(--text-tertiary))]"><RefreshCw className="size-3.5 animate-spin" />正在加载评审</div>
        : error ? <div role="alert" className="px-6 py-14 text-center text-xs text-[hsl(var(--status-rejected))]">{error}</div>
          : reviews.length === 0 ? <div className="px-6 py-14 text-center"><div className="text-sm font-medium">没有评审</div><p className="mt-1.5 text-xs text-[hsl(var(--text-tertiary))]">使用上方“发起评审”，为当前项目创建第一个正式评审。</p></div>
            : reviews.map((review) => <button key={review.id} type="button" onClick={() => setSelectedId(review.id)} className="flex w-full items-start gap-3 border-b border-[hsl(var(--border-subtle))] px-4 py-3 text-left last:border-b-0 hover:bg-[hsl(var(--bg-card-hover))]"><GitPullRequest className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{review.title}</span><span className="mt-1 flex items-center gap-1.5 text-[11px] text-[hsl(var(--text-tertiary))]"><code>{review.baseRef}</code><span>←</span><code>{review.compareRef}</code></span></span><span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px]">{STATUS_LABEL[review.status]}</span></button>)}
    </section>
  </main>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-[10px] text-[hsl(var(--text-tertiary))]">{label}</div><div className="mt-1 break-all text-[hsl(var(--text-secondary))]">{value}</div></div>;
}
