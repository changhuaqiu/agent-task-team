'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle } from 'lucide-react';
import type { DeliveryRunSnapshot } from '@/server/autonomous-delivery/types';
import type { DeliveryWorkspaceView } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';
import { workspaceCommandGateway } from '@/lib/workspace-command';

const STAGE_LABELS: Record<string, string> = {
  planning: '正在规划',
  executing: '团队执行中',
  reviewing: '正在评审',
  verifying: '正在验收',
  integrating: '正在集成',
  delivering: '正在整理交付',
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

export function AutonomousDeliveryPanel({
  conversationId,
  stage,
  onSnapshotChange,
}: {
  conversationId: string;
  stage?: DeliveryWorkspaceView['stage'];
  onSnapshotChange?: (snapshot: DeliveryRunSnapshot | undefined) => void;
}) {
  const [snapshot, setSnapshot] = useState<DeliveryRunSnapshot>();
  const [resumePending, setResumePending] = useState(false);
  const [resumeError, setResumeError] = useState<string>();
  const resumeCommandId = useRef<string | undefined>(undefined);
  const [expandedRunId, setExpandedRunId] = useState<string>();

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const response = await fetch(
        `/api/autonomous-delivery?conversationId=${encodeURIComponent(conversationId)}`,
      );
      if (disposed || response.status === 404 || !response.ok) return;
      const nextSnapshot = await response.json() as DeliveryRunSnapshot;
      setSnapshot(nextSnapshot);
      onSnapshotChange?.(nextSnapshot);
    };
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [conversationId, onSnapshotChange]);

  if (!snapshot) return null;
  const { run, contract, bundle } = snapshot;
  const displayedStage = stage ?? run.current_stage;
  const resume = async () => {
    setResumePending(true);
    setResumeError(undefined);
    try {
      const idempotencyKey = resumeCommandId.current ?? globalThis.crypto.randomUUID();
      resumeCommandId.current = idempotencyKey;
      const receipt = await workspaceCommandGateway.submit({
        type: 'delivery.advance',
        deliveryId: conversationId,
        projectPath: snapshot.contract.scope.projectPath ?? '',
        actor: { type: 'user', id: 'webui:local-user' },
        issuedAt: new Date().toISOString(),
        runId: run.id,
        idempotencyKey,
      });
      const payload = receipt.result as { snapshot?: DeliveryRunSnapshot } | undefined;
      if (receipt.status !== 'accepted' || !payload?.snapshot) throw new Error(receipt.userMessage ?? '无法继续运行');
      setSnapshot(payload.snapshot);
      onSnapshotChange?.(payload.snapshot);
      resumeCommandId.current = undefined;
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : String(error));
    } finally {
      setResumePending(false);
    }
  };

  if (run.status === 'completed' && bundle) {
    const detailsOpen = expandedRunId === run.id;
    const passedCount = bundle.acceptanceResults.filter((item) => item.status === 'passed').length;
    return (
      <section
        data-testid="autonomous-delivery-completed"
        className="mx-4 mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
              <CheckCircle2 className="size-4 shrink-0" />
              交付完成
              <span className="font-normal text-[hsl(var(--text-tertiary))]">
                · {passedCount}/{bundle.acceptanceResults.length} 项验收通过
              </span>
            </div>
            <p
              className={`mt-1.5 text-sm text-[hsl(var(--text-primary))] ${
                detailsOpen ? '' : 'line-clamp-2'
              }`}
            >
              {bundle.summary}
            </p>
          </div>
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls="autonomous-delivery-details"
            onClick={() => setExpandedRunId(detailsOpen ? undefined : run.id)}
            className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/20 px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            {detailsOpen ? '收起详情' : '查看验收详情'}
            <ChevronDown
              className={`size-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
        {detailsOpen && (
          <div id="autonomous-delivery-details" className="mt-3 border-t border-emerald-500/15 pt-3">
            <div className="space-y-2">
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
                    <span>验收证据</span>
                    <div className="mt-0.5 grid gap-0.5">
                      {item.evidenceRefs.map((ref) => <EvidenceRef key={ref} value={ref} />)}
                    </div>
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
          </div>
        )}
      </section>
    );
  }

  if (run.status === 'waiting_human') {
    return (
      <section
        data-testid="autonomous-delivery-waiting-human"
        className="mx-4 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-600">
          <AlertTriangle className="size-4" />
          需要你的决策
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--text-secondary))]">
          {run.escalation_detail ?? '系统无法在当前授权范围内继续。'}
        </p>
        <button
          type="button"
          disabled={resumePending}
          onClick={() => void resume()}
          className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {resumePending ? '正在继续…' : '我已处理，继续'}
        </button>
        {resumeError && (
          <p role="alert" className="mt-2 text-xs text-red-600">{resumeError}</p>
        )}
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
          {run.status === 'retrying'
            ? '正在自动恢复'
            : run.status === 'waiting_gate'
              ? `等待${STAGE_LABELS[displayedStage] ?? '验收'}结果`
              : STAGE_LABELS[displayedStage] ?? '自主推进中'}
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
