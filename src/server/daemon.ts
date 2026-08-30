import type { Server as IOServer, Socket } from 'socket.io';
import { join } from 'path';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readAccount } from './accounts-file';
import { readCredential } from './credentials';
import { buildProbeEnv } from './cli-probe';
import { generateRuntimeConfig, cleanupRuntimeConfig, makeInvocationId } from './opencode-config';
import { resolveOpenCodeModel } from './agent-runtime/open-code-model-resolver';
import { startTaskWatcher, syncTasksToDb } from './task-file-watcher';
import {
  beginTasksMdProjectionClaim,
  ensureTasksMdProjection,
} from './task-file-service';
import type { DetectedRuntime } from './types';
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import { resolveRuntimeSelection } from './runtime-selection';
import {
  isAccountAuthMode,
  isAccountProvider,
  isAccountReadyForExecution,
  providerToExecutionEngine,
  type AccountProvider,
} from '@/lib/account-auth';
import { invocationRepo } from './repositories/invocation-repo';
import type { InvocationOutcome, InvocationPatch, InvocationRow } from './repositories/invocation-repo';
import type { AgentEvent } from './agent/types';
import { isSkillTool } from './skill-tool-router';
import { registerAcpSkillMcpGrant, resolveAcpMcpLoopbackOrigin } from './acp-skill-mcp';
import { resolveNonWorktreeExecutionCwd, stableWorkdirTaskKey, WorkdirManager } from './workdir-manager';
import { getDb } from './db';
import { agentDefinitionRepo } from './agents/agent-definition-repo';
import { registerDesktopServiceDrain } from './desktop-service-lifecycle';
import { DispatchGateway } from './control-plane/dispatch-gateway';
import { runtimeNodeRepo } from './repositories/runtime-node-repo';
import { isRuntimeNodeKind } from './repositories/control-plane-types';
import { agentBindingRepo } from './repositories/agent-binding-repo';
import { taskRepo } from './repositories/task-repo';
import { taskCommandService } from './repositories/task-command-service';
import { conversationRepo } from './repositories/conversation-repo';
import { executionEnvelopeRepo } from './repositories/execution-envelope-repo';
import { AutonomyGuardOwner } from './control-plane/autonomy-guard-owner';
import { startWorktreeGCScheduler, stopWorktreeGCScheduler } from './worktree-gc';
import {
  InvocationCoordinator,
  InvocationFailureEventPublisher,
  InvocationPlanner,
  getInvocationCoordinator,
  registerInvocationCoordinator,
  type InvocationDispatchPlan,
  type RuntimeAdmissionContext,
} from './invocation-pipeline';
import { finalizeRuntimeContextSnapshot } from './invocation-pipeline/runtime-context-snapshot';
import { generateSpanId, generateTraceId, observationSpanRepo } from './repositories/observation-span-repo';
import { capturePromptPayloads } from './observability/prompt-observation';
import { teamLogProjection } from './team-log/TeamLogProjection';
import { renderTeamLogEnvelope } from '../lib/agent-context/teamLog';
import { agentEvaluation, startEvaluationWorker } from './evaluation/agent-evaluation';
import { digest } from './evaluation/defaults';
import { transitionCaseExecution } from './evaluation/application-snapshot';
import { projectEvaluationRuntimeAdmission } from './evaluation/evaluation-work-lifecycle-process-manager';
import { EvaluationCaseRunner } from './evaluation/case-runner';
import { CollaborationKernel } from './collaboration-kernel';
import {
  AgentInbox,
  AgentInboxScheduler,
  DurableEffectOutbox,
  registerProductionRuntimeCompletionEffects,
  runtimeCompletionContextRepo,
  RuntimeSocketProjection,
  startPlatformEventRuntime,
} from './platform-events';
import { WorkLifecycleReconciler } from './work-contract/work-lifecycle-reconciler';
import { ensureAutonomousDeliveryRuntime } from './autonomous-delivery/bootstrap';
import { DeliveryTaskTruthReconciler } from './autonomous-delivery/delivery-task-truth-reconciler';
import { registerDeliveryEffectAdapters } from './autonomous-delivery/delivery-effects';
import { deliveryAdvancementQueue } from './autonomous-delivery/advancement-queue';
import { registerAutonomousDeliveryE2EDriver } from './testing/autonomous-delivery-e2e-driver';
import { ProjectViewPublisher } from './project-view/project-view-publisher';
import { AutomationRuntime } from './automations';
import { commandService } from './command-kernel/service';
import type { MessageRow } from './repositories/message-repo';
import {
  renderWorkContractInstruction,
  workContractToolNames,
} from './work-contract/dispatch-contract';
import {
  AcpRuntimeEventCoordinator,
  AcpRuntimeDriver,
  AgentProcessRegistry,
  AgentSessionLifecycle,
  DirectedAgentRuntime,
  RuntimeOwnershipFence,
  RuntimeOwnershipLostError,
  RuntimeSetupError,
  registerAgentRuntimeControl,
  isRuntimeOwnershipLost,
  type AgentRuntimeDispatchContext,
} from './agent-runtime';
import { runtimeProjectViewIdentity } from './agent-runtime/runtime-project-view-identity';

type AgentActivityStatus = 'running' | 'awaiting_children' | 'idle';

const ENGINE_COMMAND: Record<RuntimeCliEngine, string> = {
  goose: 'goose',
  opencode: 'opencode',
  claude: 'claude',
  codex: 'codex',
  'buzz-agent': 'buzz-agent',
  devin: 'devin',
  cursor: 'cursor-agent',
  omp: 'omp',
  grok: 'grok',
  kimi: 'kimi',
  amp: 'amp-acp',
  hermes: 'hermes-acp',
  openclaw: 'openclaw',
};

/** Default CLI idle timeout (ms). Configurable via CLI_TIMEOUT_MS env. 0 = disabled. */
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min
const LOCAL_DAEMON_NODE_ID = 'daemon:local';

const RUNTIME_HEARTBEAT_INTERVAL_MS = 5_000;
const OPENCODE_PROJECT_SKILLS_DIR = join('.opencode', 'skills');

function describeRuntimeSetupFailure(error: unknown): {
  reasonCode: 'runtime_model_unavailable' | 'runtime_start_failed';
  diagnosticMessage: string;
  userMessage: string;
} {
  if (error instanceof RuntimeSetupError) {
    return {
      reasonCode: error.reasonCode,
      diagnosticMessage: error.message,
      userMessage: error.message,
    };
  }
  return {
    reasonCode: 'runtime_start_failed',
    diagnosticMessage: error instanceof Error ? error.message : String(error),
    userMessage: 'Agent 启动失败，请检查运行配置后重试。',
  };
}

async function resolveExecutionAccount(accountId: string | undefined, engine: RuntimeCliEngine) {
  if (!accountId) return undefined;
  const account = await readAccount(accountId);
  const credential = await readCredential(accountId);
  if (
    !account
    || !isAccountProvider(account.provider)
    || !isAccountAuthMode(account.authMode)
    || !isAccountReadyForExecution({
      ...account,
      hasApiKey: Boolean(credential?.apiKey?.trim()),
    })
  ) {
    throw new Error(`Account is not ready for execution: ${accountId}`);
  }
  if (providerToExecutionEngine(account.provider) !== engine) {
    throw new Error(`Account engine does not match runtime: ${accountId}`);
  }
  return {
    account,
    credential,
    env: account.authMode === 'api_key' && credential?.apiKey
      ? buildProbeEnv(account.provider, credential.apiKey, account.baseUrl)
      : {},
  };
}

const execAsync = promisify(exec);

async function detectAvailableRuntimes(): Promise<DetectedRuntime[]> {
  const results: DetectedRuntime[] = [];
  const engines: RuntimeCliEngine[] = ['claude', 'codex', 'opencode'];
  for (const engine of engines) {
    const command = ENGINE_COMMAND[engine];
    try {
      await execAsync(`which ${command}`, { timeout: 3_000 });
      let version: string | undefined;
      try {
        const { stdout } = await execAsync(`${command} --version`, { timeout: 5_000 });
        version = stdout.trim().slice(0, 60) || undefined;
      } catch { /* ignore */ }
      results.push({ engine, available: true, version });
    } catch {
      results.push({ engine, available: false });
    }
  }
  return results;
}

function resolveOpenCodeProjectSkillPaths(projectPath?: string): string[] {
  const candidates = [projectPath, /*turbopackIgnore: true*/ process.cwd()]
    .filter((candidate): candidate is string => !!candidate?.trim());
  const paths = new Set<string>();
  for (const candidate of candidates) {
    const skillDir = path.resolve(/*turbopackIgnore: true*/ candidate, OPENCODE_PROJECT_SKILLS_DIR);
    if (fs.existsSync(/*turbopackIgnore: true*/ skillDir) && fs.statSync(/*turbopackIgnore: true*/ skillDir).isDirectory()) {
      paths.add(skillDir);
    }
  }
  return Array.from(paths);
}

