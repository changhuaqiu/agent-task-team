'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Database, FlaskConical, RefreshCw, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProjectEvaluationPanel } from './ProjectEvaluationPanel';

type Dataset = {
  id: string; name: string; description: string; revision: number; status: string; case_count: number;
};
type ApplicationSnapshot = {
  id: string; name: string; source: 'published' | 'candidate'; code_revision: string; created_at: string;
};
type Experiment = {
  id: string; name: string; status: string; created_at: string;
  summary?: {
    sampleSize?: number; meanDelta?: number; ci95?: number[]; conclusion?: string;
    executionVerified?: boolean; releaseGateReason?: string;
  };
  executionProgress?: { total: number; completed: number; failed: number };
};
type Review = {
  id: string; reason_code: string; dimension_key?: string; primary_label?: string; secondary_label?: string;
  experiment_name?: string; case_key?: string; created_at: string;
  request_payload?: { datasetId?: string; caseKey?: string; split?: string };
};
type Proposal = {
  id: string; hypothesis: string; proposed_change: string; risk: string; status: string;
  dimension_key?: string; severity?: string; updated_at: string;
  regression_experiment_id?: string; approval_by?: string;
};
type View = 'results' | 'datasets' | 'experiments' | 'reviews' | 'proposals';

const CONCLUSION_LABELS: Record<string, string> = {
  candidate_improves: '候选方案达到改进门槛',
  candidate_regresses: '候选方案回退',
  inconclusive: '证据尚不充分',
  insufficient_evidence: '样本量不足',
};
const REASON_LABELS: Record<string, string> = {
  judge_disagreement: '双 Judge 结论不一致',
  secondary_judge_unavailable: '边界样本缺少第二 Judge',
  pairwise_order_inconsistency: '交换展示顺序后结论不一致',
  case_promotion: '线上失败案例晋升',
};

