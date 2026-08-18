import type Database from 'better-sqlite3';
import type { A2AHandoffPacket as ContextHandoffPacket } from '../../lib/agent-context/ContextManager';
import type { PassStatus } from './types-possession';

const SUMMARY_LIMIT = 1_200;
const ACTION_LIMIT = 600;
const MAX_EVIDENCE_REFS_PER_BRANCH = 8;
const MAX_EVIDENCE_REF_LENGTH = 512;
export const A2A_RESULT_BUNDLE_MAX_CHARS = 24_000;

interface BranchRow {
  pass_id: string;
  to_agent_id: string;
  status: PassStatus;
  reason: string | null;
  requested_action: string;
  result_summary: string | null;
}

interface OutcomeRow {
  id: string;
  payload_json: string;
  evidence_refs_json: string;
}

export interface A2AResultBundleBranch {
  passId: string;
  toAgentId: string;
  requestedAction: string;
  status: PassStatus;
  summary?: string;
  reasonCode?: string;
  outcomeId?: string;
  outcomeEvidence: 'aligned' | 'missing';
  missingOutcomeReason?: 'accepted_outcome_not_found';
  evidenceRefs: string[];
  omittedEvidenceRefCount: number;
}

export interface A2AResultBundle {
  schemaVersion: 1;
  groupId: string;
  completeness: 'complete' | 'partial';
  branches: A2AResultBundleBranch[];
}

export interface BuiltA2AResultBundle {
  bundle: A2AResultBundle;
  context: ContextHandoffPacket;
}

