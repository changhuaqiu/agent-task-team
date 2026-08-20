'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, FlaskConical, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openAgentObservabilityDrawer } from './agent-observability-controller';

type Run = {
  id: string; status: string; gate_status: string; overall_score?: number;
  evidence_coverage: number; created_at: string; error_message?: string;
};
type EvidenceReference = {
  kind: string; id: string; traceId?: string; taskId?: string; chainId?: string; passId?: string;
};
type Report = {
  run: Run;
  snapshot?: {
    data_quality?: { missing?: string[]; truncated?: string[] };
    evidence_refs?: EvidenceReference[];
  };
  scores: Array<{ id: string; dimension_key: string; evaluator_kind: string; label: string; applicability?: string;
    normalized_score?: number; rationale: string;
    evidence_refs?: EvidenceReference[] }>;
  gaps: Array<{ id: string; severity: string; dimension_key: string; description: string; suggestion: string }>;
};

const LABELS: Record<string, string> = {
  completion: '任务完成度', delivery: '交付证据', reliability: '执行可靠性', efficiency: '工具执行成功率',
  correctness: '结果正确性', tool_correctness: '工具选择与参数正确性',
  instruction_following: '指令遵循', collaboration: '协作质量', clarity: '交付清晰度',
  'gate.task_completion': '完成门禁', 'gate.delivery_evidence': '交付门禁',
  'gate.valid_exit': '有效退出', 'gate.handoff_receipts': '交接回执', 'gate.safety': '安全门禁',
};
const DATA_SOURCE_LABELS: Record<string, string> = {
  tasks: '任务事实',
  spans: '调用轨迹',
  proofs: '控制证据',
  handoff_receipts: '交接回执',
  code_revision: '代码版本',
  team_configuration_revision: '团队配置版本',
  skill_revision: 'Skill 版本',
  model_configuration_revision: '模型配置版本',
};
const RESULT_LABELS: Record<string, string> = {
  pass: '符合',
  partial: '需关注',
  fail: '未达到',
  unknown: '证据不足',
};

type Decision = {
  key: 'passed' | 'failed' | 'insufficient' | 'error';
  label: string;
  description: string;
};

function decisionFor(report: Report): Decision {
  const applicableGates = report.scores.filter((item) =>
    item.evaluator_kind === 'gate' && item.applicability !== 'not_applicable');
  if (report.run.status === 'failed') {
    return { key: 'error', label: '评估未完成', description: '本次评估执行失败，请查看原因后重试。' };
  }
  if (report.run.gate_status === 'fail' || applicableGates.some((item) => item.label === 'fail')) {
    return { key: 'failed', label: '未通过', description: '至少一个关键条件未达到，当前结果不能作为合格交付。' };
  }
  if (report.run.gate_status === 'pass' && report.run.status === 'completed') {
    return { key: 'passed', label: '通过', description: '所有适用的关键条件均已满足。' };
  }
  return {
    key: 'insufficient',
    label: '证据不足',
    description: '关键条件或评估证据不完整，当前分数只代表已经评到的部分。',
  };
}

function decisionLabelForRun(run: Run): string {
  if (run.status === 'failed') return '评估未完成';
  if (run.gate_status === 'pass' && run.status === 'completed') return '通过';
  if (run.gate_status === 'fail') return '未通过';
  return '证据不足';
}

