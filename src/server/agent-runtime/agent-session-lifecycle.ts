import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import { getDb } from '../db';
import { invocationRepo, type InvocationRow } from '../repositories/invocation-repo';
import { generateSortableId } from '../repositories/sortable-id';
import {
  sessionRepo,
  type AgentSessionRow,
  type SessionIdentityBindResult,
  type SessionExecutionProfile,
} from '../repositories/session-repo';
import type { WorkContract } from '../work-contract/types';
import { AcpRuntimeDriver } from './acp-runtime-driver';

export interface AcquireAgentInvocationInput {
  agentId: string;
  projectId: string;
  taskId?: string;
  isolationKey: string;
  executionProfile: SessionExecutionProfile;
  engine: RuntimeCliEngine;
  accountId?: string;
  prompt: string;
  workContract?: WorkContract;
  correlationId: string;
  causationId?: string;
  runtimeOwnerId: string;
  runtimeOwnerToken: string;
  runtimeLeaseMs?: number;
}

/** Owns Logical Session generation rotation and atomic Invocation acquisition. */
export class AgentSessionLifecycle {
  constructor(private readonly driver: AcpRuntimeDriver) {}

  acquireInvocation(input: AcquireAgentInvocationInput): {
    agentSession: AgentSessionRow;
    invocation: InvocationRow;
  } {
    return getDb().transaction(() => {
      const now = new Date().toISOString();
      const activeInvocations = invocationRepo.listUnterminatedForLane(
        input.projectId,
        input.agentId,
      );
      if (activeInvocations.some((invocation) => (
        invocation.lease_expiry !== null && invocation.lease_expiry > now
      ))) {
        throw new Error('runtime_lane_busy');
      }
      const staleSessionIds = new Set<string>();
      for (const invocation of activeInvocations) {
        invocationRepo.transition(invocation.id, {
          to: 'terminated',
          expectedFrom: invocation.status,
          outcome: 'failed',
          exit_code: 1,
          reason_code: 'orphaned_runtime_owner_lease_expired',
          error_message: 'Runtime owner lease expired before Invocation termination',
        });
        if (invocation.session_id) staleSessionIds.add(invocation.session_id);
      }
      for (const sessionId of staleSessionIds) {
        sessionRepo.seal(sessionId, 'orphaned_invocation_recovered');
      }
      let session = sessionRepo.findActiveByConversation(
        input.agentId,
        input.projectId,
        input.isolationKey,
      );
      if (session && sessionRepo.sealIfExecutionProfileChanged(session.id, input.executionProfile)) {
        session = undefined;
      }
      if (session && sessionRepo.sealIfLatestInvocationLoadFailed(session.id)) {
        session = undefined;
      }
      if (session && sessionRepo.sealIfContextBudgetExceeded(
        session.id,
        this.driver.sessionContextBudget(),
      )) {
        session = undefined;
      }
      if (!session) {
        session = sessionRepo.getOrCreateActive({
          id: generateSortableId('ses'),
          conversationId: input.projectId,
          agentId: input.agentId,
          taskId: input.taskId,
          seq: sessionRepo.nextSeqForAgent(input.agentId, input.taskId ?? ''),
          isolationKey: input.isolationKey,
          executionProfile: input.executionProfile,
        });
      }
      const current = sessionRepo.getById(session.id);
      if (!current || current.status !== 'active') {
        throw new Error('session_generation_not_active');
      }
      if (current.cli_session_id) {
        sessionRepo.releaseUnconfirmedRuntimeSessionId(current.id, current.cli_session_id);
      }
      const agentSession = sessionRepo.getById(current.id);
      if (!agentSession || agentSession.status !== 'active') {
        throw new Error('session_generation_not_active');
      }
      const invocation = invocationRepo.create({
        id: input.workContract?.attemptId ?? generateSortableId('inv'),
        conversation_id: input.projectId,
        task_id: input.taskId ?? '',
        agent_id: input.agentId,
        session_id: agentSession.id,
        engine: input.engine,
        account_id: input.accountId,
        prompt: input.prompt,
        work_contract_id: input.workContract?.contractId,
        work_id: input.workContract?.workId,
        work_epoch: input.workContract?.workEpoch,
        fencing_token: input.workContract?.fencingToken,
        correlation_id: input.correlationId,
        causation_id: input.causationId,
        runtime_owner_id: input.runtimeOwnerId,
        runtime_owner_token: input.runtimeOwnerToken,
        runtime_lease_ms: input.runtimeLeaseMs,
      });
      return { agentSession, invocation };
    }).immediate();
  }

  get(sessionId: string): AgentSessionRow | undefined {
    return sessionRepo.getById(sessionId);
  }

  confirmRuntimeSessionId(sessionId: string, runtimeSessionId: string, invocationId: string) {
    return sessionRepo.confirmRuntimeSessionId(sessionId, runtimeSessionId, invocationId);
  }

  /** Atomically binds Runtime Session identity and commits the fenced success. */
  completeOwnedInvocation(input: {
    invocationId: string;
    runtimeOwnerToken: string;
    sessionId: string;
    runtimeSessionId: string;
  }): { invocation: InvocationRow; binding: SessionIdentityBindResult } | undefined {
    return getDb().transaction(() => {
      if (!invocationRepo.ownsRuntimeLease(input.invocationId, input.runtimeOwnerToken)) {
        return undefined;
      }
      const binding = sessionRepo.confirmRuntimeSessionId(
        input.sessionId,
        input.runtimeSessionId,
        input.invocationId,
      );
      if (binding.status === 'mismatch') {
        throw new Error(
          `session_identity_changed: expected ${binding.current}, received ${input.runtimeSessionId}`,
        );
      }
      const current = invocationRepo.getById(input.invocationId);
      if (!current) throw new Error(`invocation_not_found: ${input.invocationId}`);
      const invocation = invocationRepo.transitionOwned(
        input.invocationId,
        input.runtimeOwnerToken,
        {
          to: 'terminated',
          expectedFrom: current.status,
          outcome: 'completed',
          exit_code: 0,
          cli_session_id: input.runtimeSessionId,
        },
      );
      if (!invocation) return undefined;
      return { invocation, binding };
    }).immediate();
  }

  seal(sessionId: string, reasonCode: string): void {
    sessionRepo.seal(sessionId, reasonCode);
  }

  findActive(agentId: string, projectId: string): AgentSessionRow | undefined {
    return sessionRepo.findActiveByConversation(agentId, projectId, '');
  }
}
