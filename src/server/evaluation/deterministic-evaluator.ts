import type { EvaluationScore, EvidenceRef, SubjectSnapshot } from './types';

type Row = Record<string, unknown>;
const TERMINAL = new Set(['done', 'abandoned', 'cancelled']);

function evidence(kind: string, rows: Row[]): EvidenceRef[] {
  return rows.slice(0, 20).map((row) => ({
    kind, id: String(row.id ?? row.span_id), taskId: row.task_id ? String(row.task_id) : undefined,
    traceId: row.trace_id ? String(row.trace_id) : undefined,
    chainId: row.chain_id ? String(row.chain_id) : undefined,
    passId: kind === 'pass' ? String(row.id) : row.pass_id ? String(row.pass_id) : undefined,
  }));
}

function score(dimensionKey: string, kind: 'gate' | 'deterministic', normalizedScore: number | undefined,
  label: EvaluationScore['label'], rationale: string, refs: EvidenceRef[], applicability: EvaluationScore['applicability'] = 'applicable'): EvaluationScore {
  return { dimensionKey, evaluatorKind: kind, evaluatorRevision: 'deterministic-v2',
    applicability, normalizedScore, label, rationale, evidenceRefs: refs };
}

type ToolExpectation = { name: string; arguments?: Record<string, unknown> };

function toolExpectations(value: unknown): ToolExpectation[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const labels = value as Record<string, unknown>;
  const source = labels.toolCalls ?? labels.expectedToolCalls ?? labels.tools;
  if (!Array.isArray(source)) return undefined;
  return source.flatMap((item): ToolExpectation[] => {
    if (typeof item === 'string' && item) return [{ name: item }];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string' || !row.name) return [];
    const expectedArguments = row.arguments ?? row.input ?? row.parameters;
    return [{
      name: row.name,
      arguments: expectedArguments && typeof expectedArguments === 'object' && !Array.isArray(expectedArguments)
        ? expectedArguments as Record<string, unknown> : undefined,
    }];
  });
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function containsExpected(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length &&
      expected.every((item, index) => containsExpected(actual[index], item));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>)
      .every(([key, item]) => containsExpected((actual as Record<string, unknown>)[key], item));
  }
  return Object.is(actual, expected);
}

function actionEvidence(actions: Row[], nextStatus: string, requiredFields: string[]): boolean {
  return actions.some((action) => {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || (payload.status !== nextStatus && payload.nextStatus !== nextStatus)) return false;
    const candidate = payload.evidence as Record<string, unknown> | undefined;
    return Boolean(candidate && requiredFields.every((field) => {
      const value = candidate[field];
      return value !== undefined && value !== null && value !== false && value !== '';
    }));
  });
}