function formatScore(value: number | undefined): string {
  if (value === undefined || value === null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function ProjectEvaluationPanel({ conversationId, onWorkspaceChanged }: {
  conversationId?: string;
  onWorkspaceChanged?: () => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [report, setReport] = useState<Report>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();
  const [proposalCreating, setProposalCreating] = useState<string>();
  const requestSequence = useRef(0);
  const activeConversation = useRef(conversationId);
  const refreshTimer = useRef<number | undefined>(undefined);

  const load = async () => {
    if (!conversationId) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/eval/runs?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      const nextRuns = Array.isArray(body.runs) ? body.runs : [];
      if (sequence !== requestSequence.current) return;
      setRuns(nextRuns);
      const selectedId = nextRuns.some((run: Run) => run.id === report?.run.id)
        ? report?.run.id : nextRuns[0]?.id;
      if (selectedId) {
        const detail = await fetch(`/api/eval/runs/${encodeURIComponent(selectedId)}?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' });
        if (detail.ok) {
          const nextReport = await detail.json();
          if (sequence === requestSequence.current) setReport(nextReport);
        }
        else if (sequence === requestSequence.current) setReport(undefined);
      } else if (sequence === requestSequence.current) setReport(undefined);
      if (sequence === requestSequence.current) setError(undefined);
    } catch (cause) {
      if (sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    activeConversation.current = conversationId;
    const timer = window.setTimeout(() => {
      setRuns([]);
      setReport(undefined);
      setError(undefined);
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current);
      requestSequence.current += 1;
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectRun = async (runId: string) => {
    if (!conversationId) return;
    const sequence = ++requestSequence.current;
    const response = await fetch(`/api/eval/runs/${encodeURIComponent(runId)}?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' });
    const nextReport = response.ok ? await response.json() : undefined;
    if (sequence === requestSequence.current) setReport(nextReport);
  };
  const submit = async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const response = await fetch('/api/eval/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, mode: 'online' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const scheduledFor = conversationId;
      refreshTimer.current = window.setTimeout(() => {
        if (activeConversation.current === scheduledFor) void load();
      }, 500);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  const replay = async () => {
    if (!report) return;
    const response = await fetch(`/api/eval/runs/${encodeURIComponent(report.run.id)}/replay`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId }),
    });
    if (!response.ok) setError((await response.json()).error);
    else {
      const scheduledFor = conversationId;
      refreshTimer.current = window.setTimeout(() => {
        if (activeConversation.current === scheduledFor) void load();
      }, 500);
    }
  };
  const createProposal = async (gap: Report['gaps'][number]) => {
    if (!conversationId) return;
    setProposalCreating(gap.id);
    try {
      const response = await fetch('/api/eval/proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          gapId: gap.id,
          targetType: 'evaluation_policy',
          hypothesis: gap.description,
          proposedChange: gap.suggestion,
          risk: gap.severity,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setActionMessage('已生成 draft 改进提案，请到“改进提案”中提交复核。');
      onWorkspaceChanged?.();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProposalCreating(undefined);
    }
  };

  if (!conversationId) return <div className="p-6 text-center text-xs text-[hsl(var(--text-tertiary))]">选择项目后查看评估结果</div>;
  const decision = report ? decisionFor(report) : undefined;
  const gateScores = report?.scores.filter((item) => item.evaluator_kind === 'gate') ?? [];
  const dimensionScores = report?.scores.filter((item) => item.evaluator_kind !== 'gate') ?? [];
  const gateIssues = gateScores.filter((item) =>
    item.applicability !== 'not_applicable' && item.label !== 'pass');
  const qualityScores = dimensionScores.filter((item) =>
    item.applicability !== 'not_applicable'
    && item.normalized_score !== undefined
    && item.label !== 'unknown')
    .sort((left, right) => {
      const priority: Record<string, number> = { fail: 0, partial: 1, pass: 2 };
      return (priority[left.label] ?? 3) - (priority[right.label] ?? 3);
    })
    .slice(0, 4);
  const missing = report?.snapshot?.data_quality?.missing ?? [];
  const truncated = report?.snapshot?.data_quality?.truncated ?? [];
  const taskEvidenceGateKeys = new Set(['gate.task_completion', 'gate.delivery_evidence', 'gate.valid_exit']);
  const taskEvidenceIssues = gateIssues.filter((item) => taskEvidenceGateKeys.has(item.dimension_key));
  const otherGateIssues = gateIssues.filter((item) => !taskEvidenceGateKeys.has(item.dimension_key));
  const remainingMissing = missing.filter((item) => item !== 'tasks' || taskEvidenceIssues.length === 0);
  const reasons = report ? [...new Set([
    report.run.error_message,
    taskEvidenceIssues.length >= 2
      ? '没有完整的任务执行记录，无法判断任务完成、交付和有效退出。'
      : taskEvidenceIssues[0]?.rationale,
    ...otherGateIssues.map((item) => item.rationale),
    remainingMissing.length
      ? `缺少${remainingMissing.map((item) => DATA_SOURCE_LABELS[item] ?? item).join('、')}。`
      : undefined,
  ].filter((item): item is string => Boolean(item)))].slice(0, 4) : [];

  return <div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><div className="text-xs font-semibold">评估结果</div><div className="text-[9px] text-[hsl(var(--text-tertiary))]">先看结论，再按需展开完整证据</div></div>
      <div className="flex gap-1">
        <button type="button" onClick={() => void load()} aria-label="刷新评估" className="rounded-md p-1.5 hover:bg-[hsl(var(--bg-card-hover))]"><RefreshCw className={cn('size-3.5', loading && 'animate-spin')}/></button>
        <button type="button" onClick={() => void submit()} className="rounded-md bg-[hsl(var(--accent))] px-2 py-1 text-[9px] text-white">重新诊断</button>
      </div>
    </div>
    {error && <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-[9px] text-rose-600">{error}</div>}
    {actionMessage && <div role="status" className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] p-2 text-[9px]">
      {actionMessage}
    </div>}
    {runs.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-[10px] text-[hsl(var(--text-tertiary))]">
      <FlaskConical className="mx-auto mb-2 size-5"/>任务关闭后会自动生成评估，也可以现在运行一次项目诊断。
    </div> : <>
      <div className="flex items-end justify-between gap-3">
        <label className="min-w-0 text-[8px] text-[hsl(var(--text-tertiary))]">
          评估记录
          <select aria-label="评估记录" value={report?.run.id ?? ''} onChange={(event) => void selectRun(event.target.value)}
            className="mt-1 block max-w-full rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-2 py-1.5 text-[9px] text-[hsl(var(--text-primary))]">
            {runs.map((run) => <option key={run.id} value={run.id}>
              {new Date(run.created_at).toLocaleString()} · {decisionLabelForRun(run)}
            </option>)}
          </select>
        </label>
      </div>
      {report && decision && <div className="space-y-4">
        <section aria-label="本次评估结论" className={cn(
          'rounded-xl border p-4',
          decision.key === 'passed' && 'border-emerald-500/30 bg-emerald-500/5',
          decision.key === 'failed' && 'border-rose-500/30 bg-rose-500/5',
          decision.key === 'insufficient' && 'border-amber-500/30 bg-amber-500/5',
          decision.key === 'error' && 'border-rose-500/30 bg-rose-500/5',
        )}>
          <div className="flex items-start gap-3">
            {decision.key === 'passed' ? <CheckCircle2 className="mt-0.5 size-5 text-emerald-600"/>
              : decision.key === 'insufficient' ? <CircleHelp className="mt-0.5 size-5 text-amber-600"/>
                : decision.key === 'failed' ? <XCircle className="mt-0.5 size-5 text-rose-600"/>
                  : <AlertTriangle className="mt-0.5 size-5 text-rose-600"/>}
            <div className="min-w-0 flex-1">
              <div className="text-[8px] font-medium uppercase tracking-wider text-[hsl(var(--text-tertiary))]">本次结论</div>
              <h2 className="mt-0.5 text-xl font-bold">{decision.label}</h2>
              <div className="mt-1 text-[9px] leading-relaxed text-[hsl(var(--text-secondary))]">{decision.description}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[8px]">
            <span className="rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-2 py-1">
              证据覆盖 {Math.round(report.run.evidence_coverage * 100)}%
            </span>
            {report.run.overall_score !== undefined && <span className="rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-2 py-1">
              {decision.key === 'passed' ? '质量得分' : '已评维度得分'} {formatScore(report.run.overall_score)}
            </span>}
            <span className="rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-2 py-1">
              {new Date(report.run.created_at).toLocaleString()}
            </span>
          </div>
        </section>

        {reasons.length > 0 && <section>
          <div className="mb-2 text-[10px] font-semibold">为什么</div>
          <div className="space-y-1.5">
            {reasons.map((reason) => <div key={reason}
              className="flex gap-2 rounded-lg border border-amber-500/20 bg-[hsl(var(--bg-card))] p-2.5 text-[9px] leading-relaxed">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600"/>
              <span>{reason}</span>
            </div>)}
          </div>
        </section>}

        {qualityScores.length > 0 && <section>
          <div className="mb-2">
            <div className="text-[10px] font-semibold">已观察到的表现</div>
            <div className="text-[8px] text-[hsl(var(--text-tertiary))]">只展示当前有充分数据的指标</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {qualityScores.map((item) => <div key={item.id} className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold">{LABELS[item.dimension_key] ?? item.dimension_key}</span>
                <span className={cn('text-[9px] font-bold',
                  item.label === 'pass' && 'text-emerald-600',
                  item.label === 'partial' && 'text-amber-600',
                  item.label === 'fail' && 'text-rose-600')}>
                  {formatScore(item.normalized_score)} · {RESULT_LABELS[item.label] ?? item.label}
                </span>
              </div>
              <div className="mt-1 text-[8px] leading-relaxed text-[hsl(var(--text-tertiary))]">{item.rationale}</div>
            </div>)}
          </div>
        </section>}

        {report.gaps.length > 0 && <section>
          <div className="mb-2 text-[10px] font-semibold">下一步</div>
          <div className="space-y-2">
          {report.gaps.map((gap) => <div key={gap.id} className="mb-2 text-[8px]">
            <div className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-3">
              <div className="font-semibold">{LABELS[gap.dimension_key] ?? gap.dimension_key}</div>
              <div className="mt-1 leading-relaxed text-[hsl(var(--text-secondary))]">{gap.suggestion}</div>
            <button type="button" disabled={proposalCreating === gap.id}
              onClick={() => void createProposal(gap)}
              className="mt-1 rounded-md border border-amber-500/40 px-2 py-1 disabled:opacity-50">
              生成改进提案
            </button>
            </div>
          </div>)}
          </div>
        </section>}

        <details className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-[9px] font-semibold">
            完整评分与证据
            <span className="ml-2 font-normal text-[hsl(var(--text-tertiary))]">{gateScores.length} 个关键条件 · {dimensionScores.length} 个评分维度</span>
          </summary>
          <div className="space-y-4 border-t border-[hsl(var(--border-subtle))] p-3">
            <section className="space-y-1.5">
              <div className="text-[9px] font-semibold">全部关键条件</div>
              {gateScores.map((item) => <ScoreRow key={item.id} item={item} conversationId={conversationId}/>)}
            </section>
            <section className="space-y-1.5">
              <div className="text-[9px] font-semibold">全部评分维度</div>
              {dimensionScores.map((item) => <ScoreRow key={item.id} item={item} conversationId={conversationId}/>)}
            </section>
            {(missing.length > 0 || truncated.length > 0) && <section className="rounded-lg bg-[hsl(var(--bg-muted))] p-2.5">
              <div className="text-[9px] font-semibold">证据质量</div>
              {missing.length > 0 && <div className="mt-1 text-[8px] text-[hsl(var(--text-secondary))]">
                缺少：{missing.map((item) => DATA_SOURCE_LABELS[item] ?? item).join('、')}
              </div>}
              {truncated.length > 0 && <div className="text-[8px] text-[hsl(var(--text-secondary))]">
                {truncated.length} 条内容因长度限制被截断
              </div>}
              <EvidenceLinks refs={report.snapshot?.evidence_refs} conversationId={conversationId}/>
            </section>}
            <button type="button" onClick={() => void replay()} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px]">
              <RotateCcw className="size-3"/>按冻结证据重放
            </button>
          </div>
        </details>
      </div>}
    </>}
  </div>;
}

function ScoreRow({ item, conversationId }: {
  item: Report['scores'][number]; conversationId: string;
}) {
  return <div className="rounded-md border border-[hsl(var(--border-subtle))] p-2">
    <div className="flex items-center justify-between"><div className="flex items-center gap-1 text-[10px] font-semibold">
      {item.label === 'pass' ? <CheckCircle2 className="size-3 text-emerald-500"/> : item.label === 'fail' ? <AlertTriangle className="size-3 text-rose-500"/> : null}
      {LABELS[item.dimension_key] ?? item.dimension_key}</div>
      <span className="text-[9px] font-bold">{formatScore(item.normalized_score)} · {RESULT_LABELS[item.label] ?? item.label}</span>
    </div>
    <div className="mt-1 text-[8px] leading-relaxed text-[hsl(var(--text-tertiary))]">{item.rationale}</div>
    <EvidenceLinks refs={item.evidence_refs} conversationId={conversationId}/>
  </div>;
}

function EvidenceLinks({ refs, conversationId }: {
  refs?: EvidenceReference[]; conversationId: string;
}) {
  if (!refs?.length) return null;
  return <details className="mt-1">
    <summary className="cursor-pointer text-[8px] text-[hsl(var(--accent))]">查看证据 {refs.length}</summary>
    <div className="mt-1 flex flex-wrap gap-1">
      {refs.slice(0, 8).map((ref) => <button key={`${ref.kind}:${ref.id}`} type="button"
        onClick={() => openAgentObservabilityDrawer({
          conversationId,
          traceId: ref.traceId,
          taskId: ref.taskId,
          chainId: ref.chainId,
          passId: ref.passId,
        })}
        disabled={!ref.traceId && !ref.taskId && !ref.chainId && !ref.passId}
        className="rounded border px-1 py-0.5 font-mono text-[7px] disabled:cursor-default">
        {ref.kind}:{ref.id}
      </button>)}
    </div>
  </details>;
}
