'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react';
import type { DeliveryRunSnapshot } from '@/server/autonomous-delivery/types';

const STAGE_LABELS: Record<string, string> = {
  submitted: '目标已接收',
  planning: '正在规划',
  executing: '团队执行中',
  reviewing: '正在评审',
  verifying: '正在验收',
  integrating: '正在集成',
  delivering: '正在整理交付',
  recovering: '正在自动恢复',
  completed: '交付完成',
  escalated: '需要你的决策',
  cancelled: '已取消',
};

const VERIFICATION_METHOD_LABELS = {
  web_ui_e2e: 'Web UI 端到端验收',
  automated_test: '自动化验收',
  manual_review: '人工验收',
} as const;

function EvidenceRef({ value }: { value: string }) {
  const isWebUrl = /^https?:\/\//i.test(value);
  if (isWebUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="break-all text-[hsl(var(--accent))] underline underline-offset-2"
      >
        {value}
      </a>
    );
  }
  return <span className="break-all font-mono text-[10px]">{value}</span>;
}

export function AutonomousDeliveryPanel({ conversationId }: { conversationId: string }) {
  const [snapshotState, setSnapshotState] = useState<{
    conversationId: string;
    snapshot: DeliveryRunSnapshot;
  }>();

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const response = await fetch(
        `/api/autonomous-delivery?conversationId=${encodeURIComponent(conversationId)}`,
      );
      if (disposed || response.status === 404 || !response.ok) return;
      setSnapshotState({
        conversationId,
        snapshot: await response.json() as DeliveryRunSnapshot,
      });
    };
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [conversationId]);

  const snapshot = snapshotState?.conversationId === conversationId
    ? snapshotState.snapshot
    : undefined;
  if (!snapshot) return null;
  const { run, contract, bundle } = snapshot;

  if (run.status === 'completed' && bundle) {
    return (
      <section
        data-testid="autonomous-delivery-completed"
        className="mx-4 mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
          <CheckCircle2 className="size-4" />
          交付完成
        </div>
        <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{bundle.summary}</p>
        <div className="mt-3 space-y-2">
          {bundle.acceptanceResults.map((item) => (
            <div
              key={item.criterion}
              className="rounded-lg border border-emerald-500/15 bg-[hsl(var(--bg-card))] px-3 py-2"
            >
              <div className="flex items-start gap-2 text-xs text-[hsl(var(--text-secondary))]">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                <span>{item.criterion}</span>
              </div>
              <div className="mt-1.5 pl-5 text-[10px] text-[hsl(var(--text-tertiary))]">
                <span className="mr-1.5">验收证据</span>
                <span className="space-x-2">
                  {item.evidenceRefs.map((ref) => <EvidenceRef key={ref} value={ref} />)}
                </span>
              </div>
            </div>
          ))}
        </div>
        {bundle.verification && (
          <div className="mt-3 border-t border-emerald-500/15 pt-3 text-xs">
            <div className="font-medium text-[hsl(var(--text-secondary))]">
              {VERIFICATION_METHOD_LABELS[bundle.verification.method]}
              <span className="ml-1.5 text-[hsl(var(--text-tertiary))]">
                · {bundle.verification.tool} · {bundle.verification.verifierAgentId}
              </span>
            </div>
            <div className="mt-1.5 grid gap-1 text-[10px] text-[hsl(var(--text-tertiary))]">
              <div>
                <span className="mr-1.5">验证报告</span>
                <EvidenceRef value={bundle.verification.reportRef} />
              </div>
              {bundle.verification.specRefs.map((ref) => (
                <div key={ref}>
                  <span className="mr-1.5">测试用例</span>
                  <EvidenceRef value={ref} />
                </div>
              ))}
            </div>
          </div>
        )}
        {bundle.review && (
          <div className="mt-3 border-t border-emerald-500/15 pt-3 text-xs">
            <div className="font-medium text-[hsl(var(--text-secondary))]">
              独立质量评审
              <span className="ml-1.5 text-[hsl(var(--text-tertiary))]">
                · {bundle.review.reviewerAgentId}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-[hsl(var(--text-tertiary))]">
              {bundle.review.summary}
            </p>
            <div className="mt-1 grid gap-1 text-[10px] text-[hsl(var(--text-tertiary))]">
              {bundle.review.evidenceRefs.map((ref) => (
                <div key={ref}>
                  <span className="mr-1.5">评审证据</span>
                  <EvidenceRef value={ref} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (run.status === 'escalated') {
    return (
      <section
        data-testid="autonomous-delivery-escalated"
        className="mx-4 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-600">
          <AlertTriangle className="size-4" />
          需要你的决策
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--text-secondary))]">
          {run.escalation_detail ?? '系统无法在当前授权范围内继续。'}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="autonomous-delivery-running"
      className="mx-4 mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-3"
    >
      <div className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin text-[hsl(var(--accent))]" />
        <span className="text-xs font-semibold text-[hsl(var(--text-primary))]">
          {STAGE_LABELS[run.status] ?? STAGE_LABELS[run.current_stage] ?? '自主推进中'}
        </span>
        <span className="ml-auto text-[10px] text-[hsl(var(--text-tertiary))]">
          你可以离开，完成后会在这里交付
        </span>
      </div>
      <p className="mt-1.5 line-clamp-1 text-[11px] text-[hsl(var(--text-tertiary))]">
        {contract.goal}
      </p>
    </section>
  );
}
