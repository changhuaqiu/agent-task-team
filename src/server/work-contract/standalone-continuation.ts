import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { CollaborationKernel } from '../collaboration-kernel';
import type { AgentActivationSource } from '../invocation-pipeline/types';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';
import { continueGateLite } from './continue-gate';
import type { AgentOutcomeRow, WorkContractRow } from './types';

export const MAX_STANDALONE_CONTINUATIONS = 3;

class StandaloneContinuationInvariantError extends Error {
  constructor(readonly reasonCode: string, detail: string) {
    super(detail);
  }
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function refId(refs: string[], pattern: RegExp): string | undefined {
  const reference = refs.find((candidate) => pattern.test(candidate));
  return reference?.slice(reference.indexOf(':') + 1).trim() || undefined;
}

function continuationSource(
  contract: WorkContractRow,
  hasA2AReference: boolean,
  permissions: { executionProfile?: { stage?: string } },
): AgentActivationSource {
  if (hasA2AReference) return 'a2a';
  if (permissions.executionProfile?.stage === 'review') return 'review_gate';
  if (permissions.executionProfile?.stage === 'verify') return 'test_gate';
  if (contract.task_id) return 'workflow';
  return 'system';
}

function continuationScenario(stage: string | undefined): ContextScenario {
  if (stage === 'plan') return 'planning';
  if (stage === 'review') return 'code_review';
  if (stage === 'verify') return 'verification';
  if (stage === 'recover') return 'recovery';
  if (stage === 'close') return 'closure';
  return 'execution';
}

export function standaloneContinuationBudgetRejection(
  contract: WorkContractRow,
  db: Database.Database = getDb(),
): string | undefined {
  if (contract.delivery_run_id) return undefined;
  const row = db.prepare(`
    SELECT COUNT(*) count
    FROM agent_outcome
    WHERE work_id=? AND admission_status='accepted' AND outcome_type='continue_work'
  `).get(contract.work_id) as { count: number };
  return row.count >= MAX_STANDALONE_CONTINUATIONS
    ? 'continuation_budget_exhausted'
    : undefined;
}

/**
 * Schedules a non-Delivery continuation before its Outcome receipt can be
 * returned as applied. The queued command retains the same Work identity, so
 * WorkContract issuance opens the next fenced epoch after the current turn.
 */
export function applyAcceptedStandaloneContinuation(input: {
  contract: WorkContractRow;
  outcome: AgentOutcomeRow;
  db?: Database.Database;
}): void {
  if (input.contract.delivery_run_id) return;
  const db = input.db ?? getDb();
  const admission = continueGateLite.admit(parseJson<unknown>(input.outcome.payload_json));
  if (!admission.accepted) throw new Error(admission.reasonCode);
  const checkpoint = admission.checkpoint;
  const permissions = parseJson<{
    executionMode?: 'standard' | 'outcome_recovery';
    executionProfile?: { stage?: string };
  }>(input.contract.permissions_json);
  const evidenceRefs = parseJson<string[]>(input.outcome.evidence_refs_json);
  const authoritativeRevisions = parseJson<Record<string, string | number>>(
    input.contract.authoritative_revisions_json,
  );
  const refs = parseJson<string[]>(input.contract.authoritative_refs_json);
  const passId = refId(refs, /^(?:a2a_)?pass:/);
  const executionSubjectId = refId(refs, /^ad_hoc_execution:/);
  let possessionId = refId(refs, /^(?:a2a_)?possession:/);
  let chainId: string | undefined;
  if (passId) {
    const pass = db.prepare('SELECT chain_id,target_possession_id FROM a2a_pass WHERE id=?')
      .get(passId) as { chain_id: string; target_possession_id: string | null } | undefined;
    chainId = pass?.chain_id;
    possessionId ??= pass?.target_possession_id ?? undefined;
  }
  if (!chainId && possessionId) {
    chainId = (db.prepare('SELECT chain_id FROM a2a_possession WHERE id=?').get(possessionId) as {
      chain_id: string;
    } | undefined)?.chain_id;
  }
  const possession = possessionId
    ? db.prepare(`
        SELECT possession.revision,possession.status,possession.holder_id,chain.status chain_status
        FROM a2a_possession possession
        JOIN a2a_possession_chain chain ON chain.id=possession.chain_id
        WHERE possession.id=?
      `).get(possessionId) as {
        revision: number;
        status: string;
        holder_id: string;
        chain_status: string;
      } | undefined
    : undefined;
  if (
    possessionId
    && (
      !possession
      || possession.status !== 'open'
      || possession.chain_status !== 'active'
      || possession.holder_id !== input.contract.agent_id
    )
  ) {
    throw new StandaloneContinuationInvariantError(
      'a2a_possession_stale',
      `A2A possession ${possessionId} cannot continue this Work`,
    );
  }
  const source = continuationSource(input.contract, Boolean(passId || possessionId), permissions);
  const prompt = [
    '继续当前工作，不要重新执行已经完成的步骤。',
    `检查点摘要：${checkpoint.summary}`,
    `精确下一动作：${checkpoint.nextAction}`,
    ...(checkpoint.completedSteps.length > 0
      ? ['已完成：', ...checkpoint.completedSteps.map((step) => `- ${step}`)]
      : []),
    '剩余步骤：',
    ...checkpoint.remainingSteps.map((step) => `- ${step}`),
    ...(evidenceRefs.length > 0
      ? ['已有证据：', ...evidenceRefs.map((reference) => `- ${reference}`)]
      : []),
  ].join('\n');
  new CollaborationKernel({ db }).request({
    projectId: input.contract.project_id,
    targetAgentId: input.contract.agent_id,
    source,
    requestedAction: prompt,
    idempotencyKey: `work-continuation:${input.outcome.id}`,
    cause: {
      correlationId: input.outcome.correlation_id,
      causationId: input.outcome.id,
    },
    scope: {
      workId: input.contract.work_id,
      taskId: input.contract.task_id ?? undefined,
      ...(permissions.executionMode ? { executionMode: permissions.executionMode } : {}),
      ...(executionSubjectId ? {
        executionSubject: { kind: 'ad_hoc_execution' as const, id: executionSubjectId },
      } : {}),
    },
    ...(chainId || passId || possessionId ? {
      collaboration: {
        ...(chainId ? { chainId } : {}),
        ...(passId ? { passId } : {}),
        ...(possessionId ? {
          possession: {
            id: possessionId,
            revision: possession?.revision
          ?? Number(authoritativeRevisions.a2aPossession),
          },
        } : {}),
      },
    } : {}),
    context: {
      scenario: permissions.executionMode === 'outcome_recovery'
        ? 'recovery'
        : continuationScenario(permissions.executionProfile?.stage),
    },
    replyTo: possessionId
      ? { type: 'a2a_possession', id: possessionId }
      : input.contract.task_id
        ? { type: 'task', id: input.contract.task_id }
        : { type: 'work', id: input.contract.work_id },
  });
}
