'use client';

import { CheckCircle2, CircleDot, ExternalLink, GitCommitHorizontal, GitMerge, GitPullRequest, ShieldCheck, TestTube2, XCircle } from 'lucide-react';
import type { EngineeringCollaborationCard as EngineeringCollaborationCardData } from '@/lib/engineering-collaboration/types';
import { cn } from '@/lib/utils';

interface EngineeringCollaborationCardProps {
  card: EngineeringCollaborationCardData;
  onSelectTask?: (taskId: string) => void;
}

const CHECK_LABEL = {
  pending: '检查中',
  passing: '检查通过',
  failing: '检查失败',
  unknown: '未获取检查',
} as const;

const REVIEW_LABEL = {
  approved: '通过',
  changes_requested: '需要修改',
  commented: '已评论',
} as const;

function ShortSha({ value }: { value: string }) {
  return <span className="font-mono">{value.slice(0, 12)}</span>;
}

export function EngineeringCollaborationCard({ card, onSelectTask }: EngineeringCollaborationCardProps) {
  if (card.kind === 'pull_request') {
    const { receipt, evidence } = card;
    return (
      <section className="mt-2 overflow-hidden rounded-[6px] border border-sky-400/40 bg-sky-500/10 text-[11px]" data-testid="pull-request-collaboration-card">
        <header className="flex items-center justify-between gap-2 border-b border-sky-400/20 px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5 font-bold text-sky-700">
            <GitPullRequest className="h-4 w-4 shrink-0" />
            <span>开发交付</span>
            <span className="truncate font-mono">{receipt.repository}#{receipt.number}</span>
          </div>
          <a href={receipt.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-semibold text-sky-700 hover:underline">
            打开 PR <ExternalLink className="h-3 w-3" />
          </a>
        </header>
        <div className="space-y-2 px-3 py-2.5">
          <div className="font-semibold text-[hsl(var(--text-primary))]">{receipt.title}</div>
          <div className="flex flex-wrap gap-1.5 text-[10px] text-[hsl(var(--text-secondary))]">
            <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--bg-card))]/70 px-1.5 py-0.5"><GitCommitHorizontal className="h-3 w-3" /><ShortSha value={receipt.headSha} /></span>
            <span className="rounded bg-[hsl(var(--bg-card))]/70 px-1.5 py-0.5">{receipt.headRef} → {receipt.baseRef}</span>
            <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5', receipt.checks === 'passing' ? 'bg-emerald-500/15 text-emerald-700' : receipt.checks === 'failing' ? 'bg-rose-500/15 text-rose-700' : 'bg-amber-500/15 text-amber-700')}>
              {receipt.checks === 'passing' ? <CheckCircle2 className="h-3 w-3" /> : receipt.checks === 'failing' ? <XCircle className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
              {CHECK_LABEL[receipt.checks]}
            </span>
          </div>
          <div className="grid gap-1 text-[10px] text-[hsl(var(--text-secondary))] sm:grid-cols-2">
            <div className="inline-flex items-start gap-1"><TestTube2 className="mt-0.5 h-3 w-3 shrink-0" /><span>{evidence.testResult}</span></div>
            <div className="inline-flex items-start gap-1"><ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" /><span>{evidence.impactEvidence}</span></div>
          </div>
          <button type="button" onClick={() => onSelectTask?.(card.taskId)} className="font-mono text-[10px] font-bold text-sky-700 hover:underline">查看 {card.taskId}</button>
        </div>
      </section>
    );
  }

  if (card.kind === 'review') {
    const { receipt, evidence } = card;
    const rejected = receipt.decision === 'changes_requested';
    return (
      <section className={cn('mt-2 overflow-hidden rounded-[6px] border text-[11px]', rejected ? 'border-rose-400/40 bg-rose-500/10' : 'border-emerald-400/40 bg-emerald-500/10')} data-testid="review-collaboration-card">
        <header className={cn('flex items-center justify-between gap-2 border-b px-3 py-2', rejected ? 'border-rose-400/20 text-rose-700' : 'border-emerald-400/20 text-emerald-700')}>
          <div className="flex items-center gap-1.5 font-bold">
            {rejected ? <XCircle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            <span>代码评审 · {REVIEW_LABEL[receipt.decision]}</span>
          </div>
          <a href={receipt.reviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline">查看真实评论 <ExternalLink className="h-3 w-3" /></a>
        </header>
        <div className="space-y-2 px-3 py-2.5">
          <div className="text-[hsl(var(--text-primary))]">{evidence.summary}</div>
          <div className="flex flex-wrap gap-1.5 text-[10px] text-[hsl(var(--text-secondary))]">
            <span className="rounded bg-[hsl(var(--bg-card))]/70 px-1.5 py-0.5">评审 @{card.actorAgentId}</span>
            <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--bg-card))]/70 px-1.5 py-0.5"><GitCommitHorizontal className="h-3 w-3" /><ShortSha value={receipt.headSha} /></span>
            <span className="rounded bg-[hsl(var(--bg-card))]/70 px-1.5 py-0.5">Blocker {evidence.blockerCount}</span>
            {card.stale && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-bold text-amber-700">已有新提交，需要重审</span>}
          </div>
          <div className="inline-flex items-start gap-1 text-[10px] text-[hsl(var(--text-secondary))]"><TestTube2 className="mt-0.5 h-3 w-3 shrink-0" /><span>{evidence.testResult}</span></div>
          <button type="button" onClick={() => onSelectTask?.(card.taskId)} className={cn('block font-mono text-[10px] font-bold hover:underline', rejected ? 'text-rose-700' : 'text-emerald-700')}>查看 {card.taskId}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-2 rounded-[6px] border border-cyan-400/40 bg-cyan-500/10 px-3 py-2.5 text-[11px]" data-testid="merge-collaboration-card">
      <div className="flex items-center gap-1.5 font-bold text-cyan-700"><GitMerge className="h-4 w-4" />合并闭环</div>
      <div className="mt-1 text-[hsl(var(--text-primary))]">{card.receipt.repository}#{card.receipt.pullRequestNumber} 已进入 {card.receipt.baseRef} · <ShortSha value={card.receipt.mergeSha} /></div>
      <div className="mt-1 text-[10px] text-[hsl(var(--text-secondary))]">{card.evidence.mainTestResult}</div>
      <div className="mt-1 text-[10px] text-[hsl(var(--text-secondary))]">{card.evidence.mainImpactReviewResult}</div>
      {card.evidence.remainingRisk && <div className="mt-1 text-[10px] text-amber-700">剩余风险：{card.evidence.remainingRisk}</div>}
      <div className="mt-2 flex gap-3"><a href={card.receipt.pullRequestUrl} target="_blank" rel="noreferrer" className="font-semibold text-cyan-700 hover:underline">打开 PR</a><button type="button" onClick={() => onSelectTask?.(card.taskId)} className="font-mono font-bold text-cyan-700 hover:underline">查看 {card.taskId}</button></div>
    </section>
  );
}
