import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server as IOServer } from 'socket.io';
import { autonomousDeliveryRepo } from '../autonomous-delivery/repository';
import type { DeliveryRunSnapshot } from '../autonomous-delivery/types';
import { writeAccount } from '../accounts-file';
import {
  InvocationCoordinator,
  InvocationPlanner,
  registerInvocationCoordinator,
  type InvocationDispatchPlan,
  type InvocationDispatchOutcome,
} from '../invocation-pipeline';
import type { AgentRuntime } from '../agent-runtime';
import { executeSkillTool } from '../skill-tool-executor';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { teamPackRepo } from '../repositories/team-pack-repo';

const DRIVER_STATE_KEY = Symbol.for('agent-task-hub.autonomous-delivery.e2e-driver');
const E2E_ACCOUNT_ID = 'autonomous-delivery-e2e-account';
const E2E_SPEC_REF = 'e2e/autonomous-delivery-full-loop.spec.ts';

interface DriverExecutionRecord {
  runId?: string;
  taskId?: string;
  agentId: string;
  scenario: string;
  source: string;
  snapshotId?: string;
  hasContextSnapshot: boolean;
  createdAt: string;
}

interface PendingVerification {
  runId: string;
  taskId: string;
  verifierAgentId: string;
  attempt: number;
  plan: InvocationDispatchPlan;
  resolve: (outcome: InvocationDispatchOutcome) => void;
}

interface DriverState {
  history: DriverExecutionRecord[];
  pendingByRun: Map<string, PendingVerification>;
}

export interface E2EDriverStatus {
  enabled: boolean;
  pending?: {
    runId: string;
    taskId: string;
    verifierAgentId: string;
    attempt: number;
    scenario: string;
  };
  history: DriverExecutionRecord[];
}

export interface BrowserAttestation {
  runId: string;
  status: 'passed' | 'failed';
  pageUrl: string;
  assertions: string[];
  evidenceRefs: string[];
}

function enabled(): boolean {
  return process.env.NODE_ENV !== 'production'
    && process.env.AUTONOMOUS_DELIVERY_E2E_DRIVER === '1';
}

function stateFor(io: IOServer): DriverState {
  const shared = io as unknown as Record<symbol, unknown>;
  const existing = shared[DRIVER_STATE_KEY] as DriverState | undefined;
  if (existing) return existing;
  const created: DriverState = {
    history: [],
    pendingByRun: new Map(),
  };
  shared[DRIVER_STATE_KEY] = created;
  return created;
}

function deliveryEvidence(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mergedToMain: true,
    mainInstallResult: 'passed',
    mainBuildResult: 'passed',
    mainTestResult: 'passed',
    mainImpactReviewResult: 'passed',
    ...extra,
  };
}

async function updateTask(
  plan: InvocationDispatchPlan,
  evidence: Record<string, unknown>,
): Promise<InvocationDispatchOutcome> {
  const taskId = plan.trigger.taskId;
  if (!taskId) {
    return { status: 'failed', reasonCode: 'task_missing', message: 'E2E Agent Adapter requires taskId' };
  }
  const result = await executeSkillTool({
    toolName: 'task_update_status',
    input: {
      task_id: taskId,
      status: 'done',
      evidence,
    },
    agentId: plan.trigger.agentId,
    conversationId: plan.trigger.conversationId,
    projectId: plan.trigger.conversationId,
    taskId,
  });
  return result.success
    ? { status: 'accepted', envelopeId: `e2e-agent:${plan.trigger.id}` }
    : { status: 'failed', reasonCode: 'runtime_rejected', message: result.error };
}

class DeterministicAgentRuntime implements AgentRuntime {
  constructor(private readonly state: DriverState) {}

  isBusy(agentId: string, conversationId: string): boolean {
    return [...this.state.pendingByRun.values()].some((pending) =>
      pending.verifierAgentId === agentId
      && pending.plan.trigger.conversationId === conversationId
    );
  }

  async execute(plan: InvocationDispatchPlan): Promise<InvocationDispatchOutcome> {
    const runId = plan.trigger.deliveryRunId;
    const snapshotId = plan.contextSnapshot?.id;
    this.state.history.push({
      runId,
      taskId: plan.trigger.taskId,
      agentId: plan.trigger.agentId,
      scenario: plan.contextScenario,
      source: plan.trigger.source,
      snapshotId,
      hasContextSnapshot: Boolean(plan.contextSnapshot),
      createdAt: new Date().toISOString(),
    });
    proofLogRepo.append({
      eventType: 'e2e.agent_adapter.executed',
      conversationId: plan.trigger.conversationId,
      taskId: plan.trigger.taskId,
      agentId: plan.trigger.agentId,
      actorId: 'autonomous-delivery-e2e-driver',
      metadata: {
        deliveryRunId: runId,
        scenario: plan.contextScenario,
        source: plan.trigger.source,
        snapshotId,
      },
    });

    if (plan.trigger.source === 'review_gate') {
      if (!runId) {
        return { status: 'failed', reasonCode: 'runtime_rejected', message: 'review runId missing' };
      }
      return updateTask(plan, deliveryEvidence({
        reviewReceipt: {
          schemaVersion: 1,
          deliveryRunId: runId,
          status: 'passed',
          reviewerAgentId: plan.trigger.agentId,
          summary: '确定性 Agent Adapter 已按真实 Harness 上下文完成独立质量评审',
          evidenceRefs: [`review:${runId}:harness-context`],
          findings: [],
        },
      }));
    }

    if (plan.trigger.source === 'test_gate') {
      if (!runId || !plan.trigger.taskId) {
        return { status: 'failed', reasonCode: 'runtime_rejected', message: 'verification scope missing' };
      }
      const snapshot = autonomousDeliveryRepo.getSnapshot(runId);
      const attempt = (snapshot?.receipts.filter((receipt) =>
        receipt.kind === 'verification.acceptance'
      ).length ?? 0) + 1;
      return new Promise<InvocationDispatchOutcome>((resolve) => {
        this.state.pendingByRun.set(runId, {
          runId,
          taskId: plan.trigger.taskId!,
          verifierAgentId: plan.trigger.agentId,
          attempt,
          plan,
          resolve,
        });
      });
    }

    return updateTask(plan, deliveryEvidence());
  }
}

