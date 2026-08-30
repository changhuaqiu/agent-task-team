import type Database from 'better-sqlite3';

export type EvaluationEvidenceRow = Record<string, unknown>;

export interface EvaluationExecutionEvidence {
  contracts: EvaluationEvidenceRow[];
  authorities: EvaluationEvidenceRow[];
  outcomes: EvaluationEvidenceRow[];
  chains: EvaluationEvidenceRow[];
  passGroups: EvaluationEvidenceRow[];
  passes: EvaluationEvidenceRow[];
  collaborationEvents: EvaluationEvidenceRow[];
  lateFacts: string[];
  invocations: EvaluationEvidenceRow[];
  spans: EvaluationEvidenceRow[];
  taskIds: Set<string>;
  contractIds: Set<string>;
  workIds: Set<string>;
  chainIds: Set<string>;
  passIds: Set<string>;
  invocationIds: Set<string>;
}

type CollectInput = {
  conversationId: string;
  taskIds: Set<string>;
  cutoffAt: string;
  chainId?: string;
};

function values(rows: EvaluationEvidenceRow[], key: string): Set<string> {
  return new Set(rows.flatMap((row) => row[key] === null || row[key] === undefined
    ? [] : [String(row[key])]));
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

function stateKnownAt(row: EvaluationEvidenceRow, cutoffAt: string, field = 'updated_at'): boolean {
  const value = row[field];
  return value === null || value === undefined || String(value) <= cutoffAt;
}

function rowsIn(
  db: Database.Database,
  sql: (inClause: string) => string,
  valuesToBind: Iterable<string>,
  before: unknown[] = [],
  after: unknown[] = [],
): EvaluationEvidenceRow[] {
  const items = [...valuesToBind];
  if (items.length === 0) return [];
  return db.prepare(sql(placeholders(items.length))).all(...before, ...items, ...after) as EvaluationEvidenceRow[];
}

/**
 * Builds the authoritative execution-membership closure for one root task.
 * Snapshot consumers should not reproduce Task → Work → A2A → Invocation joins.
 */
export function collectEvaluationExecutionEvidence(
  db: Database.Database,
  input: CollectInput,
): EvaluationExecutionEvidence {
  if (input.taskIds.size === 0) throw new Error('Evaluation root task has no task membership');

  const deliveryRuns = rowsIn(db, (taskIds) => `SELECT id FROM autonomous_delivery_run
      WHERE conversation_id=? AND root_task_id IN (${taskIds}) AND created_at<=? ORDER BY created_at,id`,
  input.taskIds, [input.conversationId], [input.cutoffAt]);
  const rootDeliveryRunIds = values(deliveryRuns, 'id');
  const taskContracts = rowsIn(db, (taskIds) => `SELECT * FROM work_contract
      WHERE project_id=? AND task_id IN (${taskIds}) AND created_at<=? ORDER BY created_at,id`,
  input.taskIds, [input.conversationId], [input.cutoffAt]);
  const deliveryContracts = rowsIn(db, (runIds) => `SELECT * FROM work_contract
      WHERE project_id=? AND delivery_run_id IN (${runIds}) AND created_at<=? ORDER BY created_at,id`,
  rootDeliveryRunIds, [input.conversationId], [input.cutoffAt]);
  const contracts = [...new Map([...taskContracts, ...deliveryContracts]
    .map((row) => [String(row.id), row])).values()];
  const contractIds = values(contracts, 'id');
  const workIds = values(contracts, 'work_id');
  const authorityCandidates = rowsIn(db, (ids) => `SELECT * FROM work_authority
      WHERE project_id=? AND work_id IN (${ids}) ORDER BY updated_at,work_id`,
  workIds, [input.conversationId]);
  const authorities = authorityCandidates.filter((row) => stateKnownAt(row, input.cutoffAt));
  const outcomes = rowsIn(db, (ids) => `SELECT * FROM agent_outcome
      WHERE project_id=? AND contract_id IN (${ids}) AND recorded_at<=?
      ORDER BY recorded_at,id`,
  contractIds, [input.conversationId], [input.cutoffAt]);
  const deliveryRunIds = new Set([...rootDeliveryRunIds, ...values(contracts, 'delivery_run_id')]);

  const taskPassCandidates = rowsIn(db, (taskIds) => `SELECT pass.* FROM a2a_pass pass
      JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
      WHERE chain.conversation_id=? AND pass.task_id IN (${taskIds})
        AND pass.created_at<=? ORDER BY pass.created_at,pass.id`,
  input.taskIds, [input.conversationId], [input.cutoffAt]);
  const directGroupIds = values(taskPassCandidates, 'group_id');

  const groupsByWork = rowsIn(db, (workIdsSql) => `SELECT pass_group.* FROM a2a_pass_group pass_group
      JOIN a2a_possession_chain chain ON chain.id=pass_group.chain_id
      WHERE chain.conversation_id=? AND pass_group.source_work_id IN (${workIdsSql})
        AND pass_group.created_at<=? ORDER BY pass_group.created_at,pass_group.id`,
  workIds, [input.conversationId], [input.cutoffAt]);
  const groupsByDelivery = rowsIn(db, (runIds) => `SELECT pass_group.* FROM a2a_pass_group pass_group
      JOIN a2a_possession_chain chain ON chain.id=pass_group.chain_id
      WHERE chain.conversation_id=? AND pass_group.delivery_run_id IN (${runIds})
        AND pass_group.created_at<=? ORDER BY pass_group.created_at,pass_group.id`,
  deliveryRunIds, [input.conversationId], [input.cutoffAt]);
  const groupsByDirectPass = rowsIn(db, (groupIds) => `SELECT pass_group.* FROM a2a_pass_group pass_group
      JOIN a2a_possession_chain chain ON chain.id=pass_group.chain_id
      WHERE chain.conversation_id=? AND pass_group.id IN (${groupIds})
        AND pass_group.created_at<=? ORDER BY pass_group.created_at,pass_group.id`,
  directGroupIds, [input.conversationId], [input.cutoffAt]);
  const rootChains = rowsIn(db, (taskIds) => `SELECT * FROM a2a_possession_chain
      WHERE conversation_id=? AND root_trigger_id IN (${taskIds}) AND created_at<=? ORDER BY created_at,id`,
  input.taskIds, [input.conversationId], [input.cutoffAt]);
  const proofChains = rowsIn(db, (taskIds) => `SELECT DISTINCT chain.*
      FROM control_proof_event proof
      JOIN a2a_possession_chain chain ON chain.id=proof.chain_id
      WHERE proof.conversation_id=? AND proof.task_id IN (${taskIds})
        AND proof.created_at<=? AND chain.created_at<=? ORDER BY chain.created_at,chain.id`,
  input.taskIds, [input.conversationId], [input.cutoffAt, input.cutoffAt]);

  const seedGroupCandidates = [...new Map([...groupsByWork, ...groupsByDelivery, ...groupsByDirectPass]
    .map((row) => [String(row.id), row])).values()];
  const candidateChainIds = new Set([
    ...values(rootChains, 'id'),
    ...values(proofChains, 'id'),
    ...values(seedGroupCandidates, 'chain_id'),
    ...values(taskPassCandidates, 'chain_id'),
  ]);
  if (input.chainId) {
    const owned = db.prepare(`SELECT * FROM a2a_possession_chain
      WHERE id=? AND conversation_id=? AND created_at<=?`).get(
      input.chainId, input.conversationId, input.cutoffAt,
    ) as EvaluationEvidenceRow | undefined;
    if (!owned) throw new Error('Chain does not belong to conversation');
    if (!candidateChainIds.has(input.chainId)) throw new Error('Chain does not belong to root task');
    candidateChainIds.clear();
    candidateChainIds.add(input.chainId);
  }

  const chains = rowsIn(db, (chainIds) => `SELECT * FROM a2a_possession_chain
      WHERE conversation_id=? AND id IN (${chainIds}) AND created_at<=? ORDER BY created_at,id`,
  candidateChainIds, [input.conversationId], [input.cutoffAt]);
  const chainIds = values(chains, 'id');
  const selectedGroupCandidates = seedGroupCandidates
    .filter((group) => chainIds.has(String(group.chain_id)));
  const passGroups = selectedGroupCandidates.filter((group) => stateKnownAt(group, input.cutoffAt));
  const selectedGroupIds = values(selectedGroupCandidates, 'id');
  const groupedPassCandidates = rowsIn(db, (groupIds) => `SELECT pass.* FROM a2a_pass pass
      JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
      WHERE chain.conversation_id=? AND pass.group_id IN (${groupIds})
        AND pass.created_at<=? ORDER BY pass.created_at,pass.id`,
  selectedGroupIds, [input.conversationId], [input.cutoffAt]);
  const passCandidates = [...new Map([
    ...taskPassCandidates.filter((pass) => chainIds.has(String(pass.chain_id))),
    ...groupedPassCandidates,
  ].map((row) => [String(row.id), row])).values()];
  const passes = passCandidates.filter((row) => stateKnownAt(row, input.cutoffAt));
  const passIds = values(passes, 'id');
  const collaborationAggregateIds = new Set([...selectedGroupIds, ...passIds]);
  const collaborationEvents = rowsIn(db, (ids) => `SELECT * FROM platform_event
      WHERE project_id=? AND aggregate_id IN (${ids}) AND type LIKE 'a2a.%'
        AND occurred_at<=? ORDER BY occurred_at,stream_sequence,id`,
  collaborationAggregateIds, [input.conversationId], [input.cutoffAt]);

  const invocationsByTask = rowsIn(db, (taskIds) => `SELECT * FROM invocation
      WHERE conversation_id=? AND task_id IN (${taskIds}) AND created_at<=? ORDER BY created_at,id`,
  input.taskIds, [input.conversationId], [input.cutoffAt]);
  const invocationsByContract = rowsIn(db, (ids) => `SELECT * FROM invocation
      WHERE conversation_id=? AND work_contract_id IN (${ids}) AND created_at<=? ORDER BY created_at,id`,
  contractIds, [input.conversationId], [input.cutoffAt]);
  const invocationsByWork = rowsIn(db, (ids) => `SELECT * FROM invocation
      WHERE conversation_id=? AND work_id IN (${ids}) AND created_at<=? ORDER BY created_at,id`,
  workIds, [input.conversationId], [input.cutoffAt]);

  const spansByTask = rowsIn(db, (taskIds) => `SELECT * FROM observation_span
      WHERE conversation_id=? AND task_id IN (${taskIds}) AND started_at<=? ORDER BY started_at,span_id`,
  input.taskIds, [input.conversationId], [input.cutoffAt]);
  const spansByPass = rowsIn(db, (ids) => `SELECT * FROM observation_span
      WHERE conversation_id=? AND pass_id IN (${ids}) AND started_at<=? ORDER BY started_at,span_id`,
  passIds, [input.conversationId], [input.cutoffAt]);
  const seedSpans = [...new Map([...spansByTask, ...spansByPass]
    .map((row) => [String(row.span_id), row])).values()];
  const candidateInvocationIds = new Set([
    ...values(invocationsByTask, 'id'),
    ...values(invocationsByContract, 'id'),
    ...values(invocationsByWork, 'id'),
    ...values(seedSpans, 'invocation_id'),
  ]);
  const invocations = rowsIn(db, (ids) => `SELECT * FROM invocation
      WHERE conversation_id=? AND id IN (${ids}) AND created_at<=? ORDER BY created_at,id`,
  candidateInvocationIds, [input.conversationId], [input.cutoffAt])
    .filter((row) => stateKnownAt(row, input.cutoffAt));
  const invocationIds = values(invocations, 'id');
  const spansByInvocation = rowsIn(db, (ids) => `SELECT * FROM observation_span
      WHERE conversation_id=? AND invocation_id IN (${ids}) AND started_at<=? ORDER BY started_at,span_id`,
  invocationIds, [input.conversationId], [input.cutoffAt]);
  const spans = [...new Map([...seedSpans, ...spansByInvocation]
    .map((row) => [String(row.span_id), row])).values()]
    .filter((row) => stateKnownAt(row, input.cutoffAt, 'ended_at'))
    .sort((left, right) => String(left.started_at).localeCompare(String(right.started_at))
      || String(left.span_id).localeCompare(String(right.span_id)));
  const lateFacts = [
    ...selectedGroupCandidates.filter((row) => !stateKnownAt(row, input.cutoffAt))
      .map((row) => `pass_group:${String(row.id)}`),
    ...passCandidates.filter((row) => !stateKnownAt(row, input.cutoffAt))
      .map((row) => `pass:${String(row.id)}`),
    ...[...invocationsByTask, ...invocationsByContract, ...invocationsByWork]
      .filter((row) => !stateKnownAt(row, input.cutoffAt))
      .map((row) => `invocation:${String(row.id)}`),
    ...authorityCandidates.filter((row) => !stateKnownAt(row, input.cutoffAt))
      .map((row) => `work_authority:${String(row.work_id)}`),
    ...[...seedSpans, ...spansByInvocation]
      .filter((row) => !stateKnownAt(row, input.cutoffAt, 'ended_at'))
      .map((row) => `span:${String(row.span_id)}`),
  ];

  return {
    contracts,
    authorities,
    outcomes,
    chains,
    passGroups,
    passes,
    collaborationEvents,
    lateFacts: [...new Set(lateFacts)].slice(0, 200),
    invocations,
    spans,
    taskIds: new Set(input.taskIds),
    contractIds,
    workIds,
    chainIds,
    passIds,
    invocationIds,
  };
}