function bounded(value: string | null | undefined, limit: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 20)}… [truncated]`;
}

function stringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  } catch {
    return [];
  }
}

function summaryFromOutcome(outcome: OutcomeRow | undefined): string | undefined {
  if (!outcome) return undefined;
  try {
    const payload = JSON.parse(outcome.payload_json) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
    const summary = (payload as Record<string, unknown>).summary;
    return typeof summary === 'string' ? bounded(summary, SUMMARY_LIMIT) : undefined;
  } catch {
    return undefined;
  }
}

function boundedEvidenceRefs(row: OutcomeRow | undefined): {
  refs: string[];
  omitted: number;
} {
  const exactRefs = row
    ? [...new Set(stringArray(row.evidence_refs_json))]
    : [];
  const eligible = exactRefs.filter((reference) => reference.length <= MAX_EVIDENCE_REF_LENGTH);
  return {
    refs: eligible.slice(0, MAX_EVIDENCE_REFS_PER_BRANCH),
    omitted: exactRefs.length - Math.min(eligible.length, MAX_EVIDENCE_REFS_PER_BRANCH),
  };
}

function latestOutcomeForPass(
  db: Database.Database,
  projectId: string | undefined,
  passId: string,
): OutcomeRow | undefined {
  if (!projectId) return undefined;
  return db.prepare(`
    SELECT
      outcome.id,
      outcome.payload_json,
      outcome.evidence_refs_json
    FROM agent_outcome outcome
    JOIN work_contract contract ON contract.id=outcome.contract_id
    WHERE outcome.project_id=?
      AND outcome.admission_status='accepted'
      AND outcome.outcome_type<>'continue_work'
      AND EXISTS (
        SELECT 1 FROM json_each(contract.authoritative_refs_json) reference
        WHERE reference.value IN (?,?)
      )
    ORDER BY outcome.recorded_at DESC,outcome.id DESC
    LIMIT 1
  `).get(projectId, `a2a_pass:${passId}`, `pass:${passId}`) as OutcomeRow | undefined;
}

function fitBundle(bundle: A2AResultBundle): string {
  let serialized = JSON.stringify(bundle, null, 2);
  while (serialized.length > A2A_RESULT_BUNDLE_MAX_CHARS) {
    const branch = [...bundle.branches].reverse()
      .find((candidate) => candidate.evidenceRefs.length > 0);
    if (!branch) break;
    branch.evidenceRefs.pop();
    branch.omittedEvidenceRefCount += 1;
    serialized = JSON.stringify(bundle, null, 2);
  }
  if (serialized.length > A2A_RESULT_BUNDLE_MAX_CHARS) {
    for (const branch of bundle.branches) {
      branch.requestedAction = bounded(branch.requestedAction, 300) ?? 'Complete the assigned branch.';
      if (branch.summary) branch.summary = bounded(branch.summary, 400);
      if (branch.reasonCode) branch.reasonCode = bounded(branch.reasonCode, 400);
    }
    serialized = JSON.stringify(bundle, null, 2);
  }
  if (serialized.length > A2A_RESULT_BUNDLE_MAX_CHARS) {
    throw new Error(`a2a_result_bundle_too_large:${bundle.groupId}`);
  }
  return serialized;
}

/**
 * Resolves exact branch outcomes at callback time and returns one bounded focus artifact.
 * It deliberately carries result refs rather than branch transcripts or conversation history.
 */
export function buildA2AResultBundle(
  db: Database.Database,
  groupId: string,
): BuiltA2AResultBundle {
  const branches = db.prepare(`
    SELECT
      pass.id AS pass_id,
      pass.to_agent_id,
      pass.status,
      pass.reason,
      packet.requested_action,
      possession.summary AS result_summary
    FROM a2a_pass pass
    JOIN a2a_handoff_packet packet ON packet.pass_id=pass.id
    LEFT JOIN a2a_possession possession ON possession.id=pass.target_possession_id
    WHERE pass.group_id=?
    ORDER BY pass.created_at,pass.id
  `).all(groupId) as BranchRow[];
  const project = db.prepare(`
    SELECT chain.conversation_id
    FROM a2a_pass_group pass_group
    JOIN a2a_possession_chain chain ON chain.id=pass_group.chain_id
    WHERE pass_group.id=?
  `).get(groupId) as { conversation_id: string } | undefined;
  const bundleBranches = branches.map((branch): A2AResultBundleBranch => {
    const outcome = latestOutcomeForPass(db, project?.conversation_id, branch.pass_id);
    const evidence = boundedEvidenceRefs(outcome);
    const failed = ['blocked', 'rejected', 'timeout', 'error'].includes(branch.status);
    const summary = failed
      ? undefined
      : bounded(branch.result_summary, SUMMARY_LIMIT) ?? summaryFromOutcome(outcome);
    return {
      passId: bounded(branch.pass_id, 200)!,
      toAgentId: bounded(branch.to_agent_id, 200)!,
      requestedAction: bounded(branch.requested_action, ACTION_LIMIT) ?? 'Complete the assigned branch.',
      status: branch.status,
      ...(summary ? { summary } : {}),
      ...(failed ? { reasonCode: bounded(branch.reason, SUMMARY_LIMIT) ?? branch.status } : {}),
      ...(outcome ? { outcomeId: bounded(outcome.id, 200) } : {}),
      outcomeEvidence: outcome ? 'aligned' : 'missing',
      ...(!outcome ? { missingOutcomeReason: 'accepted_outcome_not_found' as const } : {}),
      evidenceRefs: evidence.refs,
      omittedEvidenceRefCount: evidence.omitted,
    };
  });
  const hasFailure = bundleBranches.some((branch) => (
    ['blocked', 'rejected', 'timeout', 'error'].includes(branch.status)
  ));
  const bundle: A2AResultBundle = {
    schemaVersion: 1,
    groupId,
    completeness: hasFailure ? 'partial' : 'complete',
    branches: bundleBranches,
  };
  const possessionSummary = fitBundle(bundle);
  const evidenceRefs = [...new Set(bundleBranches.flatMap((branch) => branch.evidenceRefs))];
  return {
    bundle,
    context: {
      title: 'a2a-collaboration',
      requestedAction: [
        'Synthesize these parallel branch results into one structured outcome.',
        'Continue the source work; do not restart completed branches or merely repeat their replies.',
      ].join(' '),
      possessionSummary,
      relevantDecisions: [
        `Parallel callback is ${bundle.completeness}.`,
        'Successful branch evidence remains valid when another branch fails.',
      ],
      evidenceRefs,
      constraints: [
        'Base the next action only on the branch results and authoritative project context.',
        'Use a new handoff only when another role has a distinct executable action.',
      ],
      openQuestions: [],
      forbiddenBehaviors: [
        'Do not answer with acknowledgements or a transcript recap.',
        'Do not rerun branches already marked completed.',
      ],
      sourceMessageIds: [],
    },
  };
}