export function configureAutonomousDeliveryE2EFixtures(): void {
  if (!enabled()) throw new Error('Autonomous delivery E2E driver is disabled');
  const now = new Date().toISOString();
  writeAccount({
    id: E2E_ACCOUNT_ID,
    name: 'Autonomous Delivery E2E',
    authMode: 'oauth',
    provider: 'openai',
    models: [],
    enabled: true,
    status: 'valid',
    createdAt: now,
    updatedAt: now,
  });
  const pack = teamPackRepo.getByName('default-team');
  if (!pack) throw new Error('default-team is not available');
  for (const role of pack.roles) {
    teamPackRepo.updateRoleConfig(pack.id, role.id, { accountIds: [E2E_ACCOUNT_ID] });
  }
}

export function registerAutonomousDeliveryE2EDriver(io: IOServer): boolean {
  if (!enabled()) return false;
  const state = stateFor(io);
  registerInvocationCoordinator(io, new InvocationCoordinator({
    planner: new InvocationPlanner(),
    runtime: new DeterministicAgentRuntime(state),
  }));
  return true;
}

export function getAutonomousDeliveryE2EDriverStatus(
  io: IOServer,
  runId?: string,
): E2EDriverStatus {
  const state = stateFor(io);
  const pending = runId
    ? state.pendingByRun.get(runId)
    : [...state.pendingByRun.values()][0];
  return {
    enabled: enabled(),
    pending: pending ? {
      runId: pending.runId,
      taskId: pending.taskId,
      verifierAgentId: pending.verifierAgentId,
      attempt: pending.attempt,
      scenario: pending.plan.contextScenario,
    } : undefined,
    history: state.history.filter((record) => !runId || record.runId === runId),
  };
}

function requireSnapshot(runId: string): DeliveryRunSnapshot {
  const snapshot = autonomousDeliveryRepo.getSnapshot(runId);
  if (!snapshot) throw new Error(`Delivery run not found: ${runId}`);
  return snapshot;
}

export async function submitBrowserAttestation(
  io: IOServer,
  input: BrowserAttestation,
): Promise<E2EDriverStatus> {
  if (!enabled()) throw new Error('Autonomous delivery E2E driver is disabled');
  const state = stateFor(io);
  const pending = state.pendingByRun.get(input.runId);
  if (!pending) throw new Error(`No pending browser verification for run ${input.runId}`);
  const snapshot = requireSnapshot(input.runId);
  const projectPath = snapshot.contract.scope.projectPath;
  if (!projectPath) throw new Error('GoalContract projectPath is required');

  const reportRef = `.ath/e2e-evidence/${input.runId}/attempt-${pending.attempt}.json`;
  const reportPath = join(projectPath, reportRef);
  mkdirSync(join(projectPath, '.ath', 'e2e-evidence', input.runId), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schemaVersion: 1,
    tool: 'Playwright',
    status: input.status,
    pageUrl: input.pageUrl,
    assertions: input.assertions,
    evidenceRefs: input.evidenceRefs,
    observedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  const acceptanceResults = snapshot.contract.acceptanceCriteria.map((criterion) => ({
    criterion,
    status: input.status,
    evidenceRefs: input.evidenceRefs.length > 0
      ? input.evidenceRefs
      : [`browser:${input.runId}:attempt-${pending.attempt}`],
  }));
  const outcome = await updateTask(pending.plan, deliveryEvidence({
    verificationReceipt: {
      schemaVersion: 1,
      deliveryRunId: input.runId,
      status: input.status,
      method: 'web_ui_e2e',
      verifierAgentId: pending.verifierAgentId,
      tool: 'Playwright',
      reportRef,
      specRefs: [E2E_SPEC_REF],
      acceptanceResults,
    },
  }));
  state.pendingByRun.delete(input.runId);
  pending.resolve(outcome);
  if (outcome.status !== 'accepted') {
    throw new Error(
      'message' in outcome
        ? outcome.message ?? outcome.reasonCode
        : 'Browser attestation was rejected by the task tool',
    );
  }
  return getAutonomousDeliveryE2EDriverStatus(io, input.runId);
}
