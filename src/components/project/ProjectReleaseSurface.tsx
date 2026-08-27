'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, PackageCheck, Plus, Rocket, X } from 'lucide-react';
import type { WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';
import type { ProjectReview } from '@/shared/project-review';
import type { ProjectRelease, ProjectReleaseTarget } from '@/shared/project-release';

export function ProjectReleaseSurface({ project, tasks }: { project: WorkspaceProject; tasks: Task[] }) {
  const [releases, setReleases] = useState<ProjectRelease[]>([]);
  const [reviews, setReviews] = useState<ProjectReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const commandIds = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [releaseResponse, reviewResponse] = await Promise.all([
        fetch(`/api/releases?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' }),
        fetch(`/api/reviews?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' }),
      ]);
      const releasePayload = await releaseResponse.json() as { releases?: ProjectRelease[]; error?: string };
      const reviewPayload = await reviewResponse.json() as { reviews?: ProjectReview[]; error?: string };
      if (!releaseResponse.ok) throw new Error(releasePayload.error ?? 'release_load_failed');
      if (!reviewResponse.ok) throw new Error(reviewPayload.error ?? 'review_load_failed');
      setReleases(releasePayload.releases ?? []);
      setReviews(reviewPayload.reviews ?? []);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '发布加载失败'); }
    finally { setLoading(false); }
  }, [project.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const candidates = useMemo(() => [
    ...tasks.map((task) => ({ key: `work:${task.id}`, target: { type: 'work', id: task.id } as ProjectReleaseTarget, title: task.title, state: task.status === 'done' ? '已完成' : '未完成', ready: task.status === 'done' })),
    ...reviews.map((review) => ({ key: `review:${review.id}`, target: { type: 'review', id: review.id } as ProjectReleaseTarget, title: review.title, state: ['approved', 'closed'].includes(review.status) ? '已通过' : '未通过', ready: ['approved', 'closed'].includes(review.status) })),
  ], [reviews, tasks]);

  function resetDraft() {
    setName(''); setDescription(''); setSelected(new Set()); setCreating(false); setError('');
  }

  async function createRelease() {
    if (!name.trim() || selected.size === 0 || busy) return;
    setBusy(true); setError('');
    const targets = candidates.filter((item) => selected.has(item.key)).map((item) => item.target);
    const signature = `${name.trim()}:${JSON.stringify(targets)}`;
    const commandId = commandIds.current.get(signature) ?? `webui:release.create:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    commandIds.current.set(signature, commandId);
    try {
      const response = await fetch('/api/commands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'release.create', commandId, idempotencyKey: commandId, projectId: project.id, input: { name: name.trim(), description: description.trim(), targets } }),
      });
      const receipt = await response.json() as { reasonCode?: string };
      if (!response.ok) throw new Error(receipt.reasonCode ?? 'release_create_failed');
      resetDraft();
      await refresh();
    } catch (cause) { setError(releaseMessage(cause)); }
    finally { setBusy(false); }
  }

  async function publishRelease(release: ProjectRelease) {
    if (busy) return;
    setBusy(true); setError('');
    const signature = `${release.id}:${release.revision}`;
    const commandId = commandIds.current.get(signature) ?? `webui:release.publish:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    commandIds.current.set(signature, commandId);
    try {
      const response = await fetch('/api/commands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'release.publish', commandId, idempotencyKey: commandId, projectId: project.id, expectedRevision: release.revision, input: { releaseId: release.id } }),
      });
      const receipt = await response.json() as { reasonCode?: string };
      if (!response.ok) throw new Error(receipt.reasonCode ?? 'release_publish_failed');
      await refresh();
    } catch (cause) { setError(releaseMessage(cause)); }
    finally { setBusy(false); }
  }

  function isReady(release: ProjectRelease) {
    return release.targets.every((target) => candidates.find((candidate) => candidate.key === `${target.type}:${target.id}`)?.ready === true);
  }

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-6" aria-label="项目发布">
    <section className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
      <header className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border-subtle))] px-4 py-3.5"><div><h3 className="text-sm font-medium">发布</h3><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">需要对外冻结一批已验证结果时再创建；日常协作不需要发布对象。</p></div><button type="button" onClick={() => setCreating(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-2.5 text-xs"><Plus className="size-3.5" />创建发布</button></header>
      {error && <p role="alert" className="border-b border-[hsl(var(--border-subtle))] px-4 py-3 text-xs text-red-600">{error}</p>}
      {loading ? <div className="px-6 py-14 text-center text-xs text-[hsl(var(--text-tertiary))]">正在加载发布</div> : releases.length === 0 ? <div className="px-6 py-14 text-center"><PackageCheck className="mx-auto size-5 text-[hsl(var(--text-tertiary))]" /><div className="mt-3 text-sm font-medium">还没有发布</div><p className="mt-1.5 text-xs text-[hsl(var(--text-tertiary))]">完成的工作和通过的评审可以按需冻结为发布。</p></div> : <div className="divide-y divide-[hsl(var(--border-subtle))]">{releases.map((release) => <article key={release.id} className="p-4"><div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-[hsl(var(--bg-muted))]"><PackageCheck className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="truncate text-sm font-medium">{release.name}</h4><span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-0.5 text-[10px]">{release.status === 'published' ? '已发布' : isReady(release) ? '可以发布' : '等待验证'}</span></div>{release.description && <p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">{release.description}</p>}<div className="mt-2 flex flex-wrap gap-1.5">{release.targets.map((target) => { const candidate = candidates.find((item) => item.key === `${target.type}:${target.id}`); return <span key={`${target.type}:${target.id}`} className="rounded-md bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px]">{target.type === 'work' ? '工作' : '评审'} · {candidate?.title ?? target.id}</span>; })}</div></div>{release.status === 'draft' && <button type="button" disabled={busy || !isReady(release)} onClick={() => void publishRelease(release)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-[hsl(var(--text-primary))] px-2.5 text-[11px] text-[hsl(var(--text-inverse))] disabled:opacity-35"><Rocket className="size-3.5" />发布</button>}</div></article>)}</div>}
    </section>
    {creating && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="创建发布"><section className="w-full max-w-lg overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-xl"><header className="flex items-start justify-between border-b border-[hsl(var(--border))] px-5 py-4"><div><h3 className="text-sm font-semibold">创建发布</h3><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">{project.name} · 选择要冻结的正式对象</p></div><button type="button" onClick={resetDraft} aria-label="关闭" className="p-1.5"><X className="size-4" /></button></header><div className="space-y-4 p-5"><label className="block"><span className="mb-1.5 block text-[11px] font-medium">名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：v1.0 桌面预览" className="field" /></label><label className="block"><span className="mb-1.5 block text-[11px] font-medium">说明（可选）</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="field py-2" /></label><div><div className="mb-1.5 text-[11px] font-medium">包含的结果</div><div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[hsl(var(--border))] p-2">{candidates.length === 0 ? <p className="p-3 text-center text-xs text-[hsl(var(--text-tertiary))]">项目中还没有可选择的工作或评审。</p> : candidates.map((item) => <label key={item.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-[hsl(var(--bg-muted))]"><input type="checkbox" checked={selected.has(item.key)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.key); else next.delete(item.key); return next; })} /><span className="min-w-0 flex-1 truncate text-xs">{item.title}</span><span className={item.ready ? 'text-[10px] text-emerald-600' : 'text-[10px] text-amber-600'}>{item.state}</span></label>)}</div></div>{error && <p className="text-xs text-red-600">{error}</p>}</div><footer className="flex items-center justify-end gap-2 border-t border-[hsl(var(--border))] px-5 py-3"><button type="button" onClick={resetDraft} className="h-9 px-3 text-xs">取消</button><button type="button" disabled={busy || !name.trim() || selected.size === 0} onClick={() => void createRelease()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[hsl(var(--text-primary))] px-3 text-xs text-[hsl(var(--text-inverse))] disabled:opacity-40"><CheckCircle2 className="size-3.5" />创建草稿</button></footer></section></div>}
  </main>;
}

function releaseMessage(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : String(cause);
  return ({ release_targets_required: '至少选择一项正式结果。', release_target_outside_project: '选择中包含不属于当前项目的对象。', release_work_not_done: '仍有工作尚未完成，暂时不能发布。', release_review_not_approved: '仍有评审尚未通过，暂时不能发布。', release_revision_conflict: '发布已被更新，请刷新后重试。', release_name_conflict: '这个项目中已有同名发布。' } as Record<string, string>)[code] ?? `操作失败：${code}`;
}
