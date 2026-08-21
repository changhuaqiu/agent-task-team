import { autonomousDeliveryRepo } from '../autonomous-delivery/repository';
import { resolveConversationRuntimeProfile } from '../invocation-pipeline/conversation-runtime';
import { resolveExecutionProfile } from '../invocation-pipeline/execution-profile';
import { taskCommandService, stableTaskCommandKey } from '../repositories/task-command-service';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { taskRepo, type TaskRow } from '../repositories/task-repo';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import { parseWorkIdentity } from '../work-contract/work-identity';
import { getDb } from '../db';

export interface BlockedRecoveryCandidate {
  task: TaskRow;
  outcome: AgentOutcomeRow;
  contract: WorkContractRow;
  blocker: { type: string; detail: string; recoveryCondition: string };
}

export type BlockedRecoveryProbeResult =
  | { satisfied: false; reasonCode: string }
  | { satisfied: true; reasonCode: string; fingerprint: string };

export interface BlockedRecoveryProbe {
  evaluate(candidate: BlockedRecoveryCandidate): BlockedRecoveryProbeResult;
}

const BROWSER_SIGNAL = /(?:\bplaywright\b|\bchrom(?:e|ium)\b|\bbrowser\b|浏览器|页面|无头)/iu;
const GIT_SIGNAL = /(?:\bgit\b|\bgithub\b|\bgitlab\b|\bmerge\b|\bpush\b|推送|合并)/iu;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Proves recovery only when the current execution contract gained the blocked capability. */
export class ExecutionCapabilityRecoveryProbe implements BlockedRecoveryProbe {
  constructor(private readonly resolveCurrentProfile: (
    candidate: BlockedRecoveryCandidate,
  ) => { capabilities: string[]; requiredSkillIds: string[] } | undefined = currentExecutionProfile) {}

  evaluate(candidate: BlockedRecoveryCandidate): BlockedRecoveryProbeResult {
    if (candidate.blocker.type !== 'permission_boundary') {
      return { satisfied: false, reasonCode: 'blocker_not_capability_recoverable' };
    }
    const identity = parseWorkIdentity(candidate.contract.work_id);
    if (identity?.scope !== 'task' || identity.purpose !== 'execute') {
      return { satisfied: false, reasonCode: 'blocker_work_scope_not_recoverable' };
    }
    const signal = `${candidate.blocker.detail}\n${candidate.blocker.recoveryCondition}`;
    const requiredCapability = BROWSER_SIGNAL.test(signal)
      ? 'browser_verification'
      : GIT_SIGNAL.test(signal)
        ? 'git_collaboration'
        : undefined;
    if (!requiredCapability) {
      return { satisfied: false, reasonCode: 'blocker_capability_unknown' };
    }
    const current = this.resolveCurrentProfile(candidate);
    if (!current) return { satisfied: false, reasonCode: 'runtime_profile_missing' };
    const permissions = JSON.parse(candidate.contract.permissions_json) as {
      executionProfile?: { capabilities?: unknown };
    };
    const previousCapabilities = stringArray(permissions.executionProfile?.capabilities);
    if (!current.capabilities.includes(requiredCapability)) {
      return { satisfied: false, reasonCode: 'required_capability_unavailable' };
    }
    if (previousCapabilities.includes(requiredCapability)) {
      return { satisfied: false, reasonCode: 'recovery_condition_unchanged' };
    }
    return {
      satisfied: true,
      reasonCode: 'execution_capability_added',
      fingerprint: `${requiredCapability}:${current.requiredSkillIds.slice().sort().join(',')}`,
    };
  }
}

function currentExecutionProfile(
  candidate: BlockedRecoveryCandidate,
): { capabilities: string[]; requiredSkillIds: string[] } | undefined {
  const runtime = resolveConversationRuntimeProfile(
    candidate.task.conversation_id,
    candidate.task.agent_id,
  );
  if (!runtime?.profile) return undefined;
  const delivery = candidate.contract.delivery_run_id
    ? autonomousDeliveryRepo.getRun(candidate.contract.delivery_run_id)
    : undefined;
  const deliveryPolicy = delivery
    ? (JSON.parse(delivery.goal_contract_json) as {
        deliveryPolicy?: { requireWebE2E?: boolean; requireMerge?: boolean };
      }).deliveryPolicy
    : undefined;
  return resolveExecutionProfile({
    source: 'workflow',
    prompt: candidate.contract.goal,
    task: {
      title: candidate.task.title,
      description: candidate.task.description,
    },
    deliveryPolicy,
    skills: runtime.profile.prompt.skills,
  });
}

