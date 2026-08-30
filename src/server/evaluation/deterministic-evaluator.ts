import type { EvaluationScore, EvidenceRef, SubjectSnapshot } from './types';

type Row = Record<string, unknown>;
const TERMINAL = new Set(['done', 'abandoned', 'cancelled']);

function evidence(kind: string, rows: Row[]): EvidenceRef[] {
  return rows.slice(0, 20).map((row) => {
    const payload = kind === 'event' && row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? row.payload as Record<string, unknown>
      : {};
    const chainId = row.chain_id ?? payload.chainId ?? payload.chain_id;
    const passId = kind === 'pass' ? row.id : row.pass_id ?? payload.passId ?? payload.pass_id;
    return {
      kind, id: String(row.id ?? row.span_id), taskId: row.task_id ? String(row.task_id) : undefined,
      traceId: row.trace_id ? String(row.trace_id) : undefined,
      chainId: chainId ? String(chainId) : undefined,
      passId: passId ? String(passId) : undefined,
    };
  });
}

function score(dimensionKey: string, kind: 'gate' | 'deterministic', normalizedScore: number | undefined,
  label: EvaluationScore['label'], rationale: string, refs: EvidenceRef[], applicability: EvaluationScore['applicability'] = 'applicable'): EvaluationScore {
  return { dimensionKey, evaluatorKind: kind, evaluatorRevision: 'deterministic-v3',
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
  const hasCollaborationTopology = Array.isArray(data.chains) && Array.isArray(data.passGroups);
  const chains = Array.isArray(data.chains) ? data.chains : snapshot.chainId ? [{ id: snapshot.chainId }] : [];
  const passGroups = Array.isArray(data.passGroups) ? data.passGroups : [];
  const passes = Array.isArray(data.passes) ? data.passes : [];
  const collaborationEvents = Array.isArray(data.collaborationEvents) ? data.collaborationEvents : [];
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

  const receiptStatuses = new Set(['accepted', 'starting', 'started', 'completed']);
  const incompletePasses = passes.filter((pass) => !receiptStatuses.has(String(pass.status)));
  const handoffApplicability = chains.length === 0 ? 'not_applicable' : passes.length === 0 ? 'unknown' : 'applicable';
  scores.push(score('gate.handoff_receipts', 'gate', passes.length === 0 ? undefined : incompletePasses.length ? 0 : 100,
    passes.length === 0 ? 'unknown' : incompletePasses.length ? 'fail' : 'pass',
    chains.length === 0 ? '该根任务没有协作链，交接回执门禁不适用。'
      : passes.length === 0 ? '根任务关联了协作链但没有交接数据，不能判断回执完整性。'
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
  const failures = invocations.filter((item) =>
    (item.status === 'terminated' && item.outcome !== 'completed')
    || Number(item.exit_code ?? 0) !== 0
  ).length;
  const reliability = invocations.length ? Math.max(0, 100 - failures / invocations.length * 100) : undefined;
  scores.push(score('reliability', 'deterministic', reliability,
    reliability === undefined ? 'unknown' : reliability >= 90 ? 'pass' : reliability >= 60 ? 'partial' : 'fail',
    invocations.length ? `${failures}/${invocations.length} 次调用失败。` : '没有调用数据。',
    evidence('invocation', invocations), invocations.length ? 'applicable' : 'unknown'));

  const receiptCount = passes.length - incompletePasses.length;
  const handoffReliability = hasCollaborationTopology && passes.length
    ? receiptCount / passes.length * 100 : undefined;
  scores.push(score('handoff_reliability', 'deterministic', handoffReliability,
    handoffReliability === undefined ? 'unknown' : handoffReliability === 100 ? 'pass'
      : handoffReliability > 0 ? 'partial' : 'fail',
    !hasCollaborationTopology ? '旧快照缺少协作组拓扑，不能计算 v3 交接可靠性。'
      : passes.length ? `${receiptCount}/${passes.length} 个交接已收到 accepted/started/completed 回执。`
        : chains.length ? '协作链没有可评测的 pass。' : '该根任务没有协作链。',
    evidence('pass', passes), !hasCollaborationTopology ? 'unknown'
      : chains.length === 0 ? 'not_applicable' : passes.length ? 'applicable' : 'unknown'));

  const expectedBranches = passGroups.reduce((sum, group) => sum + Number(group.expected_count ?? 0), 0);
  const successfulBranches = passes.filter((pass) => pass.status === 'completed'
    && pass.group_id && passGroups.some((group) => group.id === pass.group_id)).length;
  const settledBranches = passGroups.reduce((sum, group) => sum + Number(group.resolved_count ?? 0), 0);
  const branchCompletion = expectedBranches ? successfulBranches / expectedBranches * 100 : undefined;
  scores.push(score('branch_completion', 'deterministic', branchCompletion,
    branchCompletion === undefined ? 'unknown' : branchCompletion === 100 ? 'pass'
      : branchCompletion > 0 ? 'partial' : 'fail',
    expectedBranches ? `${successfulBranches}/${expectedBranches} 个协作分支成功完成，${settledBranches}/${expectedBranches} 个已结算。`
      : hasCollaborationTopology ? '没有分支型协作组。' : '旧快照缺少协作组拓扑，不能判断分支完成度。',
    [...evidence('pass_group', passGroups), ...evidence('pass', passes)],
    !hasCollaborationTopology ? 'unknown' : passGroups.length ? 'applicable' : 'not_applicable'));

  const fanoutGroups = passGroups.filter((group) => group.mode === 'fan_out');
  const resolvedGroups = fanoutGroups.filter((group) =>
    Number(group.resolved_count ?? 0) === Number(group.expected_count ?? 0));
  const consistentGroups = resolvedGroups.filter((group) => {
    const branches = passes.filter((pass) => pass.group_id === group.id);
    return group.status === 'completed' && branches.length === Number(group.expected_count ?? 0)
      && branches.every((pass) => receiptStatuses.has(String(pass.status)));
  });
  const joinScore = fanoutGroups.length ? consistentGroups.length / fanoutGroups.length * 100 : undefined;
  scores.push(score('fanout_join', 'deterministic', joinScore,
    joinScore === undefined ? 'unknown' : joinScore === 100 ? 'pass' : joinScore > 0 ? 'partial' : 'fail',
    fanoutGroups.length
      ? `${resolvedGroups.length}/${fanoutGroups.length} 个并行组分支已收齐，${consistentGroups.length}/${fanoutGroups.length} 个组的终态与分支一致。`
      : hasCollaborationTopology ? '该根任务没有 fan-out 协作，并行汇合不适用。' : '旧快照缺少协作组拓扑，不能判断并行汇合。',
    [...evidence('pass_group', fanoutGroups), ...evidence('pass', passes)],
    !hasCollaborationTopology ? 'unknown' : fanoutGroups.length ? 'applicable' : 'not_applicable'));

  const failedPasses = passes.filter((pass) => ['blocked', 'rejected', 'timeout', 'error'].includes(String(pass.status)));
  const failureEvents = collaborationEvents.filter((event) => event.type === 'a2a.pass.failed');
  const recoveryEvents = collaborationEvents.filter((event) => event.type === 'a2a.pass.group_recovery_opened');
  const unhealthyGroups = passGroups.filter((group) => ['recovering', 'failed', 'cancelled'].includes(String(group.status)));
  const activeGroups = passGroups.filter((group) => ['offered', 'active'].includes(String(group.status)));
  const recoveryScore = passGroups.length
    ? Math.max(0, 100 - (unhealthyGroups.length + failedPasses.length + activeGroups.length * 0.5)
      / (passGroups.length + passes.length) * 100)
    : undefined;
  scores.push(score('collaboration_recovery', 'deterministic', recoveryScore,
    recoveryScore === undefined ? 'unknown' : recoveryScore === 100 ? 'pass' : recoveryScore >= 60 ? 'partial' : 'fail',
    passGroups.length
      ? `当前失败分支 ${failedPasses.length}，未结算组 ${activeGroups.length}，恢复中/失败组 ${unhealthyGroups.length}；历史失败 ${failureEvents.length}，恢复开启 ${recoveryEvents.length}。`
      : hasCollaborationTopology ? '协作链没有可评测的协作组。' : '旧快照缺少协作组拓扑，不能判断失败与恢复。',
    [...evidence('pass', failedPasses), ...evidence('pass_group', unhealthyGroups),
      ...evidence('event', [...failureEvents, ...recoveryEvents])],
    !hasCollaborationTopology ? 'unknown' : chains.length === 0 ? 'not_applicable'
      : passGroups.length ? 'applicable' : 'unknown'));

  const workAttempts = new Map<string, number>();
  for (const invocation of invocations) {
    if (!invocation.work_id) continue;
    const workId = String(invocation.work_id);
    workAttempts.set(workId, (workAttempts.get(workId) ?? 0) + 1);
  }
  const repeatedInvocations = [...workAttempts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const passKeys = new Map<string, number>();
  for (const pass of passes) {
    const key = [pass.chain_id, pass.from_holder_id, pass.to_agent_id, pass.task_id, pass.intent].map(String).join(':');
    passKeys.set(key, (passKeys.get(key) ?? 0) + 1);
  }
  const repeatedPasses = [...passKeys.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const transitionActions = actions.filter((action) => {
    const payload = action.payload as Record<string, unknown> | undefined;
    return Boolean(payload && (payload.previousStatus || payload.fromStatus
      || payload.status || payload.nextStatus || payload.toStatus));
  });
  const reopens = transitionActions.filter((action) => {
    const payload = action.payload as Record<string, unknown>;
    const previous = String(payload?.previousStatus ?? payload?.fromStatus ?? '');
    const next = String(payload?.status ?? payload?.nextStatus ?? payload?.toStatus ?? '');
    return ['done', 'in_review'].includes(previous) && ['ready', 'in_progress'].includes(next);
  }).length;
  const reworkEvents = repeatedInvocations + repeatedPasses + reopens;
  const reworkDenominator = invocations.length + passes.length + transitionActions.length;
  const reworkScore = reworkDenominator ? Math.max(0, 100 - reworkEvents / reworkDenominator * 100) : undefined;
  scores.push(score('collaboration_rework', 'deterministic', reworkScore,
    reworkScore === undefined ? 'unknown' : reworkScore >= 90 ? 'pass' : reworkScore >= 60 ? 'partial' : 'fail',
    `重复 Work 调用 ${repeatedInvocations}，重复交接 ${repeatedPasses}，任务 reopen ${reopens}。`,
    [...evidence('invocation', invocations), ...evidence('pass', passes), ...evidence('action', actions)],
    reworkDenominator ? 'applicable' : 'not_applicable'));

  const contribution = new Map<string, { calls: number; failures: number; passes: number }>();
  for (const invocation of invocations) {
    const agentId = String(invocation.agent_id ?? 'unknown');
    const current = contribution.get(agentId) ?? { calls: 0, failures: 0, passes: 0 };
    current.calls += 1;
    if ((invocation.status === 'terminated' && invocation.outcome !== 'completed')
      || Number(invocation.exit_code ?? 0) !== 0) current.failures += 1;
    contribution.set(agentId, current);
  }
  const knownAgentIds = new Set([
    ...invocations.flatMap((invocation) => invocation.agent_id ? [String(invocation.agent_id)] : []),
    ...passes.flatMap((pass) => pass.to_agent_id ? [String(pass.to_agent_id)] : []),
  ]);
  for (const pass of passes) {
    for (const value of [pass.from_holder_id, pass.to_agent_id]) {
      if (!value) continue;
      const agentId = String(value);
      if (!knownAgentIds.has(agentId)) continue;
      const current = contribution.get(agentId) ?? { calls: 0, failures: 0, passes: 0 };
      current.passes += 1;
      contribution.set(agentId, current);
    }
  }
  const contributionSummary = [...contribution.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([agentId, value]) => `${agentId}: 调用 ${value.calls}、失败 ${value.failures}、参与交接 ${value.passes}`)
    .join('；');
  scores.push(score('agent_contribution', 'deterministic', undefined, 'unknown',
    contributionSummary || '没有可归属到该根任务的 Agent 调用或交接。',
    [...evidence('invocation', invocations), ...evidence('pass', passes)],
    contribution.size ? 'applicable' : 'not_applicable'));
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
