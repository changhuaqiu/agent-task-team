'use client';

import { useRef, useState } from 'react';
import { GitPullRequest, ListChecks, X } from 'lucide-react';
import type { WorkspaceProject } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';
import type { ProjectReview } from '@/shared/project-review';

export type ProjectCreateKind = 'work' | 'review';

export function ProjectObjectCreateDialog({ kind, project, onClose, onReviewCreated }: {
  kind: ProjectCreateKind;
  project: WorkspaceProject;
  tasks: Task[];
  onClose: () => void;
  onReviewCreated?: (review: ProjectReview) => void;
}) {
  const loadFromServer = useTaskHubStore((state) => state.loadFromServer);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'issue' | 'change_request' | 'improvement'>('issue');
  const [baseRef, setBaseRef] = useState('main');
  const [compareRef, setCompareRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const workCommandId = useRef<string | null>(null);
  const reviewCommandId = useRef<string | null>(null);
  const isWork = kind === 'work';
  const valid = isWork
    ? Boolean(title.trim())
    : Boolean(title.trim() && baseRef.trim() && compareRef.trim() && baseRef.trim() !== compareRef.trim());
  const dirty = Boolean(
    title.trim()
    || description.trim()
    || (isWork ? category !== 'issue' : baseRef !== 'main' || compareRef.trim()),
  );

  function requestClose() {
    if (busy) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      if (isWork) {
        workCommandId.current ??= `webui:work.create:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
        const response = await fetch('/api/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'work.create',
            commandId: workCommandId.current,
            idempotencyKey: workCommandId.current,
            projectId: project.id,
            input: { title: title.trim(), category, description: description.trim() },
          }),
        });
        const receipt = await response.json() as { status?: string; reasonCode?: string };
        if (!response.ok || !['applied', 'duplicate'].includes(receipt.status ?? '')) {
          const messages: Record<string, string> = {
            work_project_not_found: '创建工作失败：当前项目不存在或已失效。',
            command_idempotency_conflict: '创建工作失败：同一次操作的内容发生了变化，请重新打开后再试。',
            stale_task_graph_revision: '创建工作失败：项目工作已更新，请刷新后重试。',
          };
          throw new Error(messages[receipt.reasonCode ?? ''] ?? '创建工作失败，请检查项目状态后重试。');
        }
        await loadFromServer();
      } else {
        reviewCommandId.current ??= `webui:review.create:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
        const response = await fetch('/api/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'review.create',
            commandId: reviewCommandId.current,
            idempotencyKey: reviewCommandId.current,
            projectId: project.id,
            input: {
              repositoryRoot: project.rootPath,
              baseRef: baseRef.trim(),
              compareRef: compareRef.trim(),
              title: title.trim(),
              description: description.trim(),
            },
          }),
        });
        const receipt = await response.json() as {
          status?: string;
          reasonCode?: string;
          result?: { review?: ProjectReview };
        };
        if (!response.ok || !receipt.result?.review) {
          const messages: Record<string, string> = {
            review_branches_must_differ: 'Base 与 Compare 不能相同。',
            review_already_open: '这两个分支已经有一个开放评审。',
            review_repository_outside_project: '所选仓库不属于当前项目。',
          };
          throw new Error(messages[receipt.reasonCode ?? ''] ?? '发起评审失败，请检查分支后重试。');
        }
        onReviewCreated?.(receipt.result.review);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const Icon = isWork ? ListChecks : GitPullRequest;
  const heading = isWork ? '创建工作' : '发起评审';
  return <>
    <div className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-[2px]" onClick={requestClose} />
    <div className="fixed inset-0 z-[61] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={heading}>
      <section className="w-full max-w-lg overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-[var(--shadow-lg)]">
        <header className="flex items-start justify-between border-b border-[hsl(var(--border))] px-5 py-4">
          <div className="flex gap-3"><div className="flex size-9 items-center justify-center rounded-lg bg-[hsl(var(--accent-soft))]"><Icon className="size-4" /></div><div><h2 className="text-sm font-semibold">{heading}</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">{project.name}</p></div></div>
          <button type="button" onClick={requestClose} aria-label="关闭" className="rounded-md p-1.5 hover:bg-[hsl(var(--bg-muted))]"><X className="size-4" /></button>
        </header>
        <div className="space-y-4 p-5">
          {isWork ? <>
            <Field label="类别"><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="field"><option value="issue">Issue</option><option value="change_request">Change request</option><option value="improvement">Improvement</option></select></Field>
            <Field label="标题"><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="要完成什么？" className="field" /></Field>
            <Field label="说明（可选）"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="补充目标、约束或验收条件" className="field min-h-24 py-2" /></Field>
          </> : <>
            <Field label="仓库"><input value={project.rootPath} readOnly className="field bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))]" /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Base"><input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} placeholder="main" className="field" /></Field><Field label="Compare"><input autoFocus value={compareRef} onChange={(event) => setCompareRef(event.target.value)} placeholder="feature/branch" className="field" /></Field></div>
            <Field label="标题"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="这次评审要确认什么？" className="field" /></Field>
            <Field label="说明（可选）"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="补充背景、风险或验收重点" className="field min-h-24 py-2" /></Field>
          </>}
          {error && <p role="alert" className="text-xs text-[hsl(var(--status-rejected))]">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[hsl(var(--border))] px-5 py-4"><button type="button" onClick={requestClose} disabled={busy} className="h-9 rounded-md px-4 text-xs hover:bg-[hsl(var(--bg-muted))] disabled:opacity-40">取消</button><button type="button" disabled={!valid || busy} onClick={() => void submit()} className="h-9 rounded-md bg-[hsl(var(--text-primary))] px-4 text-xs font-medium text-[hsl(var(--text-inverse))] disabled:opacity-40">{busy ? '正在提交…' : heading}</button></footer>
      </section>
    </div>
    {confirmDiscard && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4" role="alertdialog" aria-modal="true" aria-label={`放弃${isWork ? '工作' : '评审'}草稿`}>
      <section className="w-full max-w-sm rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-[var(--shadow-lg)]"><h3 className="text-sm font-semibold">放弃尚未提交的内容？</h3><p className="mt-2 text-xs leading-5 text-[hsl(var(--text-tertiary))]">当前{isWork ? '工作' : '评审'}草稿还没有保存，放弃后无法恢复。</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmDiscard(false)} className="h-9 rounded-md px-3 text-xs hover:bg-[hsl(var(--bg-muted))]">继续编辑</button><button type="button" onClick={onClose} className="h-9 rounded-md bg-[hsl(var(--status-rejected))] px-3 text-xs font-medium text-white">放弃改动</button></div></section>
    </div>}
  </>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-[hsl(var(--text-secondary))]">{label}</span>{children}</label>;
}