export function evaluateDeterministically(snapshot: SubjectSnapshot): EvaluationScore[] {
  const data = snapshot.evidence as Record<string, Row[] | Row | undefined>;
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const actions = Array.isArray(data.taskActions) ? data.taskActions : [];
  const spans = Array.isArray(data.spans) ? data.spans : [];
  const proofs = Array.isArray(data.proofs) ? data.proofs : [];
  const passes = Array.isArray(data.passes) ? data.passes : [];
  const invocations = Array.isArray(data.invocations) ? data.invocations : [];
  const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
  const taskRefs = evidence('task', tasks);
  const proofRefs = evidence('proof', proofs);
  const scores: EvaluationScore[] = [];

  if (tasks.length === 0) {
    scores.push(score('gate.task_completion', 'gate', undefined, 'unknown', '没有冻结到任务事实，不能判断完成状态。', [], 'unknown'));
  } else {
    const terminal = tasks.filter((task) => TERMINAL.has(String(task.status))).length;
    const completed = tasks.filter((task) => task.status === 'done').length;
    const label = terminal === tasks.length && completed === tasks.length ? 'pass'
      : terminal === tasks.length ? 'partial' : 'fail';
    scores.push(score('gate.task_completion', 'gate', completed / tasks.length * 100, label,
      `${completed}/${tasks.length} 个任务为 done，${terminal}/${tasks.length} 个进入终态。`, taskRefs));
  }

  const doneTasks = tasks.filter((task) => task.status === 'done');
  const hasDelivery = doneTasks.length > 0 && actionEvidence(actions, 'done', [
    'mergedToMain', 'mainInstallResult', 'mainBuildResult', 'mainTestResult', 'mainImpactReviewResult',
  ]);
  scores.push(score('gate.delivery_evidence', 'gate', doneTasks.length === 0 ? undefined : hasDelivery ? 100 : 0,
    doneTasks.length === 0 ? 'unknown' : hasDelivery ? 'pass' : 'fail',
    doneTasks.length === 0 ? '没有 done 任务，交付证据不适用。' : hasDelivery ? '发现 done 状态转换证据或交付物引用。' : '任务标记为 done，但没有冻结到交付证据。',
    [...evidence('action', actions), ...evidence('artifact', artifacts)],
    doneTasks.length === 0 ? 'unknown' : 'applicable'));

  const closure = proofs.filter((proof) => proof.event_type === 'chain_closure_dispatched');
  const invalidExit = proofs.filter((proof) => proof.event_type === 'no_valid_exit');
  scores.push(score('gate.valid_exit', 'gate', closure.length === 0 ? undefined : invalidExit.length ? 0 : 100,
    closure.length === 0 ? 'unknown' : invalidExit.length ? 'fail' : 'pass',
    closure.length === 0 ? '没有关闭轮次证据，不能推定有效退出。' : invalidExit.length ? '关闭轮次记录了无效退出。' : '关闭轮次已完成且未记录无效退出。',
    proofRefs, closure.length === 0 ? 'unknown' : 'applicable'));

  const incompletePasses = passes.filter((pass) => !['accepted', 'completed'].includes(String(pass.status)));
  const handoffApplicability = !snapshot.chainId ? 'not_applicable' : passes.length === 0 ? 'unknown' : 'applicable';
  scores.push(score('gate.handoff_receipts', 'gate', passes.length === 0 ? undefined : incompletePasses.length ? 0 : 100,
    passes.length === 0 ? 'unknown' : incompletePasses.length ? 'fail' : 'pass',
    !snapshot.chainId ? '该评估对象没有协作链，交接回执门禁不适用。'
      : passes.length === 0 ? '指定了协作链但没有交接数据，不能判断回执完整性。'
        : incompletePasses.length ? `${incompletePasses.length} 个交接没有完成回执。` : '所有冻结到的交接均有接受或完成回执。',
    evidence('pass', passes), handoffApplicability));

  const safetyFailures = proofs.filter((proof) => /denied|unsafe|secret|policy/i.test(String(proof.reason_code ?? '')));
  scores.push(score('gate.safety', 'gate', safetyFailures.length ? 0 : undefined,
    safetyFailures.length ? 'fail' : 'unknown',
    safetyFailures.length ? '发现安全或策略拒绝证据。' : '当前任务没有显式安全证明源，安全门禁不适用；未发现失败不会被记为通过。',
    evidence('proof', safetyFailures), safetyFailures.length ? 'applicable' : 'not_applicable'));

  const completed = tasks.filter((task) => task.status === 'done').length;
  scores.push(score('completion', 'deterministic', tasks.length ? completed / tasks.length * 100 : undefined,
    tasks.length === 0 ? 'unknown' : completed === tasks.length ? 'pass' : completed ? 'partial' : 'fail',
    tasks.length ? `完成率 ${completed}/${tasks.length}。` : '没有任务数据。', taskRefs,
    tasks.length ? 'applicable' : 'unknown'));
  const deliveryPoints = Math.min(100, artifacts.length * 25 + (hasDelivery ? 50 : 0));
  scores.push(score('delivery', 'deterministic', doneTasks.length ? deliveryPoints : undefined,
    doneTasks.length === 0 ? 'unknown' : deliveryPoints >= 80 ? 'pass' : deliveryPoints > 0 ? 'partial' : 'fail',
    `冻结到 ${artifacts.length} 个交付物引用。`, evidence('artifact', artifacts),
    doneTasks.length ? 'applicable' : 'unknown'));
  const failures = invocations.filter((item) => item.status === 'failed' || Number(item.exit_code ?? 0) !== 0).length;
  const reliability = invocations.length ? Math.max(0, 100 - failures / invocations.length * 100) : undefined;
  scores.push(score('reliability', 'deterministic', reliability,
    reliability === undefined ? 'unknown' : reliability >= 90 ? 'pass' : reliability >= 60 ? 'partial' : 'fail',
    invocations.length ? `${failures}/${invocations.length} 次调用失败。` : '没有调用数据。',
    evidence('invocation', invocations), invocations.length ? 'applicable' : 'unknown'));
  const toolSpans = spans.filter((span) => span.kind === 'tool');
  const completedSpans = toolSpans.filter((span) => span.status === 'ok').length;
  const efficiency = toolSpans.length ? completedSpans / toolSpans.length * 100 : undefined;
  scores.push(score('efficiency', 'deterministic', efficiency,
    efficiency === undefined ? 'unknown' : efficiency >= 90 ? 'pass' : efficiency >= 60 ? 'partial' : 'fail',
    toolSpans.length ? `${completedSpans}/${toolSpans.length} 次工具执行成功；执行成功不代表工具选择或参数正确。` : '没有工具调用，效率指标不适用。',
    evidence('span', toolSpans), toolSpans.length ? 'applicable' : 'not_applicable'));

  const evaluationCase = !Array.isArray(data.evaluationCase) ? data.evaluationCase : undefined;
  const expected = toolExpectations(evaluationCase?.expected_labels);
  const payloads = Array.isArray(data.payloads) ? data.payloads : [];
  if (expected === undefined) {
    scores.push(score('tool_correctness', 'deterministic', undefined, 'unknown',
      '没有定义离线工具预期，因此不评价工具选择与参数正确性。',
      evidence('span', toolSpans), 'not_applicable'));
  } else {
    const actual = toolSpans.map((span) => {
      const attributes = span.attributes && typeof span.attributes === 'object'
        ? span.attributes as Record<string, unknown> : {};
      const input = payloads.find((payload) =>
        payload.span_id === span.span_id && payload.role === 'tool_input');
      return {
        name: String(attributes['gen_ai.tool.name'] ?? span.name ?? ''),
        arguments: parsePayload(input?.content),
      };
    });
    const matched = expected.filter((item) => actual.some((candidate) =>
      candidate.name === item.name && containsExpected(candidate.arguments, item.arguments))).length;
    const normalized = expected.length === 0 ? (actual.length === 0 ? 100 : 0) : matched / expected.length * 100;
    scores.push(score('tool_correctness', 'deterministic', normalized,
      normalized === 100 ? 'pass' : normalized > 0 ? 'partial' : 'fail',
      `${matched}/${expected.length} 个预期工具调用在名称与必需参数上匹配。`,
      evidence('span', toolSpans), 'applicable'));
  }
  return scores;
}