function blockerFromOutcome(outcome: AgentOutcomeRow): BlockedRecoveryCandidate['blocker'] | undefined {
  try {
    const payload = JSON.parse(outcome.payload_json) as { blocker?: Record<string, unknown> };
    const type = typeof payload.blocker?.type === 'string' ? payload.blocker.type.trim() : '';
    const detail = typeof payload.blocker?.detail === 'string' ? payload.blocker.detail.trim() : '';
    const recoveryCondition = typeof payload.blocker?.recoveryCondition === 'string'
      ? payload.blocker.recoveryCondition.trim()
      : '';
    if (!type || !detail || !recoveryCondition) return undefined;
    return { type, detail, recoveryCondition };
  } catch {
    return undefined;
  }
}

function currentCandidate(task: TaskRow): BlockedRecoveryCandidate | undefined {
  const action = taskGraphRepo.listActionsForTask(task.id)
    .filter((candidate) => candidate.type === 'task.blocked')
    .at(-1);
  if (!action) return undefined;
  const payload = JSON.parse(action.payload) as { outcomeId?: unknown; outcomeType?: unknown };
  if (payload.outcomeType !== 'report_blocked' || typeof payload.outcomeId !== 'string') {
    return undefined;
  }
  const outcome = getDb().prepare(`
    SELECT * FROM agent_outcome
    WHERE id=? AND outcome_type='report_blocked' AND admission_status='accepted'
  `).get(payload.outcomeId) as AgentOutcomeRow | undefined;
  if (!outcome) return undefined;
  const contract = getDb().prepare('SELECT * FROM work_contract WHERE id=?')
    .get(outcome.contract_id) as WorkContractRow | undefined;
  if (!contract || contract.task_id !== task.id || contract.agent_id !== task.agent_id) return undefined;
  const blocker = blockerFromOutcome(outcome);
  return blocker ? { task, outcome, contract, blocker } : undefined;
}

export interface BlockedRecoveryRunResult {
  inspected: number;
  recovered: number;
  deferred: Array<{ taskId: string; reasonCode: string }>;
}

export class BlockedRecoveryOwner {
  constructor(private readonly probe: BlockedRecoveryProbe = new ExecutionCapabilityRecoveryProbe()) {}

  runOnce(): BlockedRecoveryRunResult {
    const blocked = taskRepo.list().filter((task) => task.status === 'blocked');
    const result: BlockedRecoveryRunResult = { inspected: blocked.length, recovered: 0, deferred: [] };
    for (const task of blocked) {
      try {
        const candidate = currentCandidate(task);
        if (!candidate) {
          result.deferred.push({ taskId: task.id, reasonCode: 'structured_blocker_missing' });
          continue;
        }
        const probe = this.probe.evaluate(candidate);
        if (!probe.satisfied) {
          result.deferred.push({ taskId: task.id, reasonCode: probe.reasonCode });
          continue;
        }
        const idempotencyKey = stableTaskCommandKey('blocked-recovery', {
          outcomeId: candidate.outcome.id,
          taskRevision: task.revision,
          fingerprint: probe.fingerprint,
        });
        taskCommandService.transition({
          conversationId: task.conversation_id,
          taskId: task.id,
          expectedTaskRevision: task.revision,
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            task.conversation_id,
            idempotencyKey,
          ),
          idempotencyKey,
          to: 'ready',
          actor: { type: 'system', id: 'blocked-recovery-owner' },
          correlationId: candidate.outcome.correlation_id,
          causationId: candidate.outcome.id,
          actionType: 'task.resumed',
          actionPayload: {
            blockerOutcomeId: candidate.outcome.id,
            recoveryReasonCode: probe.reasonCode,
            recoveryFingerprint: probe.fingerprint,
          },
        });
        result.recovered += 1;
      } catch (error) {
        console.warn(`[blocked-recovery] failed to inspect ${task.id}:`, error);
        result.deferred.push({ taskId: task.id, reasonCode: 'recovery_evaluation_failed' });
      }
    }
    return result;
  }
}
