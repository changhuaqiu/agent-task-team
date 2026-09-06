'use client';

import { useEffect, useState } from 'react';
import type { WorkResult, WorkResultGate } from '@/shared/work-result';
import type { ProjectWorkItem } from '@/lib/project-work-items';
import { ArtifactPreviewPanel, safeExternalUrl } from './ArtifactPreviewPanel';

const GATE_LABELS: Record<WorkResultGate['kind'], string> = { implementation_readiness: '实现准备检查', code_review: '代码评审', delivery_review: '交付评审', acceptance_verification: '验收验证', integration: '集成检查' };
const STATUS: Record<WorkResultGate['status'], string> = { requested: '等待验证', evaluating: '验证中', passed: '已通过', changes_requested: '需要修改', rejected: '未通过', cancelled: '已取消' };

export function WorkResultPanel({ item, onOpenReviews }: { item: ProjectWorkItem; onOpenReviews?: () => void }) {
  const query = new URLSearchParams({ projectId: item.projectId, conversationId: item.conversationId, workId: item.id }).toString();
  const hasRoot = Boolean(item.rootTask);
  const [state, setState] = useState<{ query: string; result?: WorkResult; error?: string }>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!hasRoot) return;
    const controller = new AbortController();
    void fetch('/api/work-result?' + query, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('验收记录暂时无法读取，请重试。'); return await response.json() as WorkResult; })
      .then((result) => { if (!controller.signal.aborted) setState({ query, result }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ query, error: error.message }); });
    return () => controller.abort();
  }, [query, item.updatedAt, hasRoot, refresh]);
  const current = state?.query === query ? state : undefined;
  if (!item.rootTask) return <section aria-label="成果验收" className="m-5 rounded-xl border p-5 text-sm">目标已记录，尚未生成执行任务和验收记录。</section>;
  return <section aria-label="成果验收" className="m-4 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-5 sm:m-6">
    <header className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold">完成依据与验收</h4><p className="mt-1 text-xs leading-5 text-[hsl(var(--text-tertiary))]">先看通过了什么，再查收下方角色交付件。展示已登记的质量门和决定接纳的证据；记录包含历史版本，不代表当前代码已经通过。</p></div><button type="button" className="shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-xs" onClick={() => setRefresh((value) => value + 1)}>刷新验收</button></header>
    {!current ? <p role="status" className="mt-4 text-xs">正在读取验收记录…</p> : current.error ? <p role="alert" className="mt-4 text-xs">{current.error}</p> : current.result && <>
      {current.result.gates.length === 0 && current.result.bundles.length === 0 && <p className="mt-4 text-xs leading-5">未找到本工作项的结构化验收记录；历史“已完成”状态不等于这里已核验通过。</p>}
      <details className="mt-4 space-y-2 rounded-lg bg-[hsl(var(--bg-muted))] p-3"><summary className="cursor-pointer text-xs font-medium">验收范围与记录限制</summary>{current.result.limitations.map((text) => <p key={text} className="text-xs leading-5">{text}</p>)}</details>
      {current.result.bundles.map(({ runId, bundle }) => <section key={runId} className="mt-5">
        <h5 className="text-sm font-medium">目标逐条验收</h5><p className="mt-2 whitespace-pre-wrap text-xs leading-5">{bundle.summary}</p>
        <ul className="mt-3 space-y-3">{bundle.acceptanceResults.map((criterion, index) => <li key={index} className="rounded-lg border border-[hsl(var(--border-subtle))] p-3"><p className="text-xs font-medium">{criterion.status === 'passed' ? '已通过' : '未通过'} · {criterion.criterion}</p><div className="mt-2 flex flex-wrap gap-2">{criterion.evidenceRefs.map((ref) => <EvidenceReference key={ref} item={item} reference={ref} />)}</div></li>)}</ul>
        <p className="mt-3 text-xs">验收时间：{new Date(bundle.completedAt).toLocaleString('zh-CN')} {bundle.verification?.codeRevision ? ' · 代码版本：' + bundle.verification.codeRevision : ''}</p>
        {bundle.verification && <div className="mt-2 space-y-2 text-xs"><p>验证人：{bundle.verification.verifierAgentId} · 方法：{bundle.verification.method} · 工具：{bundle.verification.tool}</p><EvidenceReference item={item} reference={bundle.verification.reportRef} /></div>}
        {bundle.knownLimitations.length > 0 && <div className="mt-3 text-xs">未覆盖风险：{bundle.knownLimitations.join('；')}</div>}
      </section>)}
      <div className="mt-5 space-y-3">{current.result.gates.map((gate) => <details key={gate.id} className="rounded-lg border border-[hsl(var(--border-subtle))] p-3">
        <summary className="cursor-pointer text-sm font-medium">{gate.taskTitle} · {GATE_LABELS[gate.kind]} · {STATUS[gate.status]}</summary>
        <div className="mt-3 space-y-2 text-xs leading-5"><p>验证对象版本：{gate.artifactRevision} · 验证人：{gate.evaluatorId ?? '尚未分配'}{gate.decidedAt ? ' · ' + new Date(gate.decidedAt).toLocaleString('zh-CN') : ''}</p>{gate.reason && <p className="whitespace-pre-wrap">{gate.reason}</p>}
          <details><summary className="cursor-pointer">查看验收条件与来源</summary><p className="mt-2 break-all">质量门：{gate.id}</p><pre className="mt-2 whitespace-pre-wrap break-words">{gate.criteria}</pre></details>
          {gate.evidence.length === 0 ? <p>尚无已接纳的决定证据。</p> : gate.evidence.map((evidence) => <details key={evidence.id} className="rounded bg-[hsl(var(--bg-muted))] p-3"><summary className="cursor-pointer">查看证据 · {evidence.type}</summary><p className="mt-2 break-all">来源：{evidence.sourceRef ?? evidence.id} · {new Date(evidence.recordedAt).toLocaleString('zh-CN')}</p><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{evidence.content}</pre><div className="mt-2 flex flex-wrap gap-2">{evidence.refs.map((ref) => <EvidenceReference key={ref} item={item} reference={ref} />)}</div></details>)}
        </div>
      </details>)}</div>
      {onOpenReviews && <button type="button" className="mt-4 text-xs underline" onClick={onOpenReviews}>查看项目分支评审（{current.result.projectReviewCount} 项，不计入本工作验收）</button>}
    </>}
  </section>;
}

function EvidenceReference({ item, reference }: { item: ProjectWorkItem; reference: string }) {
  const [open, setOpen] = useState(false);
  const external = safeExternalUrl(reference);
  if (external) return <a href={external} target="_blank" rel="noopener noreferrer" className="break-all text-xs underline">{reference}</a>;
  const query = new URLSearchParams({ projectId: item.projectId, conversationId: item.conversationId, workId: item.id, ref: reference }).toString();
  return <div className="max-w-full"><button type="button" onClick={() => setOpen(!open)} className="break-all text-left text-xs underline" aria-expanded={open}>阅读证据：{reference}</button>{open && <ArtifactPreviewPanel query={query} />}</div>;
}