export default function registerDaemon(io: IOServer) {
  startEvaluationWorker();
  const agentProcesses = new AgentProcessRegistry();
  const broadcast = (event: string, data: unknown) => io.emit(event, data);
  const projectViewPublisher = new ProjectViewPublisher(io);
  const runtimeSocketProjection = new RuntimeSocketProjection({
    publish: (projectId, event) => projectViewPublisher.publish(projectId, event),
  });
  const dispatchGateway = new DispatchGateway();
  const acpRuntimeDriver = new AcpRuntimeDriver();
  registerAgentRuntimeControl(io, acpRuntimeDriver, agentProcesses);
  const agentSessions = new AgentSessionLifecycle(acpRuntimeDriver);
  // Deferred until the ACP execution backend has finished constructing its local dependencies.
  // eslint-disable-next-line prefer-const
  let executePlan: ((
    plan: InvocationDispatchPlan,
    dispatch: AgentRuntimeDispatchContext,
    lifecycle: {
      acknowledge(context: RuntimeAdmissionContext): boolean;
      signal?: AbortSignal;
    },
  ) => Promise<void>) | undefined;

  const agentRuntime = new DirectedAgentRuntime({
    nodeId: LOCAL_DAEMON_NODE_ID,
    dispatch: dispatchGateway,
    resolveTargetNodeId(plan) {
      return agentBindingRepo.get(
        plan.trigger.conversationId,
        plan.trigger.agentId,
      )?.node_id ?? LOCAL_DAEMON_NODE_ID;
    },
    executor: {
      isBusy(agentId, deliveryId) {
        return agentProcesses.isBusy(agentId, deliveryId);
      },
      reserve(plan) {
        return agentProcesses.reserve(plan);
      },
      release(plan) {
        agentProcesses.releaseReservation(plan);
      },
      async execute(plan, dispatch, lifecycle) {
        if (!executePlan) throw new Error('daemon execution backend is not ready');
        await executePlan(plan, dispatch, lifecycle);
      },
    },
  });
  const invocationCoordinator = new InvocationCoordinator({
    planner: new InvocationPlanner(),
    failureEvents: new InvocationFailureEventPublisher({
      runtimeActorId: LOCAL_DAEMON_NODE_ID,
    }),
    runtime: agentRuntime,
  });
  registerInvocationCoordinator(io, invocationCoordinator);
  const agentInbox = new AgentInbox();
  const collaborationKernel = new CollaborationKernel({ inbox: agentInbox });
  const workLifecycle = new WorkLifecycleReconciler({ collaboration: collaborationKernel });
  workLifecycle.reconcilePersistedState();
  const agentInboxScheduler = new AgentInboxScheduler({
    inbox: agentInbox,
    submit: (trigger, options) => (
      getInvocationCoordinator(io) ?? invocationCoordinator
    ).submit(trigger, options),
  });
  agentInboxScheduler.start();
  registerAutonomousDeliveryE2EDriver(io);
  ensureAutonomousDeliveryRuntime(io, `daemon:${LOCAL_DAEMON_NODE_ID}`);
  const evaluationCaseRunner = new EvaluationCaseRunner(collaborationKernel);
  const evaluationRunnerTimer = setInterval(() => {
    try {
      evaluationCaseRunner.pump();
    } catch (error) {
      console.error('[evaluation] case runner error:', error);
    }
  }, 2_000);
  evaluationRunnerTimer.unref();

  dispatchGateway.ensureRuntimeNode({
    id: LOCAL_DAEMON_NODE_ID,
    kind: 'daemon',
    label: 'Local daemon',
    capabilities: ['execute', 'heartbeat', 'socket-transport'],
    trustLevel: 'local',
  });

  const runtimeHealthTimer = setInterval(() => {
    dispatchGateway.heartbeat(LOCAL_DAEMON_NODE_ID);
    dispatchGateway.expireUnacknowledged();
    const now = Date.now();
    for (const node of runtimeNodeRepo.list()) {
      if (node.id === LOCAL_DAEMON_NODE_ID || node.status === 'suspended') continue;
      const last = node.last_heartbeat_at ? new Date(node.last_heartbeat_at).getTime() : 0;
      if (!last || now - last > RUNTIME_HEARTBEAT_INTERVAL_MS) {
        dispatchGateway.markMissedHeartbeat(node.id);
      }
    }
  }, RUNTIME_HEARTBEAT_INTERVAL_MS);
  runtimeHealthTimer.unref();

  const autonomyGuardOwner = new AutonomyGuardOwner({ io });
  autonomyGuardOwner.start();
  const deliveryTaskTruthReconciler = new DeliveryTaskTruthReconciler();
  deliveryTaskTruthReconciler.start();

  const workspacesRoot = process.env.ATH_WORKSPACES_ROOT || join(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
  const workdirManager = new WorkdirManager(workspacesRoot);
  workdirManager.gc(24 * 3600 * 1000);
  startWorktreeGCScheduler(workdirManager);

  const effectOutbox = new DurableEffectOutbox();
  registerProductionRuntimeCompletionEffects(effectOutbox, {
    io,
  });
  registerDeliveryEffectAdapters(effectOutbox);

  const publishProjectedMessage = (message: MessageRow) => {
    projectViewPublisher.publish(message.conversation_id, {
      type: 'chat.message.persisted',
      delivery: 'durable',
      actor: {
        type: message.sender_id === 'human'
          ? 'user'
          : message.sender_id === 'system' ? 'system' : 'agent',
        id: message.sender_id,
      },
      subject: message.invocation_id
        ? { type: 'invocation', id: message.invocation_id }
        : { type: 'message', id: message.id },
      eventId: `message:${message.id}`,
      correlationId: message.invocation_id ?? message.id,
      causationId: `message:${message.id}`,
      payload: { message },
    });
  };
  startPlatformEventRuntime({
    workLifecycle,
    io,
    automation: new AutomationRuntime({
      onMessagePosted: publishProjectedMessage,
      executeCommand: (command) => commandService.execute(command),
    }),
    onA2AProjected: (snapshot) => {
      projectViewPublisher.publish(snapshot.conversationId, {
        type: 'a2a.snapshot',
        delivery: 'durable',
        actor: { type: 'system', id: 'a2a-projection' },
        subject: { type: 'a2a_chain', id: snapshot.chainId },
        eventId: `a2a:${snapshot.conversationId}:${snapshot.chainId}:${snapshot.revision}`,
        correlationId: snapshot.chainId,
        causationId: `a2a:${snapshot.conversationId}:${snapshot.chainId}:${snapshot.revision}`,
        payload: { snapshot },
      });
    },
    onMessageProjected: publishProjectedMessage,
    onObservabilityUpdated: (projectId, invocationId) => {
      io.to(projectId).emit('observability:updated', {
        projectId,
        conversationId: projectId,
        invocationId,
      });
    },
    deliveryAdvancement: {
      advanceProject: (projectId, cause, signal, sourceEventId) => {
        if (signal.aborted) {
          throw signal.reason ?? new Error('delivery_advancement_admission_aborted');
        }
        deliveryAdvancementQueue.enqueue({ sourceEventId, projectId, cause });
      },
    },
    effectOutbox,
  });

  // Agent pane listing endpoint
  io.on('connection', (socket: Socket) => {
    let connectedRuntimeNodeId: string | undefined;
    const joinedConversationIds = new Set<string>();

    socket.on('conversation:join', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) return;
      socket.join(conversationId);
      joinedConversationIds.add(conversationId);
    });

    socket.on('conversation:leave', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) return;
      socket.leave(conversationId);
      joinedConversationIds.delete(conversationId);
    });

    socket.on('runtime:hello', (payload: {
      nodeId?: string;
      kind?: unknown;
      label?: string;
      endpoint?: string;
      capabilities?: string[];
    }) => {
      const nodeId = typeof payload?.nodeId === 'string' ? payload.nodeId.trim() : '';
      const kind = payload?.kind ?? 'browser';
      if (!nodeId || !isRuntimeNodeKind(kind)) {
        socket.emit('runtime:registration-rejected', { reasonCode: 'invalid_runtime_node' });
        return;
      }
      connectedRuntimeNodeId = nodeId;
      dispatchGateway.ensureRuntimeNode({
        id: nodeId,
        kind,
        label: typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : nodeId,
        endpoint: payload.endpoint,
        capabilities: payload.capabilities ?? ['socket-transport'],
        trustLevel: kind === 'browser' ? 'paired' : 'local',
      });
      dispatchGateway.heartbeat(nodeId);
      socket.emit('runtime:registered', { nodeId });
    });

    socket.on('runtime:heartbeat', (payload: { nodeId?: string }) => {
      if (!payload?.nodeId) return;
      connectedRuntimeNodeId = payload.nodeId;
      dispatchGateway.heartbeat(payload.nodeId);
    });

    socket.on('disconnect', () => {
      if (connectedRuntimeNodeId) {
        runtimeNodeRepo.setStatus(connectedRuntimeNodeId, 'stale');
      }
      joinedConversationIds.clear();
    });

    socket.on('runtimes:list', async (callback) => {
      const runtimes = await detectAvailableRuntimes();
      callback?.({ runtimes });
    });

    // Push runtimes on connect
    (async () => {
      const runtimes = await detectAvailableRuntimes();
      broadcast('runtimes:update', { runtimes });
    })();
  });

  executePlan = async (
    plan: InvocationDispatchPlan,
    dispatch: AgentRuntimeDispatchContext,
    lifecycle: {
      acknowledge(context: RuntimeAdmissionContext): boolean;
      signal?: AbortSignal;
    },
  ) => {
      lifecycle.signal?.throwIfAborted();
      const projectId = plan.trigger.conversationId;
      const conversationId = projectId;
      const taskId = plan.trigger.taskId;
      const agentId = plan.trigger.agentId;
      const incomingPrompt = plan.prompt;
      const systemPrompt = [
        plan.systemPrompt,
        renderWorkContractInstruction(plan.workContract),
      ].filter(Boolean).join('\n\n');
      const targetNodeId = dispatch.targetNodeId;
      const dispatchSource = plan.trigger.source;
      const chainId = plan.trigger.chainId;
      const passId = plan.trigger.passId;
      const rawEngine = plan.engine;
      const runtimeId = plan.runtimeId;
      const accountId = plan.accountId;
      const projectSlug = projectId;
      const projectPath = plan.projectPath;
      const useWorktree = plan.useWorktree;
      const contextScenario = plan.contextScenario;
      const teamLogUpToEntryId = plan.teamLogUpToEntryId;
      const requestedTraceId = plan.traceId;
      const contextReport = plan.contextReport;
      const contextSnapshot = plan.contextSnapshot;
      const workContract = plan.workContract;
      const evaluation = plan.evaluation;
      console.log(`[daemon] execute agent=${agentId}, engine=${rawEngine}, accountId=${accountId ?? '(none)'}, busy=${agentProcesses.isBusy(agentId, projectId)}`);
      console.log(`[daemon] systemPrompt=${systemPrompt ? `${systemPrompt.length} chars` : '(none)'}, prompt=${incomingPrompt ? `${incomingPrompt.length} chars` : '(none)'}`);
      let primaryCommand = 'unknown';
      let runtimeConfigDir: string | undefined;
      const controlEnvelopeId = dispatch.envelopeId;
      const sourceMessageId = plan.trigger.a2aHandoff?.sourceMessageIds?.[0]
        ?? (plan.trigger.source === 'user' ? plan.trigger.id : undefined);
      let invocationTraceId = workContract?.correlationId ?? requestedTraceId;
      let rootObservationSpanId: string | undefined;
      let evaluationObservedDigest: string | undefined;
      let runtimeContextObservationRecorded = false;
      let finishObservation: (status: 'ok' | 'error' | 'cancelled', errorMessage?: string) => void = () => {};
      // ACP per-runtime cleanup (e.g. codex temp CODEX_HOME). Declared here so
      // the outer execution catch can clean up if setup succeeds
      // but a later step throws before the execute IIFE takes over.
      let acpCleanup: (() => void) | undefined;
      let revokeAcpTools: (() => void) | undefined;
      let runtimeEventCoordinator: AcpRuntimeEventCoordinator | undefined;
      let acquiredInvocationId: string | undefined;
      let acquiredRuntimeOwnerToken: string | undefined;
      let ownedRuntimeKill: (() => void) | undefined;
      let runtimeOwnershipHeartbeat: ReturnType<typeof setInterval> | undefined;
      const clearRuntimeOwnershipHeartbeat = () => {
        if (runtimeOwnershipHeartbeat) clearInterval(runtimeOwnershipHeartbeat);
        runtimeOwnershipHeartbeat = undefined;
      };

      try {
      const sessionConvId = projectId;
      const publishRuntimeWarning = (message: string, reasonCode?: string) => {
        projectViewPublisher.publish(sessionConvId, {
          type: 'runtime.warning',
          delivery: 'transient',
          actor: { type: 'agent', id: agentId },
          ...runtimeProjectViewIdentity({
            invocationId: invocation.id,
            traceId: invocationTraceId,
            envelopeId: controlEnvelopeId,
            projectId: sessionConvId,
          }),
          payload: { message, reasonCode },
        });
      };
      const publishTerminalExit = (input: {
        code: number;
        command: string;
        reasonCode?: string;
        activity?: AgentActivityStatus;
      }) => {
        projectViewPublisher.publish(sessionConvId, {
          type: 'terminal.exited',
          delivery: 'transient',
          actor: { type: 'agent', id: agentId },
          ...runtimeProjectViewIdentity({
            invocationId: invocation.id,
            traceId: invocationTraceId,
            envelopeId: controlEnvelopeId,
            projectId: sessionConvId,
          }),
          payload: input,
        });
      };
      let prompt = incomingPrompt;
      let effectiveTeamLogUpToEntryId = teamLogUpToEntryId;
      if (!effectiveTeamLogUpToEntryId && !evaluation) {
        const envelope = teamLogProjection.buildEnvelope(
          sessionConvId,
          agentId,
          dispatchSource && dispatchSource !== 'user' && taskId ? { taskId } : undefined,
        );
        const envelopeText = renderTeamLogEnvelope(envelope);
        if (envelopeText) prompt = `${envelopeText}\n\n${prompt}`;
        effectiveTeamLogUpToEntryId = envelope.upToEntryId;
      }
      const sharedProjectDir = join(workspacesRoot, sessionConvId);
      let taskProjectDir = sharedProjectDir;
      const emitDispatchReceipt = (
        phase: 'requested' | 'sent' | 'acknowledged' | 'rejected',
        reasonCode?: string,
      ) => {
        if (!controlEnvelopeId) return;
        const receiptId = `${controlEnvelopeId}:${phase}`;
        projectViewPublisher.publish(sessionConvId, {
          type: 'dispatch.receipt',
          delivery: 'durable',
          actor: { type: 'runtime', id: LOCAL_DAEMON_NODE_ID },
          subject: { type: 'envelope', id: controlEnvelopeId },
          eventId: receiptId,
          correlationId: invocationTraceId ?? invocation.id,
          causationId: controlEnvelopeId,
          payload: {
            projectId: sessionConvId,
            receiptId,
            conversationId: sessionConvId,
            sourceMessageId,
            taskId,
            targetAgentId: agentId,
            source: dispatchSource ?? 'user',
            phase,
            chainId,
            passId,
            reasonCode,
            createdAt: new Date().toISOString(),
          },
        });
      };
      const markExecutionCompleted = () => {
        finishObservation('ok');
        if (!controlEnvelopeId) return;
        dispatchGateway.markExecutionFinished(controlEnvelopeId);
      };
      const markExecutionOrEnvelopeFailed = (reasonCode: string) => {
        finishObservation(reasonCode === 'cancelled' ? 'cancelled' : 'error', reasonCode);
        if (!controlEnvelopeId) return;
        const current = executionEnvelopeRepo.getById(controlEnvelopeId);
        if (current?.status === 'acknowledged') {
          dispatchGateway.markExecutionFailed(controlEnvelopeId, reasonCode);
          return;
        }
        if (current && current.status !== 'rejected' && current.status !== 'expired') {
          dispatchGateway.reject(controlEnvelopeId, reasonCode);
          emitDispatchReceipt('rejected', reasonCode);
        }
      };

      const selection = resolveRuntimeSelection(rawEngine, runtimeId);
      const engine: RuntimeCliEngine = selection.engine;
      const effectiveRuntimeId = selection.runtimeId;
      primaryCommand = ENGINE_COMMAND[engine];
      const executionAccount = await resolveExecutionAccount(accountId, engine);

      const envelope = executionEnvelopeRepo.getById(controlEnvelopeId);
      if (
        !envelope
        || envelope.to_node_id !== LOCAL_DAEMON_NODE_ID
        || envelope.status !== 'sent'
      ) {
        throw new Error('directed_execution_envelope_not_sent');
      }
      emitDispatchReceipt('requested');
      emitDispatchReceipt('sent');

      const credentialEnv = executionAccount?.env ?? {};

      // --- Session & Invocation tracking (SQLite) ---
      // Use conversationId for session scoping (project-level session per agent)
      const sessionIsolationKey = evaluation ? `evaluation:${evaluation.executionId}` : '';
      const sessionExecutionProfile = {
        engine,
        runtimeId: effectiveRuntimeId,
        accountId: accountId?.trim() || undefined,
      };
      invocationTraceId ??= generateTraceId();
      const { agentSession, invocation } = agentSessions.acquireInvocation({
        agentId,
        projectId: sessionConvId,
        taskId,
        isolationKey: sessionIsolationKey,
        executionProfile: sessionExecutionProfile,
        engine,
        accountId,
        prompt: prompt || '',
        workContract,
        correlationId: invocationTraceId,
        causationId: controlEnvelopeId ?? workContract?.causationId,
        runtimeOwnerId: targetNodeId,
        runtimeOwnerToken: plan.trigger.runtimeOwnerToken ?? controlEnvelopeId,
        runtimeLeaseMs: 45_000,
      });
      acquiredInvocationId = invocation.id;
      const runtimeOwnerToken = plan.trigger.runtimeOwnerToken ?? controlEnvelopeId;
      acquiredRuntimeOwnerToken = runtimeOwnerToken;
      runtimeOwnershipHeartbeat = setInterval(() => {
        if (invocationRepo.renewRuntimeLease(invocation.id, runtimeOwnerToken, 45_000)) return;
        ownedRuntimeKill?.();
      }, 10_000);
      runtimeOwnershipHeartbeat.unref?.();
      runtimeCompletionContextRepo.create({
        invocationId: invocation.id,
        conversationId: sessionConvId,
        agentId,
        taskId,
        chainId,
        passId,
        contextScenario,
        teamLogUpToEntryId: effectiveTeamLogUpToEntryId,
        taskProjectDir,
        evaluationExecutionId: evaluation?.executionId,
      });
      if (!invocationRepo.transitionOwned(invocation.id, runtimeOwnerToken, {
        to: 'starting',
        expectedFrom: 'planned',
      })) throw new RuntimeOwnershipLostError('runtime_start_fence_lost');
      const terminateInvocation = (
        outcome: InvocationOutcome,
        patch: InvocationPatch = {},
      ): InvocationRow => {
        const current = invocationRepo.getById(invocation.id);
        if (!current) throw new Error(`invocation_not_found: ${invocation.id}`);
        const terminated = invocationRepo.transitionOwned(invocation.id, runtimeOwnerToken, {
          to: 'terminated',
          expectedFrom: current.status,
          outcome,
          ...patch,
        });
        if (!terminated) throw new RuntimeOwnershipLostError('runtime_terminal_fence_lost');
        return terminated;
      };
      const completeInvocation = (runtimeSessionId: string) => {
        const completed = agentSessions.completeOwnedInvocation({
          invocationId: invocation.id,
          runtimeOwnerToken,
          sessionId: agentSession.id,
          runtimeSessionId,
        });
        if (!completed) throw new RuntimeOwnershipLostError('runtime_terminal_fence_lost');
        return completed.binding;
      };
      const runtimeOwnershipFence = new RuntimeOwnershipFence({
        invocationId: invocation.id,
        runtimeOwnerToken,
        onOwnershipLost: () => ownedRuntimeKill?.(),
      });
      const commitOwnedRuntimeEffect = <T>(effect: () => T): T => (
        runtimeOwnershipFence.commit(effect)
      );

      const capturePromptObservation = (assembledPrompt: string, effectiveSystemPrompt?: string) => {
        if (!rootObservationSpanId) return;
        try {
          capturePromptPayloads({
            spanId: rootObservationSpanId,
            assembledPrompt,
            systemPrompt: effectiveSystemPrompt,
            onCaptured: () => io.to(sessionConvId).emit('observability:updated', {
              projectId: sessionConvId,
              conversationId: sessionConvId,
              invocationId: invocation.id,
            }),
          });
        } catch (error) {
          console.warn('[observability] failed to capture prompt payload:', error);
        }
      };

      const recordRuntimeContextObservation = (input: {
        transport: 'acp';
        systemPromptChannel: 'none' | 'instructions' | 'backend' | 'inline';
        prompt: string;
        systemPrompt?: string;
      }) => {
        if (
          runtimeContextObservationRecorded
          || !contextReport
          || !invocationTraceId
          || !rootObservationSpanId
        ) return;
        try {
          const runtimeSnapshot = contextSnapshot
            ? finalizeRuntimeContextSnapshot(contextSnapshot, input)
            : undefined;
          const contextSpan = observationSpanRepo.start({
            traceId: invocationTraceId,
            parentSpanId: rootObservationSpanId,
            name: 'context.runtime',
            kind: 'context',
            conversationId: sessionConvId,
            taskId,
            agentId,
            invocationId: invocation.id,
            envelopeId: controlEnvelopeId,
            chainId,
            passId,
            attributes: {
              'ath.schema.version': 1,
              report: {
                ...contextReport,
                snapshotId: runtimeSnapshot?.id ?? contextReport.snapshotId,
              },
              snapshot: runtimeSnapshot ? {
                ...runtimeSnapshot,
                compiledPrompt: undefined,
              } : undefined,
              loadedSkills: contextReport.loadedSkills,
              availableTools: contextReport.availableTools,
            },
          });
          observationSpanRepo.finish(contextSpan.span_id, 'ok');
          runtimeContextObservationRecorded = true;
        } catch (error) {
          console.warn('[observability] failed to record runtime context:', error);
        }
      };

      // Observability is intentionally best-effort: a telemetry write must never
      // prevent the agent loop from running.
      try {
        invocationTraceId ??= generateTraceId();
        rootObservationSpanId = generateSpanId();
        observationSpanRepo.start({
          spanId: rootObservationSpanId,
          traceId: invocationTraceId,
          name: 'agent.invoke',
          kind: 'agent',
          conversationId: sessionConvId,
          taskId,
          agentId,
          invocationId: invocation.id,
          envelopeId: controlEnvelopeId,
          chainId,
          passId,
          inputPreview: incomingPrompt,
          attributes: {
            'ath.schema.version': 1,
            'gen_ai.operation.name': 'invoke_agent',
            'gen_ai.agent.name': agentId,
            'ath.runtime.engine': engine,
            'ath.runtime.id': effectiveRuntimeId,
            'ath.dispatch.source': dispatchSource ?? 'user',
            'ath.context.scenario': contextScenario,
          },
        });
        if (contextReport) {
          const contextSpan = observationSpanRepo.start({
            traceId: invocationTraceId,
            parentSpanId: rootObservationSpanId,
            name: 'context.assemble',
            kind: 'context',
            conversationId: sessionConvId,
            taskId,
            agentId,
            invocationId: invocation.id,
            envelopeId: controlEnvelopeId,
            chainId,
            passId,
            attributes: {
              'ath.schema.version': 1,
              report: contextReport,
              snapshot: contextSnapshot ? {
                ...contextSnapshot,
                compiledPrompt: undefined,
              } : undefined,
              loadedSkills: contextReport.loadedSkills,
              availableTools: contextReport.availableTools,
            },
          });
          observationSpanRepo.finish(contextSpan.span_id, 'ok');
        }
        finishObservation = (status, errorMessage) => {
          try {
            observationSpanRepo.finishOpenByInvocation(invocation.id, status, errorMessage);
          } catch (error) {
            console.warn(`[observability] failed to finish ${invocation.id}:`, error);
          }
        };
      } catch (error) {
        console.warn(`[observability] failed to start ${invocation.id}:`, error);
      }

      // DB-backed project sessions are conversation-scoped. Do not fall back to a
      // client-provided sessionId for a newly created conversation session, or a
      // stale frontend cache can resume another project's CLI context.
      const resumeGeneration = agentSessions.get(agentSession.id);
      if (!resumeGeneration || resumeGeneration.status !== 'active') {
        throw new Error('session_generation_not_active_before_resume');
      }
      const effectiveSessionId = resumeGeneration.cli_session_id ?? undefined;

      runtimeConfigDir = undefined;
      let runtimeConfigEnv: Record<string, string> = {};

      if (engine === 'opencode') {
        // Offline evaluation must use only the frozen Invocation Pipeline context. Loading
        // project-local Skills or authorizing the live shared workspace would
        // leak mutable production state into the isolated worktree.
        const projectSkillPaths = evaluation ? [] : resolveOpenCodeProjectSkillPaths(projectPath);
        const account = executionAccount?.account;
        const cred = executionAccount?.credential;
        const invocationId = makeInvocationId(agentId);
        const runtimeModel = account && cred?.apiKey
          ? undefined
          : resolveOpenCodeModel({
              command: ENGINE_COMMAND.opencode,
              runtimeEnv: credentialEnv,
              configuredModel: plan.preferredModel ?? account?.models?.[0],
            });
        const result = generateRuntimeConfig(invocationId, {
          provider: account?.provider as AccountProvider | undefined,
          apiKey: cred?.apiKey,
          baseUrl: account?.baseUrl,
          models: account?.models,
          defaultModel: plan.preferredModel ?? account?.models?.[0],
          runtimeModel,
          systemPrompt: systemPrompt || undefined,
          skillPaths: projectSkillPaths,
          managedSkillNames: contextReport?.loadedSkills ?? [],
          allowedExternalDirectories: evaluation ? [] : [sharedProjectDir],
        });
        if (result.generated) {
          runtimeConfigDir = result.configDir;
          runtimeConfigEnv = result.env;
        }
      }

      let invocationSessionRecorded = false;
      let observedRuntimeSessionId: string | undefined;
      let hasBackgroundChildActivity = false;
      // --- Timeout control ---
      // codex ACP startup ~117s (WebSocket→HTTPS fallback). Floor BOTH the
      // daemon kill timer (resetTimeout, fired below) AND the backend per-turn
      // timeout to ≥180s for codex ACP, so an operator-tuned CLI_TIMEOUT_MS
      // below 180s cannot tree-kill the codex subprocess before the adapter
      // finishes booting. The default (300s) is unchanged; 0 (disabled) is
      // preserved. (Task 8 review fix: previously only backend.execute saw the
      // floor via effectiveTimeoutMs, while resetTimeout closed over the raw
      // value — the two timers disagreed.) Task 10: the AGENT_BACKEND=legacy
      // guard is gone — all codex turns are ACP now.
      const rawTimeoutMs = Number(process.env.CLI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
      const isCodexAcp = engine === 'codex';
      const timeoutMs = isCodexAcp && rawTimeoutMs > 0 ? Math.max(rawTimeoutMs, 180_000) : rawTimeoutMs;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const resetTimeout = () => {
        if (timeoutMs === 0) return;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          const active = agentProcesses.get(agentId, projectId);
          if (active) {
            active.kill();
            markExecutionOrEnvelopeFailed('timeout');
            publishRuntimeWarning(
              `CLI 响应超时 (${Math.round(timeoutMs / 1000)}s)，已自动终止。`,
              'timeout',
            );
          }
        }, timeoutMs);
        if (timeoutTimer) timeoutTimer.unref();
      };

      const clearProcessTimeout = () => {
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      };

      // --- Heartbeat: keep client watchdog alive while process is running ---
      const HEARTBEAT_INTERVAL_MS = 30_000;
      const heartbeatTimer = setInterval(() => {
        if (agentProcesses.isBusy(agentId, projectId)) {
          projectViewPublisher.publish(sessionConvId, {
            type: 'runtime.activity',
            delivery: 'transient',
            actor: { type: 'agent', id: agentId },
            subject: { type: 'invocation', id: invocation.id },
            correlationId: invocationTraceId ?? invocation.id,
            causationId: controlEnvelopeId ?? invocation.id,
            payload: {
              status: 'running',
              sessionId: agentSession?.cli_session_id,
              reason: 'heartbeat',
            },
          });
        } else {
          clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref();

      // Start initial timeout
      if (timeoutMs > 0) resetTimeout();

      function isBackgroundChildTool(name: string): boolean {
        const normalized = name.trim().toLowerCase();
        return normalized === 'agent' || normalized === 'task';
      }

      function broadcastAgentActivity(status: AgentActivityStatus, reason?: string): void {
        projectViewPublisher.publish(sessionConvId, {
          type: 'runtime.activity',
          delivery: 'transient',
          actor: { type: 'agent', id: agentId },
          subject: { type: 'invocation', id: invocation.id },
          correlationId: invocationTraceId ?? invocation.id,
          causationId: controlEnvelopeId ?? invocation.id,
          payload: {
            taskId,
            sessionId: eventSessionId(),
            status,
            reason,
          },
        });
      }

      function eventSessionId(): string | undefined {
        return effectiveSessionId;
      }

      // Adapter signals enter the Runtime coordinator first. Text/thinking
      // deltas stay on a transient transport; durable consumers only observe
      // the canonical Platform Events emitted by the coordinator.
      const handleAdapterSignal = (event: AgentEvent) => commitOwnedRuntimeEffect(() => {
        // Observe runtime identity during the turn, but do not persist a new
        // binding until the Invocation completes successfully. Some adapters
        // only make a new Session loadable after the first prompt commits.
        if (event.sessionId) {
          const firstRuntimeSessionObservation = !observedRuntimeSessionId;
          if (observedRuntimeSessionId && observedRuntimeSessionId !== event.sessionId) {
            throw new Error(
              `session_identity_changed: expected ${observedRuntimeSessionId}, received ${event.sessionId}`,
            );
          }
          if (effectiveSessionId && effectiveSessionId !== event.sessionId) {
            throw new Error(
              `session_identity_changed: expected ${effectiveSessionId}, received ${event.sessionId}`,
            );
          }
          observedRuntimeSessionId = event.sessionId;
          if (firstRuntimeSessionObservation) {
            runtimeEventCoordinator?.bindSession(
              agentSession.id,
              event.sessionId,
              effectiveSessionId ? 'resumed' : 'created',
            );
          }
          if (!invocationSessionRecorded) {
            invocationSessionRecorded = true;
            const current = invocationRepo.getById(invocation.id);
            if (current?.status === 'starting') {
              if (!invocationRepo.transitionOwned(invocation.id, runtimeOwnerToken, {
                to: 'running',
                expectedFrom: 'starting',
                cli_session_id: event.sessionId,
              })) throw new RuntimeOwnershipLostError('runtime_running_fence_lost');
            }
          }
        }
        runtimeEventCoordinator?.adapterEvent(event);

        if (event.type === 'tool_use' && event.tool?.name && isBackgroundChildTool(event.tool.name)) {
          hasBackgroundChildActivity = true;
          broadcastAgentActivity('awaiting_children', `tool:${event.tool.name}`);
        }

        if (event.type === 'text' || event.type === 'thinking') {
          projectViewPublisher.publish(sessionConvId, {
            type: event.type === 'text'
              ? 'runtime.text.delta'
              : 'runtime.thinking.delta',
            delivery: 'transient',
            actor: { type: 'agent', id: agentId },
            subject: { type: 'invocation', id: invocation.id },
            correlationId: invocationTraceId ?? invocation.id,
            causationId: controlEnvelopeId ?? invocation.id,
            payload: {
              taskId,
              content: event.content,
            },
          });
        }

        // Reset timeout on each event
        resetTimeout();
      });

      const canonicalEngine = (
        engine === 'opencode' || engine === 'claude' || engine === 'codex'
      ) ? engine : undefined;
      const createRuntimeEventCoordinator = () => {
        if (!canonicalEngine) return undefined;
        return new AcpRuntimeEventCoordinator({
          context: {
            projectId: sessionConvId,
            projectAgentId: agentId,
            invocationId: invocation.id,
            logicalSessionId: agentSession.id,
            runtimeActorId: targetNodeId,
            correlationId: workContract?.correlationId ?? invocationTraceId ?? invocation.id,
            causationId: controlEnvelopeId ?? workContract?.causationId,
          },
          engine: canonicalEngine,
          runtimeNodeId: targetNodeId,
          envelopeId: controlEnvelopeId,
          isPlatformTool: isSkillTool,
          onPublished: (event) => runtimeSocketProjection.project(event),
          onPublishError: (type, error) => {
            console.warn(
              `[platform-event] failed to publish/project ${type} for ${invocation.id}:`,
              error,
            );
          },
        });
      };
      if (canonicalEngine) {
        runtimeEventCoordinator = createRuntimeEventCoordinator();
        commitOwnedRuntimeEffect(() => runtimeEventCoordinator?.accept());
      }
      // `command` is retained for the terminal:exit broadcast payload below.
      const command = ENGINE_COMMAND[engine] || 'opencode';

      // Auto-detect git repo and resolve worktree
      let effectiveSlug = projectSlug;
      let effectiveUseWorktree = useWorktree ?? false;
      let worktreeStartPoint: string | undefined;
      let worktreeRepoRoot: string | undefined;
      let effectiveRepoRoot = projectPath;
      if (evaluation) {
        effectiveSlug = `eval-${evaluation.executionId}`.replace(/[^A-Za-z0-9._-]/g, '-');
        effectiveUseWorktree = true;
        effectiveRepoRoot = String(
          (evaluation.applicationManifest as { projectPath?: unknown }).projectPath ?? projectPath ?? '',
        ).trim() || undefined;
        worktreeStartPoint = String(
          (evaluation.applicationManifest as { codeRevision?: unknown }).codeRevision ?? '',
        ).trim() || undefined;
      }
      const requiresGitWorktree = effectiveUseWorktree
        || Boolean(conversationRepo.getById(sessionConvId)?.git_repo_root)
        || Boolean(evaluation);

      if (effectiveRepoRoot) {
        try {
          const { WorktreeManager } = await import('./worktree-manager');
          const isGit = await WorktreeManager.isGitRepo(effectiveRepoRoot);
          if (!isGit && requiresGitWorktree) {
            throw new Error('configured project path is not a Git worktree');
          }
          if (isGit) {
            const detectedRepoRoot = await WorktreeManager.getRepoRoot(effectiveRepoRoot) ?? undefined;
            const detectedHead = await WorktreeManager.getHead(effectiveRepoRoot) ?? undefined;
            if (!detectedRepoRoot || !detectedHead) {
              throw new Error('git repo root or HEAD could not be resolved');
            }
            effectiveSlug ??= conversationId || projectId || 'default';
            effectiveUseWorktree = true;
            worktreeRepoRoot = detectedRepoRoot;
            worktreeStartPoint ??= detectedHead;
            console.log(`[daemon] git repo detected at ${worktreeRepoRoot}, using worktree slug=${effectiveSlug}`);
          }
        } catch (e) {
          if (requiresGitWorktree) {
            throw new Error(`worktree_baseline_unavailable: ${(e as Error).message}`);
          }
          console.warn(`[daemon] git detection failed for ${effectiveRepoRoot}, using configured non-Git directory:`, (e as Error).message);
        }
      } else if (requiresGitWorktree) {
        throw new Error('worktree_baseline_unavailable: Git-backed dispatch requires projectPath');
      }

      const wd = await workdirManager.resolveWorkdir(
        agentId,
        projectId || 'default',
        stableWorkdirTaskKey(taskId),
        effectiveUseWorktree && effectiveSlug
          ? { useWorktree: true, projectSlug: effectiveSlug, startPoint: worktreeStartPoint, repoRoot: worktreeRepoRoot }
          : undefined,
      );
      const runtimeWd = effectiveUseWorktree
        ? wd
        : resolveNonWorktreeExecutionCwd(projectPath, wd);
      // Runtime, task projection, watcher, and prompt share one writable fact source.
      taskProjectDir = runtimeWd;
      runtimeCompletionContextRepo.updateTaskProjectDir(invocation.id, runtimeWd);
      const taskForWorkdir = taskId ? taskRepo.getById(taskId) : undefined;
      if (
        taskForWorkdir?.conversation_id === sessionConvId
        && taskForWorkdir.work_dir !== taskProjectDir
      ) {
        taskCommandService.recordProjectionLocation({
          conversationId: sessionConvId,
          taskId: taskForWorkdir.id,
          workDir: taskProjectDir,
        });
      }
      if (evaluation) {
        ensureTasksMdProjection(
          taskProjectDir,
          sessionConvId,
          taskRepo.getByConversation(sessionConvId).filter((item) => item.id === taskId),
        );
      } else {
        const claimState = beginTasksMdProjectionClaim(taskProjectDir, sessionConvId);
        if (claimState === 'claiming') {
          // The claiming marker commits before legacy import. A crash leaves the
          // original file recoverable, and the next daemon resumes this phase.
          syncTasksToDb(taskProjectDir, sessionConvId, io, {
            allowClaimingProjection: true,
            throwOnError: true,
            skipForeignTaskCollisions: true,
          });
        }
        // This transaction starts only after legacy Task import committed.
        ensureTasksMdProjection(
          taskProjectDir,
          sessionConvId,
          taskRepo.getByConversation(sessionConvId),
        );
      }
      if (!evaluation) startTaskWatcher(taskProjectDir, sessionConvId, io);
      if (evaluation && effectiveSlug) {
        const { WorktreeManager } = await import('./worktree-manager');
        const observedHead = await WorktreeManager.getHead(wd);
        if (!observedHead) {
          throw new Error('evaluation_manifest_mismatch: worktree HEAD is unavailable');
        }
        const targetManifest = evaluation.applicationManifest as Record<string, unknown>;
        evaluationObservedDigest = digest({ ...targetManifest, codeRevision: observedHead });
        if (evaluationObservedDigest !== evaluation.targetManifestDigest) {
          throw new Error(
            `evaluation_manifest_mismatch: target=${evaluation.targetManifestDigest}, observed=${evaluationObservedDigest}`,
          );
        }
      }
      for (const workspaceDir of new Set(evaluation ? [] : [sharedProjectDir, wd])) {
        try {
          teamLogProjection.materialize(sessionConvId, workspaceDir);
        } catch (error) {
          console.warn(`[team-log] materialize failed for ${workspaceDir}:`, error);
        }
      }

      // Build prompt with worktree context if applicable
      let promptWithWorkdir = evaluation
        ? `${prompt || ''}\n\n[系统] 这是隔离评估任务。只使用当前 worktree 和本次任务上下文，不读取项目中的其他会话状态。`
        : (prompt || '') + `\n\n[系统] 任务看板路径: ${join(taskProjectDir, '.ath')}/TASKS.md`;
      if (effectiveUseWorktree && effectiveSlug) {
        if (evaluation) {
          promptWithWorkdir += `\n[系统] 当前在绑定快照 commit 的隔离 Git Worktree 中执行，工作目录: ${wd}`;
        } else {
          const branchName = workdirManager.getWorktreeManager(worktreeRepoRoot).getBranchName(effectiveSlug);
          promptWithWorkdir += `\n[系统] 当前在 Git Worktree 分支 ${branchName} 下工作，工作目录: ${wd}`;
        }
      }

      // --- ACP-only backend construction (Task 10, spec §7.4/§8) ---
      // The bespoke factory + AGENT_BACKEND=legacy fallback were removed —
      // every engine MUST resolve to a catalog entry. Unknown engines throw
      // explicitly here instead of creating a parallel backend.
      //
      // `executeCwd`/`executeEnv` flow into the single ExecOptions object below
      // so the ACP path's prepared cwd/env (e.g. codex CODEX_HOME) reach spawn.
      const executeEnv: Record<string, string> = {
        ...credentialEnv,
        ...(runtimeConfigEnv || {}),
      };
      const permittedAcpTools = (workContract
        ? workContractToolNames(workContract)
        : contextReport?.availableTools ?? []).filter(isSkillTool);
      const mcpOrigin = resolveAcpMcpLoopbackOrigin(io);
      if ((permittedAcpTools.length > 0 || workContract) && !mcpOrigin) {
        throw new Error('acp_skill_mcp_unavailable: daemon HTTP listener has no loopback address');
      }
      const acpToolGrant = mcpOrigin
        ? registerAcpSkillMcpGrant({
          agentId,
          conversationId: sessionConvId,
          projectId,
          taskId,
          taskProjectDir,
          correlationId: workContract?.correlationId ?? invocationTraceId,
          causationId: workContract?.contractId ?? invocation.id,
          permittedTools: permittedAcpTools,
          workContract,
          io,
        }, mcpOrigin)
        : undefined;
      revokeAcpTools = acpToolGrant?.revoke;
      // codex startup ~117s (WebSocket→HTTPS fallback). The kill timer +
      // backend timeout are floored to ≥180s at the timeoutMs source for codex
      // ACP (see ~L690). Warn when the operator-tuned raw timeout was below
      // the floor.
      if (engine === 'codex' && rawTimeoutMs > 0 && rawTimeoutMs < 180_000) {
        console.warn(`[daemon] raising timeout ${rawTimeoutMs}ms → 180000ms for codex ACP startup`);
      }
      const agentDefinition = agentDefinitionRepo.get(agentId);
      const acpTurn = await acpRuntimeDriver.prepareTurn({
        agentId,
        projectId,
        laneId: sessionConvId,
        runtimeNodeId: 'local',
        engine,
        cwd: runtimeWd,
        env: executeEnv,
        systemPrompt: systemPrompt || undefined,
        resumeSessionId: effectiveSessionId || undefined,
        timeoutMs,
        workerCount: agentDefinition?.parallelism ?? undefined,
        workerNames: agentDefinition?.instance_name_pool,
        workContract,
        mcpServers: acpToolGrant ? [acpToolGrant.mcpServer] : [],
        autoApproveMcpToolNames: acpToolGrant?.autoApproveToolNames ?? [],
        terminalMcpToolNames: acpToolGrant?.terminalToolNames ?? [],
        currentGrantToken: acpToolGrant?.grantToken,
        onPermissionRequested: (request) => commitOwnedRuntimeEffect(
          () => runtimeEventCoordinator?.permissionRequested(request),
        ),
        onPermissionResolved: (response) => commitOwnedRuntimeEffect(
          () => runtimeEventCoordinator?.permissionResolved(response),
        ),
      });
      console.log(
        `[daemon] routing ${agentId} (${engine}) → ACP (${acpTurn.entry.delivery}/${acpTurn.entry.id})`,
      );
      acpCleanup = acpTurn.cleanup;
      const { backend, execOptions } = acpTurn;

      // The per-turn timeout. timeoutMs already carries the codex-ACP floor
      // (see ~L690), so resetTimeout, backend.execute, and the retry path all
      // read this single floored value — no separate effectiveTimeoutMs needed.

      recordRuntimeContextObservation({
        transport: 'acp',
        systemPromptChannel: engine === 'opencode' && systemPrompt
          ? 'instructions'
          : execOptions.systemPrompt
            ? 'backend'
            : 'none',
        prompt: promptWithWorkdir,
        systemPrompt: engine === 'opencode'
          ? systemPrompt || undefined
          : execOptions.systemPrompt,
      });
      capturePromptObservation(
        promptWithWorkdir,
        engine === 'opencode' ? systemPrompt || undefined : execOptions.systemPrompt,
      );
      const run = backend.execute(promptWithWorkdir, execOptions);
      const { events, result, kill } = run;
      ownedRuntimeKill = kill;
      const abortRuntimeStart = () => kill();
      lifecycle.signal?.addEventListener('abort', abortRuntimeStart, { once: true });
      if (lifecycle.signal?.aborted) {
        kill();
        throw new Error('runtime_start_cancelled');
      }
      const runtimeStart = await run.started;
      if (!runtimeStart.ok) {
        kill();
        throw new Error(`${runtimeStart.reasonCode}:${runtimeStart.message}`);
      }
      if (lifecycle.signal?.aborted) {
        kill();
        throw new Error('runtime_start_cancelled');
      }
      const runtimeAdmission = {
        invocationId: invocation.id,
        traceId: invocationTraceId,
        ...(evaluationObservedDigest
          ? { observedManifestDigest: evaluationObservedDigest }
          : {}),
      } satisfies RuntimeAdmissionContext;
      if (!lifecycle.acknowledge(runtimeAdmission)) {
        kill();
        throw new RuntimeOwnershipLostError('runtime_dispatch_not_acknowledged');
      }
      if (evaluation) {
        projectEvaluationRuntimeAdmission({
          projectId: sessionConvId,
          projectAgentId: agentId,
          executionId: evaluation.executionId,
          taskId,
          applicationSnapshotId: evaluation.applicationSnapshotId,
          targetManifestDigest: evaluation.targetManifestDigest,
          invocationId: invocation.id,
          traceId: invocationTraceId,
          observedManifestDigest: evaluationObservedDigest,
        });
      }
      emitDispatchReceipt('acknowledged');
      commitOwnedRuntimeEffect(() => runtimeEventCoordinator?.start());

      const activeRuntimeProcess = { kill };
      agentProcesses.attach(agentId, projectId, activeRuntimeProcess);
      // Consume events and forward to socket
      (async () => {
        try {
          for await (const event of events) {
            handleAdapterSignal(event);
          }

          // Wait for final result
          const final = await result;
          if (!invocationRepo.ownsRuntimeLease(invocation.id, runtimeOwnerToken)) {
            throw new RuntimeOwnershipLostError('runtime_result_fence_lost');
          }
          clearProcessTimeout();
          clearInterval(heartbeatTimer);

          const finalRuntimeSessionId = final.sessionId ?? observedRuntimeSessionId;
          if (
            final.sessionId
            && observedRuntimeSessionId
            && final.sessionId !== observedRuntimeSessionId
          ) {
            throw new Error(
              `session_identity_changed: expected ${observedRuntimeSessionId}, received ${final.sessionId}`,
            );
          }

          if (final.status === 'completed') {
            if (!finalRuntimeSessionId) {
              throw new Error('session_identity_missing: completed invocation returned no session id');
            }
            const binding = completeInvocation(finalRuntimeSessionId);
            if (binding.status === 'bound') {
              runtimeEventCoordinator?.confirmSession(finalRuntimeSessionId);
            }
          } else {
            terminateInvocation(
              final.status === 'timeout'
                ? 'timed_out'
                : final.status === 'cancelled'
                  ? 'cancelled'
                  : 'failed',
              {
              exit_code: 1,
              reason_code: final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : undefined),
              ...(final.error ? { error_message: final.error } : {}),
              },
            );
            if (final.reasonCode === 'acp_session_not_found') {
              agentSessions.seal(agentSession.id, 'runtime_resource_not_found');
            }
          }

          // The owner-fenced terminal transition above is the linearization
          // point. Only its winner may publish business completion effects.
          if (final.usage && Object.keys(final.usage).length > 0) {
            invocationRepo.updateDispatchStatus(invocation.id, 'completed', {
              tokenUsage: JSON.stringify(final.usage),
            });
          }
          if (taskId && projectId) {
            workdirManager.writeGCMeta(agentId, projectId, taskId);
          }

          runtimeEventCoordinator?.terminate({
            status: final.status,
            reasonCode: final.reasonCode,
            durationMs: final.durationMs,
            sessionId: finalRuntimeSessionId,
            usage: final.usage,
          });

          // Confirmed bindings survive failure/timeout. A new binding is not
          // persisted until success, so a cancelled first turn provisions a
          // fresh runtime Session on the next dispatch.

          if (final.status === 'completed') {
            markExecutionCompleted();
            if (evaluation) {
              const evaluationTask = taskId ? taskRepo.getById(taskId) : undefined;
              if (evaluationTask) {
                const transitionKey = `evaluation-task:review:${evaluation.executionId}`;
                taskCommandService.transition({
                  conversationId: sessionConvId,
                  taskId: evaluationTask.id,
                  expectedTaskRevision: evaluationTask.revision,
                  expectedGraphRevision: taskCommandService.expectedGraphRevision(
                    sessionConvId,
                    transitionKey,
                  ),
                  idempotencyKey: transitionKey,
                  actor: { type: 'system', id: 'evaluation-runtime' },
                  correlationId: invocationTraceId,
                  causationId: invocation.id,
                  to: 'in_review',
                });
              }
              const submitted = agentEvaluation.submit({
                conversationId: sessionConvId,
                rootTaskId: taskId,
                triggerId: evaluation.executionId,
                caseId: evaluation.caseId,
                applicationManifest: evaluation.applicationManifest as Record<string, unknown>,
                mode: 'offline',
              });
              transitionCaseExecution({
                id: evaluation.executionId,
                conversationId: sessionConvId,
                status: 'evaluating',
                invocationId: invocation.id,
                traceId: invocationTraceId,
                evalRunId: submitted.runId,
                observedManifestDigest: evaluationObservedDigest,
              });
              agentSessions.seal(agentSession.id, 'evaluation_execution_completed');
            }
          } else {
            markExecutionOrEnvelopeFailed(
              final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : 'runtime_failed'),
            );
            if (evaluation) {
              const evaluationTask = taskId ? taskRepo.getById(taskId) : undefined;
              if (evaluationTask) {
                const transitionKey = `evaluation-task:blocked:${evaluation.executionId}`;
                taskCommandService.transition({
                  conversationId: sessionConvId,
                  taskId: evaluationTask.id,
                  expectedTaskRevision: evaluationTask.revision,
                  expectedGraphRevision: taskCommandService.expectedGraphRevision(
                    sessionConvId,
                    transitionKey,
                  ),
                  idempotencyKey: transitionKey,
                  actor: { type: 'system', id: 'evaluation-runtime' },
                  correlationId: invocationTraceId,
                  causationId: invocation.id,
                  to: 'blocked',
                  reviewNote: final.error ?? final.reasonCode,
                });
              }
              transitionCaseExecution({
                id: evaluation.executionId,
                conversationId: sessionConvId,
                status: 'failed',
                invocationId: invocation.id,
                traceId: invocationTraceId,
                observedManifestDigest: evaluationObservedDigest,
                errorCode: final.reasonCode ?? 'runtime_failed',
                errorMessage: final.error,
              });
              agentSessions.seal(agentSession.id, 'evaluation_execution_failed');
            }
          }

          publishTerminalExit({
            code: final.status === 'completed' ? 0 : 1,
            command,
            reasonCode: final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : undefined),
            activity: final.status === 'completed' && hasBackgroundChildActivity ? 'awaiting_children' : 'idle',
          });
          agentProcesses.remove(agentId, projectId, activeRuntimeProcess);
          clearRuntimeOwnershipHeartbeat();
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
          revokeAcpTools?.();
        } catch (err) {
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          clearRuntimeOwnershipHeartbeat();
          if (isRuntimeOwnershipLost(err)) {
            kill();
            console.warn(`[daemon][${agentId}] discarded output after Runtime ownership loss`);
            agentProcesses.remove(agentId, projectId, activeRuntimeProcess);
            if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
            acpCleanup?.();
            revokeAcpTools?.();
            return;
          }
          console.error(`[daemon][${agentId}] backend error:`, err);
          try {
            terminateInvocation('failed', {
              exit_code: 1,
              reason_code: 'spawn_failed',
              error_message: (err as Error)?.message,
            });
          } catch (invocationError) {
            kill();
            console.warn(
              `[daemon][${agentId}] discarded backend failure without Runtime terminal ownership:`,
              invocationError,
            );
            agentProcesses.remove(agentId, projectId, activeRuntimeProcess);
            if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
            acpCleanup?.();
            revokeAcpTools?.();
            return;
          }
          runtimeEventCoordinator?.failSetup('spawn_failed', observedRuntimeSessionId);
          // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
          markExecutionOrEnvelopeFailed('spawn_failed');
          if (evaluation) {
            try {
              const evaluationTask = taskId ? taskRepo.getById(taskId) : undefined;
              if (evaluationTask) {
                const transitionKey = `evaluation-task:spawn-failed:${evaluation.executionId}`;
                taskCommandService.transition({
                  conversationId: sessionConvId,
                  taskId: evaluationTask.id,
                  expectedTaskRevision: evaluationTask.revision,
                  expectedGraphRevision: taskCommandService.expectedGraphRevision(
                    sessionConvId,
                    transitionKey,
                  ),
                  idempotencyKey: transitionKey,
                  actor: { type: 'system', id: 'evaluation-runtime' },
                  correlationId: invocationTraceId,
                  causationId: invocation.id,
                  to: 'blocked',
                  reviewNote: (err as Error)?.message,
                });
              }
              transitionCaseExecution({
                id: evaluation.executionId,
                conversationId: sessionConvId,
                status: 'failed',
                invocationId: invocation.id,
                traceId: invocationTraceId,
                observedManifestDigest: evaluationObservedDigest,
                errorCode: 'spawn_failed',
                errorMessage: (err as Error)?.message,
              });
              agentSessions.seal(agentSession.id, 'evaluation_execution_failed');
            } catch (transitionError) {
              console.error('[evaluation] failed to record execution failure:', transitionError);
            }
          }
          publishTerminalExit({ code: 1, command, reasonCode: 'spawn_failed' });
          agentProcesses.remove(agentId, projectId, activeRuntimeProcess);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
          revokeAcpTools?.();
        }
      })();
      } catch (err) {
        clearRuntimeOwnershipHeartbeat();
        if (isRuntimeOwnershipLost(err)) {
          if (acquiredInvocationId && acquiredRuntimeOwnerToken) {
            const current = invocationRepo.getById(acquiredInvocationId);
            if (current && current.status !== 'terminated') {
              invocationRepo.transitionOwned(acquiredInvocationId, acquiredRuntimeOwnerToken, {
                to: 'terminated',
                expectedFrom: current.status,
                outcome: 'failed',
                exit_code: 1,
                reason_code: err.reasonCode,
                error_message: err.message,
              });
            }
          }
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
          revokeAcpTools?.();
          return;
        }
        console.error(`[daemon] execution error for agent=${agentId}:`, err);
        const setupFailure = describeRuntimeSetupFailure(err);
        const envelopeAtFailure = controlEnvelopeId
          ? executionEnvelopeRepo.getById(controlEnvelopeId)
          : undefined;
        if (acquiredInvocationId) {
          try {
            const currentInvocation = invocationRepo.getById(acquiredInvocationId);
            if (currentInvocation && currentInvocation.status !== 'terminated') {
              const terminated = acquiredRuntimeOwnerToken
                ? invocationRepo.transitionOwned(acquiredInvocationId, acquiredRuntimeOwnerToken, {
                to: 'terminated',
                expectedFrom: currentInvocation.status,
                outcome: 'failed',
                exit_code: 1,
                reason_code: setupFailure.reasonCode,
                error_message: setupFailure.diagnosticMessage,
                })
                : undefined;
              if (!terminated) {
                console.warn('[daemon] discarded setup failure after Runtime ownership loss');
                if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
                acpCleanup?.();
                revokeAcpTools?.();
                return;
              }
            }
          } catch (invocationError) {
            console.error('[daemon] failed to terminate setup invocation:', invocationError);
          }
        }
        finishObservation('error', setupFailure.reasonCode);
        runtimeEventCoordinator?.failSetup(setupFailure.reasonCode);
        if (evaluation && envelopeAtFailure?.status === 'acknowledged') {
          try {
            const current = getDb().prepare('SELECT status FROM eval_case_execution WHERE id=?')
              .get(evaluation.executionId) as { status: string } | undefined;
            if (current && !['completed', 'failed', 'cancelled'].includes(current.status)) {
              transitionCaseExecution({
                id: evaluation.executionId,
                conversationId,
                status: 'failed',
                observedManifestDigest: evaluationObservedDigest,
                errorCode: `${setupFailure.reasonCode}_after_ack`,
                errorMessage: setupFailure.diagnosticMessage,
              });
            }
          } catch (transitionError) {
            console.error('[evaluation] failed to record post-ACK setup failure:', transitionError);
          }
        }
        if (controlEnvelopeId) {
          const receiptConversationId = projectId;
          const current = envelopeAtFailure;
          if (current?.status === 'acknowledged') {
            dispatchGateway.markExecutionFailed(controlEnvelopeId, setupFailure.reasonCode);
          } else if (current && current.status !== 'rejected' && current.status !== 'expired') {
            dispatchGateway.reject(controlEnvelopeId, setupFailure.reasonCode);
            const receiptId = `${controlEnvelopeId}:rejected`;
            projectViewPublisher.publish(receiptConversationId, {
              type: 'dispatch.receipt',
              delivery: 'durable',
              actor: { type: 'runtime', id: LOCAL_DAEMON_NODE_ID },
              subject: { type: 'envelope', id: controlEnvelopeId },
              eventId: receiptId,
              correlationId: invocationTraceId ?? controlEnvelopeId,
              causationId: controlEnvelopeId,
              payload: {
                projectId: receiptConversationId,
                receiptId,
                conversationId: receiptConversationId,
                sourceMessageId,
                taskId,
                targetAgentId: agentId,
                source: dispatchSource ?? 'user',
                phase: 'rejected',
                chainId,
                passId,
                reasonCode: setupFailure.reasonCode,
                createdAt: new Date().toISOString(),
              },
            });
          }
        }
        projectViewPublisher.publish(projectId, {
          type: 'runtime.warning',
          delivery: 'transient',
          actor: { type: 'agent', id: agentId },
          ...runtimeProjectViewIdentity({
            invocationId: acquiredInvocationId,
            traceId: invocationTraceId,
            envelopeId: controlEnvelopeId,
            projectId,
          }),
          payload: {
            message: setupFailure.userMessage,
            reasonCode: setupFailure.reasonCode,
          },
        });
        projectViewPublisher.publish(projectId, {
          type: 'terminal.exited',
          delivery: 'transient',
          actor: { type: 'agent', id: agentId },
          ...runtimeProjectViewIdentity({
            invocationId: acquiredInvocationId,
            traceId: invocationTraceId,
            envelopeId: controlEnvelopeId,
            projectId,
          }),
          payload: {
            code: 1,
            command: primaryCommand,
            reasonCode: setupFailure.reasonCode,
          },
        });
        agentProcesses.remove(agentId, projectId);
        if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        acpCleanup?.();
        revokeAcpTools?.();
      }
    };

  io.on('connection', (socket: Socket) => {
    socket.on('daemon:status', ({ projectId }: { projectId?: string }, callback) => {
      const activeAgents: Record<string, { taskId?: string; conversationId?: string }> = {};
      const normalizedProjectId = projectId?.trim();
      if (!normalizedProjectId) {
        callback?.({ activeAgents, error: 'project_id_required' });
        return;
      }
      for (const [key] of agentProcesses.entries()) {
        const separator = key.lastIndexOf('@');
        const agentId = separator >= 0 ? key.slice(0, separator) : key;
        const activeProjectId = separator >= 0 ? key.slice(separator + 1) : 'default';
        if (activeProjectId !== normalizedProjectId) continue;
        const session = agentSessions.findActive(agentId, normalizedProjectId);
        if (session) {
          activeAgents[agentId] = {
            taskId: session.task_id || undefined,
            conversationId: session.conversation_id || undefined,
          };
        } else {
          activeAgents[agentId] = {};
        }
      }
      callback?.({ activeAgents });
    });

    // --- Worktree management events ---
    socket.on('worktree:list', async (callback) => {
      try {
        const worktrees = await workdirManager.getWorktreeManager().listWorktrees();
        callback?.({ worktrees });
      } catch {
        callback?.({ error: 'Failed to list worktrees' });
      }
    });

    socket.on('worktree:create', async ({ projectSlug: slug }: { projectSlug: string }, callback) => {
      try {
        const worktree = await workdirManager.getWorktreeManager().createWorktree(slug);
        callback?.({ worktree });
      } catch {
        callback?.({ error: 'Failed to create worktree' });
      }
    });

    socket.on('worktree:remove', async ({ projectSlug: slug }: { projectSlug: string }, callback) => {
      try {
        await workdirManager.getWorktreeManager().removeWorktree(slug);
        callback?.({ success: true });
      } catch {
        callback?.({ error: 'Failed to remove worktree' });
      }
    });

  });

  // Graceful shutdown
  const shutdown = async () => {
    agentInboxScheduler.stop();
    stopWorktreeGCScheduler();
    clearInterval(runtimeHealthTimer);
    autonomyGuardOwner.stop();
    deliveryTaskTruthReconciler.stop();
    agentProcesses.shutdown();
    await acpRuntimeDriver.shutdown();
  };
  registerDesktopServiceDrain(shutdown);
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}