export function ProjectEvaluationWorkspace({ conversationId, rootTaskId }: {
  conversationId?: string;
  rootTaskId?: string;
}) {
  const [view, setView] = useState<View>('results');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [applicationSnapshots, setApplicationSnapshots] = useState<ApplicationSnapshot[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [actionBusy, setActionBusy] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();
  const [reviewRationales, setReviewRationales] = useState<Record<string, string>>({});
  const [showExperimentCreator, setShowExperimentCreator] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [codeRevision, setCodeRevision] = useState('');
  const [experimentName, setExperimentName] = useState('');
  const [experimentDatasetId, setExperimentDatasetId] = useState('');
  const [baselineSnapshotId, setBaselineSnapshotId] = useState('');
  const [candidateSnapshotId, setCandidateSnapshotId] = useState('');
  const [proposalExperimentIds, setProposalExperimentIds] = useState<Record<string, string>>({});
  const [proposalConfirmations, setProposalConfirmations] = useState<Record<string, boolean>>({});
  const requestSequence = useRef(0);

  const loadWorkspace = async () => {
    if (!conversationId) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const query = `conversationId=${encodeURIComponent(conversationId)}`;
      const responses = await Promise.all([
        fetch(`/api/eval/datasets?${query}`, { cache: 'no-store' }),
        fetch(`/api/eval/experiments?${query}`, { cache: 'no-store' }),
        fetch(`/api/eval/reviews?${query}&status=pending`, { cache: 'no-store' }),
        fetch(`/api/eval/proposals?${query}`, { cache: 'no-store' }),
        fetch(`/api/eval/application-snapshots?${query}`, { cache: 'no-store' }),
      ]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      const failed = responses.findIndex((response) => !response.ok);
      if (failed >= 0) throw new Error(bodies[failed]?.error ?? `HTTP ${responses[failed]!.status}`);
      if (sequence !== requestSequence.current) return;
      setDatasets(bodies[0].datasets ?? []);
      setExperiments(bodies[1].experiments ?? []);
      setReviews(bodies[2].reviews ?? []);
      setProposals(bodies[3].proposals ?? []);
      setApplicationSnapshots(bodies[4].snapshots ?? []);
      setError(undefined);
    } catch (cause) {
      if (sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDatasets([]);
      setExperiments([]);
      setReviews([]);
      setProposals([]);
      setApplicationSnapshots([]);
      setError(undefined);
      void loadWorkspace();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestSequence.current += 1;
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveReview = async (
    review: Review,
    decision: { approved?: boolean; label?: 'pass' | 'partial' | 'fail' },
  ) => {
    const rationale = reviewRationales[review.id]?.trim();
    if (!rationale) {
      setActionMessage('请先填写裁决依据。');
      return;
    }
    setActionBusy(review.id);
    try {
      const casePromotion = review.reason_code === 'case_promotion';
      const response = await fetch('/api/eval/reviews', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(casePromotion
          ? {
            id: review.id, conversationId, action: 'review_case_promotion',
            approved: decision.approved, rationale,
          }
          : {
            id: review.id, conversationId,
            resolution: { label: decision.label, rationale },
          }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setActionMessage('复核结论已保存。');
      setReviewRationales((current) => ({ ...current, [review.id]: '' }));
      await loadWorkspace();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(undefined);
    }
  };

  const transitionProposal = async (
    proposal: Proposal,
    action: 'submit' | 'approve' | 'apply' | 'revert',
  ) => {
    const requiresConfirmation = action === 'approve' || action === 'apply';
    const regressionExperimentId = action === 'approve'
      ? proposalExperimentIds[proposal.id]
      : proposal.regression_experiment_id;
    if (action === 'approve' && !regressionExperimentId) {
      setActionMessage('请先选择通过质量门的 held-out 回归实验。');
      return;
    }
    if (requiresConfirmation && !proposalConfirmations[proposal.id]) {
      setActionMessage('请先完成单一平台操作者明确确认。');
      return;
    }
    setActionBusy(proposal.id);
    try {
      const response = await fetch('/api/eval/proposals', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: proposal.id, conversationId, action,
          regressionExperimentId,
          operatorConfirmed: requiresConfirmation || undefined,
          evidence: ['apply', 'revert'].includes(action)
            ? { source: 'platform_evaluation_workspace', operatorMode: 'single_platform_operator' }
            : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setProposalConfirmations((current) => ({ ...current, [proposal.id]: false }));
      setActionMessage({
        submit: '提案已提交复核。',
        approve: '单一平台操作者已批准提案。',
        apply: '候选变更已记录应用。',
        revert: '提案已记录回退。',
      }[action]);
      await loadWorkspace();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(undefined);
    }
  };

  const freezeSnapshot = async (source: 'published' | 'candidate') => {
    const name = snapshotName.trim();
    if (!name) {
      setActionMessage('请先填写版本名称。');
      return;
    }
    const key = `snapshot-${source}`;
    setActionBusy(key);
    try {
      const response = await fetch('/api/eval/application-snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          name,
          source,
          codeRevision: codeRevision.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      const snapshot = body.snapshot as ApplicationSnapshot;
      if (source === 'published') setBaselineSnapshotId(snapshot.id);
      else setCandidateSnapshotId(snapshot.id);
      setSnapshotName('');
      setCodeRevision('');
      setActionMessage(source === 'published' ? '基线版本已冻结。' : '候选版本已冻结。');
      await loadWorkspace();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(undefined);
    }
  };

  const startRunnerExperiment = async () => {
    if (!experimentName.trim() || !experimentDatasetId || !baselineSnapshotId || !candidateSnapshotId) {
      setActionMessage('请完整选择实验名称、held-out 数据集、基线和候选版本。');
      return;
    }
    setActionBusy('create-experiment');
    try {
      const response = await fetch('/api/eval/experiments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          datasetId: experimentDatasetId,
          name: experimentName.trim(),
          baselineSnapshotId,
          candidateSnapshotId,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setExperimentName('');
      setShowExperimentCreator(false);
      setActionMessage('对比实验已进入 Harness 隔离执行队列。');
      await loadWorkspace();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(undefined);
    }
  };

  if (!conversationId) {
    return <div className="p-6 text-center text-xs text-[hsl(var(--text-tertiary))]">选择项目后进入评估工作台</div>;
  }

  const tabs: Array<{ value: View; label: string; count?: number }> = [
    { value: 'results', label: '结果' },
    { value: 'datasets', label: '数据集', count: datasets.length },
    { value: 'experiments', label: '对比实验', count: experiments.length },
    { value: 'reviews', label: '待复核', count: reviews.length },
    { value: 'proposals', label: '改进提案', count: proposals.length },
  ];
  const eligibleRegressionExperiments = experiments.filter((experiment) =>
    experiment.status === 'completed'
    && experiment.summary?.conclusion === 'candidate_improves'
    && experiment.summary?.executionVerified === true);

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-semibold text-[hsl(var(--text-primary))]">评估</div>
        <div className="text-[9px] text-[hsl(var(--text-tertiary))]">看任务表现，验证改进是否有效</div>
      </div>
      <button type="button" onClick={() => void loadWorkspace()} aria-label="刷新评估工作台"
        className="rounded-md p-1.5 text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-card-hover))]">
        <RefreshCw className={cn('size-3.5', loading && 'animate-spin')}/>
      </button>
    </div>
    <div className="flex gap-1 overflow-x-auto rounded-lg bg-[hsl(var(--bg-muted))] p-0.5 text-[9px]">
      {tabs.map((tab) => <button key={tab.value} type="button" onClick={() => {
        setView(tab.value);
        setActionMessage(undefined);
      }}
        className={cn('shrink-0 rounded-md px-2 py-1.5', view === tab.value && 'bg-[hsl(var(--bg-card))] font-semibold shadow-sm')}>
        {tab.label}{tab.count !== undefined && <span className="ml-1 tabular-nums text-[hsl(var(--text-tertiary))]">{tab.count}</span>}
      </button>)}
    </div>
    {error && <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-[9px] text-rose-600">{error}</div>}
    {actionMessage && <div role="status"
      className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] p-2 text-[9px]">
      {actionMessage}
    </div>}
    {view === 'results' && <ProjectEvaluationPanel conversationId={conversationId} rootTaskId={rootTaskId}
      onWorkspaceChanged={() => void loadWorkspace()}/>}
    {view === 'datasets' && <ObjectList empty="还没有评估数据集。创建数据集后，可按 train / tune / held-out 隔离调参与发布验收。">
      {datasets.map((dataset) => <article key={dataset.id} className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-2.5">
        <div className="flex items-start gap-2"><Database className="mt-0.5 size-3.5 text-[hsl(var(--accent))]"/>
          <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold">{dataset.name} · v{dataset.revision}</div>
            <div className="mt-0.5 text-[8px] text-[hsl(var(--text-tertiary))]">{dataset.description}</div>
            <div className="mt-1 text-[8px] tabular-nums text-[hsl(var(--text-secondary))]">{dataset.case_count} 个案例 · {dataset.status}</div>
          </div></div>
      </article>)}
    </ObjectList>}
    {view === 'experiments' && <div className="space-y-2">
      <div className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold">创建对比实验</div>
            <div className="mt-0.5 text-[8px] text-[hsl(var(--text-tertiary))]">
              先冻结基线和候选版本，再用同一 held-out 数据集隔离执行。
            </div>
          </div>
          <button type="button" aria-expanded={showExperimentCreator}
            onClick={() => setShowExperimentCreator((value) => !value)}
            className="rounded-md border border-[hsl(var(--border-subtle))] px-2 py-1 text-[8px]">
            {showExperimentCreator ? '收起' : '开始创建'}
          </button>
        </div>
        {showExperimentCreator && <div className="mt-2 space-y-2 border-t border-[hsl(var(--border-subtle))] pt-2">
          <div className="grid gap-1.5 sm:grid-cols-2">
            <label className="text-[8px]">版本名称
              <input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)}
                placeholder="例如：发布版 1.4 / 候选修复"
                className="mt-1 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-transparent p-1.5 text-[9px]"/>
            </label>
            <label className="text-[8px]">Git commit（可选，默认当前）
              <input value={codeRevision} onChange={(event) => setCodeRevision(event.target.value)}
                placeholder="commit SHA、tag 或分支"
                className="mt-1 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-transparent p-1.5 text-[9px]"/>
            </label>
          </div>
          <div className="flex gap-1">
            <button type="button" disabled={Boolean(actionBusy)}
              onClick={() => void freezeSnapshot('published')}
              className="rounded-md border border-[hsl(var(--border-subtle))] px-2 py-1 text-[8px] disabled:opacity-50">
              冻结为基线
            </button>
            <button type="button" disabled={Boolean(actionBusy)}
              onClick={() => void freezeSnapshot('candidate')}
              className="rounded-md border border-[hsl(var(--border-subtle))] px-2 py-1 text-[8px] disabled:opacity-50">
              冻结为候选
            </button>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <label className="text-[8px]">实验名称
              <input value={experimentName} onChange={(event) => setExperimentName(event.target.value)}
                className="mt-1 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-transparent p-1.5 text-[9px]"/>
            </label>
            <label className="text-[8px]">held-out 数据集
              <select value={experimentDatasetId} onChange={(event) => setExperimentDatasetId(event.target.value)}
                className="mt-1 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-1.5 text-[9px]">
                <option value="">请选择</option>
                {datasets.filter((dataset) => dataset.status === 'active').map((dataset) =>
                  <option key={dataset.id} value={dataset.id}>{dataset.name} · v{dataset.revision}</option>)}
              </select>
            </label>
            <label className="text-[8px]">基线版本
              <select value={baselineSnapshotId} onChange={(event) => setBaselineSnapshotId(event.target.value)}
                className="mt-1 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-1.5 text-[9px]">
                <option value="">请选择</option>
                {applicationSnapshots.map((snapshot) =>
                  <option key={snapshot.id} value={snapshot.id}>{snapshot.name} · {snapshot.code_revision.slice(0, 8)}</option>)}
              </select>
            </label>
            <label className="text-[8px]">候选版本
              <select value={candidateSnapshotId} onChange={(event) => setCandidateSnapshotId(event.target.value)}
                className="mt-1 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-1.5 text-[9px]">
                <option value="">请选择</option>
                {applicationSnapshots.map((snapshot) =>
                  <option key={snapshot.id} value={snapshot.id}>{snapshot.name} · {snapshot.code_revision.slice(0, 8)}</option>)}
              </select>
            </label>
          </div>
          <button type="button" disabled={Boolean(actionBusy)}
            onClick={() => void startRunnerExperiment()}
            className="rounded-md bg-[hsl(var(--accent))] px-2.5 py-1.5 text-[8px] text-white disabled:opacity-50">
            启动隔离对比
          </button>
        </div>}
      </div>
      <ObjectList empty="还没有对比实验。实验只接受同数据集、同评分版本的 held-out 配对运行。">
      {experiments.map((experiment) => <article key={experiment.id} className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-2.5">
        <div className="flex items-start gap-2"><FlaskConical className="mt-0.5 size-3.5 text-[hsl(var(--accent))]"/>
          <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold">{experiment.name}</div>
            <div className="mt-1 grid grid-cols-3 gap-1 text-[8px]">
              <span>{experiment.summary?.sampleSize ?? 0} 对样本</span>
              <span>Δ {experiment.summary?.meanDelta ?? '—'}</span>
              <span>{experiment.status}</span>
            </div>
            {Boolean(experiment.executionProgress?.total) && <div className="mt-1 text-[8px] text-[hsl(var(--text-secondary))]">
              Harness 隔离执行 {experiment.executionProgress?.completed ?? 0}/{experiment.executionProgress?.total ?? 0}
              {Boolean(experiment.executionProgress?.failed) && ` · ${experiment.executionProgress?.failed} 失败`}
              {experiment.summary?.executionVerified && ' · 来源已验证'}
            </div>}
            <div className="mt-1 text-[8px] text-[hsl(var(--text-tertiary))]">
              {CONCLUSION_LABELS[experiment.summary?.conclusion ?? ''] ?? '等待实验结论'}
              {experiment.summary?.ci95 && ` · 95% CI [${experiment.summary.ci95.join(', ')}]`}
              {experiment.summary?.releaseGateReason === 'blind_pairwise_review_required' && ' · 仍需盲评/人工裁决'}
            </div>
          </div></div>
      </article>)}
      </ObjectList>
    </div>}
    {view === 'reviews' && <ObjectList empty="当前没有待人工复核的边界样本或顺序敏感结果。">
      {reviews.map((review) => <article key={review.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
        <div className="flex items-start gap-2"><Scale className="mt-0.5 size-3.5 text-amber-600"/>
          <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold">{REASON_LABELS[review.reason_code] ?? review.reason_code}</div>
            <div className="mt-1 text-[8px] text-[hsl(var(--text-tertiary))]">
              {review.dimension_key ?? review.case_key ?? '实验比较'} · 首次 {review.primary_label ?? '—'} / 复核 {review.secondary_label ?? '—'}
            </div>
            {review.experiment_name && <div className="mt-1 text-[8px]">{review.experiment_name}</div>}
            {review.reason_code === 'case_promotion' && <div className="mt-1 text-[8px] text-[hsl(var(--text-tertiary))]">
              晋升为 {review.request_payload?.split ?? 'train/tune'} 案例：{review.request_payload?.caseKey ?? '未命名案例'}
            </div>}
            <textarea aria-label={`复核依据 ${review.id}`}
              value={reviewRationales[review.id] ?? ''}
              onChange={(event) => setReviewRationales((current) => ({
                ...current, [review.id]: event.target.value,
              }))}
              placeholder="填写证据依据；结论会进入审计记录"
              className="mt-2 min-h-16 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-transparent p-2 text-[9px]"
            />
            {review.reason_code === 'case_promotion' ? <div className="mt-2 flex gap-1">
              <button type="button" disabled={actionBusy === review.id}
                onClick={() => void resolveReview(review, { approved: true })}
                className="rounded-md bg-[hsl(var(--accent))] px-2 py-1 text-[8px] text-white disabled:opacity-50">
                批准晋升
              </button>
              <button type="button" disabled={actionBusy === review.id}
                onClick={() => void resolveReview(review, { approved: false })}
                className="rounded-md border px-2 py-1 text-[8px] disabled:opacity-50">
                拒绝
              </button>
            </div> : ['judge_disagreement', 'secondary_judge_unavailable'].includes(review.reason_code)
              ? <div className="mt-2 flex gap-1">
                {(['pass', 'partial', 'fail'] as const).map((label) => <button key={label} type="button"
                  disabled={actionBusy === review.id}
                  onClick={() => void resolveReview(review, { label })}
                  className="rounded-md border px-2 py-1 text-[8px] disabled:opacity-50">
                  {label}
                </button>)}
              </div>
              : <div className="mt-2 rounded-md bg-amber-500/10 p-2 text-[8px] text-amber-700">
                可信盲测尚未开放；等待平台身份与评估执行模式。
              </div>}
          </div><AlertTriangle className="size-3 text-amber-600"/></div>
      </article>)}
    </ObjectList>}
    {view === 'proposals' && <ObjectList empty="当前没有改进提案。差距只会形成候选提案，不会直接修改 Agent Definition、Skill 或策略。">
      {proposals.map((proposal) => <article key={proposal.id} className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-2.5">
        <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 text-[hsl(var(--accent))]"/>
          <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold">{proposal.hypothesis}</div>
            <div className="mt-1 text-[8px] leading-relaxed text-[hsl(var(--text-tertiary))]">{proposal.proposed_change}</div>
            <div className="mt-1 flex gap-2 text-[8px]"><span>{proposal.status}</span><span>风险 {proposal.risk}</span>
              {proposal.dimension_key && <span>{proposal.dimension_key}</span>}</div>
            {proposal.status === 'draft' && <button type="button" disabled={actionBusy === proposal.id}
              onClick={() => void transitionProposal(proposal, 'submit')}
              className="mt-2 rounded-md bg-[hsl(var(--accent))] px-2 py-1 text-[8px] text-white disabled:opacity-50">
              提交复核
            </button>}
            {proposal.status === 'in_review' && <div className="mt-2 space-y-2 rounded-md bg-amber-500/10 p-2 text-[8px]">
              <div className="text-amber-700">选择已完成、候选改进且执行来源可信的 held-out 回归实验。</div>
              <select aria-label={`held-out 回归实验 ${proposal.hypothesis}`}
                value={proposalExperimentIds[proposal.id] ?? ''}
                onChange={(event) => setProposalExperimentIds((current) => ({
                  ...current, [proposal.id]: event.target.value,
                }))}
                className="w-full rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-1.5">
                <option value="">请选择回归实验</option>
                {eligibleRegressionExperiments.map((experiment) =>
                  <option key={experiment.id} value={experiment.id}>{experiment.name}</option>)}
              </select>
              <OperatorConfirmation proposal={proposal} checked={Boolean(proposalConfirmations[proposal.id])}
                onChange={(checked) => setProposalConfirmations((current) => ({
                  ...current, [proposal.id]: checked,
                }))}/>
              <button type="button" disabled={actionBusy === proposal.id}
                onClick={() => void transitionProposal(proposal, 'approve')}
                className="rounded-md bg-[hsl(var(--accent))] px-2 py-1 text-white disabled:opacity-50">
                确认批准
              </button>
            </div>}
            {proposal.status === 'approved' && <div className="mt-2 space-y-2 rounded-md border border-[hsl(var(--border-subtle))] p-2 text-[8px]">
              <div>已由 {proposal.approval_by ?? 'platform-operator'} 批准；应用将复用已锁定的 held-out 回归实验。</div>
              <OperatorConfirmation proposal={proposal} checked={Boolean(proposalConfirmations[proposal.id])}
                onChange={(checked) => setProposalConfirmations((current) => ({
                  ...current, [proposal.id]: checked,
                }))}/>
              <button type="button" disabled={actionBusy === proposal.id}
                onClick={() => void transitionProposal(proposal, 'apply')}
                className="rounded-md bg-[hsl(var(--accent))] px-2 py-1 text-white disabled:opacity-50">
                确认应用
              </button>
            </div>}
            {proposal.status === 'applied' && <button type="button" disabled={actionBusy === proposal.id}
              onClick={() => void transitionProposal(proposal, 'revert')}
              className="mt-2 rounded-md border px-2 py-1 text-[8px] disabled:opacity-50">
              记录回退
            </button>}
          </div></div>
      </article>)}
    </ObjectList>}
  </div>;
}

function OperatorConfirmation({ proposal, checked, onChange }: {
  proposal: Proposal; checked: boolean; onChange: (checked: boolean) => void;
}) {
  return <label className="flex items-start gap-1.5 leading-relaxed">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}
      aria-label={`单一平台操作者确认 ${proposal.hypothesis}`} className="mt-0.5"/>
    <span>我确认以当前平台操作者身份执行此动作，并接受审计记录。</span>
  </label>;
}

function ObjectList({ children, empty }: { children: React.ReactNode; empty: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <div className="space-y-2">
    {hasChildren ? children : <div className="rounded-lg border border-dashed p-6 text-center text-[10px] leading-relaxed text-[hsl(var(--text-tertiary))]">{empty}</div>}
  </div>;
}
