import type { Server as IOServer, Socket } from 'socket.io';
import { join } from 'path';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { TmuxGateway, TmuxPaneSetupError } from './tmux-gateway';
import {
  recoverRestartedTmuxExecutions,
  parseRestartedTmuxExecution,
  RestartedTmuxRecoveryTracker,
  terminateTmuxPaneBeforeRecovery,
  type RestartedTmuxExecution,
} from './tmux-dispatch-lifecycle';
import { AgentPaneRegistry } from './agent-pane-registry';
import { readAccount } from './accounts-file';
import { readCredential } from './credentials';
import { buildProbeEnv } from './cli-probe';
import { generateRuntimeConfig, cleanupRuntimeConfig, makeInvocationId } from './opencode-config';
import { startTaskWatcher, syncTasksToDb } from './task-file-watcher';
import { ensureTasksMdProjection } from './task-file-service';
import type { AccountProvider as RuntimeAccountProvider } from './opencode-config';
import type { CliEngine, DetectedRuntime } from './types';
import { sessionRepo } from './repositories/session-repo';
import type { AgentSessionRow } from './repositories/session-repo';
import { invocationRepo } from './repositories/invocation-repo';
import type { InvocationRow } from './repositories/invocation-repo';
import { messageRepo } from './repositories/message-repo';
import { eventRepo } from './repositories/event-repo';
import { generateSortableId } from './repositories/sortable-id';
import { loadCatalog } from './agent/acp/catalog';
import {
  prepareAcpRuntime,
} from './agent/acp/runtimeSetup';
import { createBackend as createAcpBackend } from './agent/acp/catalog';
import { checkCapabilities } from './agent/capabilityRouter';
import { buildOpenCodeRunArgs } from './agent/opencode-prompt-delivery';
import type { AgentEvent, AgentBackend } from './agent/types';
import { withDoneGuarantee } from './agent/with-done-guarantee';
import { isSkillTool } from './skill-tool-router';
import { registerAcpSkillMcpGrant, resolveAcpMcpLoopbackOrigin } from './acp-skill-mcp';
import { StreamTextPersistence } from './agent/streamTextPersistence';
import { resolveNonWorktreeExecutionCwd, stableWorkdirTaskKey, WorkdirManager } from './workdir-manager';
import { AgentMessenger } from './a2a';
import { createRuntimeSnapshotProvider } from './a2a/runtime-snapshot-provider';
import { getDb } from './db';
import { DispatchGateway } from './control-plane/dispatch-gateway';
import { runtimeNodeRepo } from './repositories/runtime-node-repo';
import type { DispatchIntent, DispatchSource, RuntimeNodeKind } from './repositories/control-plane-types';
import { taskRepo } from './repositories/task-repo';
import { conversationRepo } from './repositories/conversation-repo';
import { taskGraphRepo } from './repositories/task-graph-repo';
import { executionEnvelopeRepo } from './repositories/execution-envelope-repo';
import { proofLogRepo } from './repositories/proof-log-repo';
import { resolveTaskNotificationAudience } from './task-flow/task-notification-publisher';
import { resolveAutonomyGuardWakeups } from './task-flow/autonomy-guard';
import { startWorktreeGCScheduler, stopWorktreeGCScheduler } from './worktree-gc';
import {
  HarnessCoordinator,
  RepositoryHarnessPlanner,
  registerHarnessCoordinator,
  submitTaskWakeupToHarness,
  type HarnessDispatchPlan,
  type HarnessOutcome,
  type HarnessSubmission,
} from './harness';
import { finalizeRuntimeContextSnapshot } from './harness/runtime-context-snapshot';
import { checkValidExit } from './harness/valid-exit';
import type { ContextReport, ContextSnapshot } from '../lib/agent-context/ContextManager';
import type { ContextScenario } from '../lib/agent-context/scenarioResolver';
import { generateSpanId, generateTraceId, observationSpanRepo } from './repositories/observation-span-repo';
import { spanPayloadRepo } from './repositories/span-payload-repo';
import { isThinkingCaptureEnabled } from './observability/redaction';
import { capturePromptPayloads } from './observability/prompt-observation';
import { teamLogProjection } from './team-log/TeamLogProjection';
import { renderTeamLogEnvelope } from '../lib/agent-context/teamLog';
import { deleteIfCurrent, ProcessStartGuard } from './process-start-guard';
import { agentEvaluation, startEvaluationWorker } from './evaluation/agent-evaluation';
import { digest } from './evaluation/defaults';
import { transitionCaseExecution } from './evaluation/application-snapshot';
import { EvaluationCaseRunner } from './evaluation/case-runner';
import {
  allowsProductionCollaborationEffects,
  evaluationSafeTextSink,
} from './evaluation/runtime-isolation';
import { ensureAutonomousDeliveryRuntime } from './autonomous-delivery/bootstrap';
import { autonomousDeliveryRepo } from './autonomous-delivery/repository';
import { registerAutonomousDeliveryE2EDriver } from './testing/autonomous-delivery-e2e-driver';
import { createAcpDispatchPermissionPolicy } from './agent/acp/dispatchPermissionPolicy';

type TerminalStartPayload = {
  dispatchId?: string;
  projectId?: string;
  taskId?: string;
  deliveryRunId?: string;
  agentId: string;
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  conversationId?: string;
  sourceNodeId?: string;
  dispatchSource?: DispatchSource;
  dispatchIntent?: DispatchIntent;
  fromAgentId?: string;
  chainId?: string;
  passId?: string;
  opencodeBridgeUrl?: string;
  engine?: CliEngine;
  runtimeId?: string;
  providerProfileId?: string;
  channel?: string;
  authContextId?: string;
  accountIds?: string[];
  accountId?: string;
  force?: boolean;
  projectSlug?: string;
  projectPath?: string;
  useWorktree?: boolean;
  contextScenario?: ContextScenario;
  teamLogUpToEntryId?: string;
  traceId?: string;
  contextReport?: ContextReport;
  contextSnapshot?: ContextSnapshot;
  evaluation?: HarnessDispatchPlan['evaluation'];
};

type ActiveProcess = {
  kill: () => void | Promise<void>;
  onTerminated?: (reasonCode: string) => void | Promise<void>;
};

export interface DaemonActiveRunSnapshot {
  agentId: string;
  taskId?: string;
  conversationId: string;
}

export function projectDaemonActiveRuns(
  processKeys: Iterable<string>,
  findSession: (agentId: string, conversationId: string) => { task_id?: string | null } | undefined,
): DaemonActiveRunSnapshot[] {
  const snapshots: DaemonActiveRunSnapshot[] = [];
  for (const key of processKeys) {
    const separator = key.indexOf('@');
    const agentId = separator >= 0 ? key.slice(0, separator) : key;
    const conversationId = separator >= 0 ? key.slice(separator + 1) : 'default';
    if (conversationId === 'default') continue;
    const session = findSession(agentId, conversationId);
    snapshots.push({
      agentId,
      taskId: session?.task_id || undefined,
      conversationId,
    });
  }
  return snapshots;
}

export function submitSocketTerminalStart(
  coordinator: Pick<HarnessCoordinator, 'submit'>,
  payload: TerminalStartPayload,
): HarnessSubmission {
  const conversationId = payload.conversationId?.trim();
  if (!conversationId) throw new Error('conversation_missing: terminal:start requires conversationId');
  return coordinator.submit({
    id: payload.dispatchId?.trim() || `socket:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    idempotencyKey: payload.dispatchId?.trim() || undefined,
    source: payload.dispatchSource ?? 'user',
    conversationId,
    taskId: payload.taskId,
    agentId: payload.agentId,
    prompt: payload.prompt,
    fromAgentId: payload.fromAgentId,
    chainId: payload.chainId,
    passId: payload.passId,
  });
}

type AgentActivityStatus = 'running' | 'awaiting_children' | 'idle';

const ENGINE_COMMAND: Record<CliEngine, string> = {
  opencode: 'opencode',
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  mock: process.execPath,
};

const RUNTIME_ENGINE_MAP: Record<string, CliEngine> = {
  daemon: 'opencode',
  'opencode-local': 'opencode',
  'opencode-bridge': 'opencode',
  'claude-cli': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'gemini',
  'mock-runtime': 'mock',
};

/** Default CLI idle timeout (ms). Configurable via CLI_TIMEOUT_MS env. 0 = disabled. */
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min
const STRIP_ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[()>]|\r/g;
const LOCAL_DAEMON_NODE_ID = 'daemon:local';
const RUNTIME_HEARTBEAT_INTERVAL_MS = 5_000;
const OPENCODE_PROJECT_SKILLS_DIR = join('.opencode', 'skills');

class DispatchExpiredBeforeStartError extends Error {
  readonly reasonCode = 'dispatch_expired';

  constructor() {
    super('Dispatch expired before runtime start');
    this.name = 'DispatchExpiredBeforeStartError';
  }
}

function resolveAcpPermissionPolicy(conversationId: string, deliveryRunId?: string) {
  return createAcpDispatchPermissionPolicy({
    operatorMode: process.env.ACP_PERMISSION_MODE,
    deliveryRunId,
    conversationId,
    getAuthorization(runId) {
      const delivery = autonomousDeliveryRepo.getSnapshot(runId);
      return delivery ? {
        runId: delivery.run.id,
        conversationId: delivery.run.conversation_id,
        status: delivery.run.status,
        allowCodeChanges: delivery.contract.authorization.allowCodeChanges,
      } : undefined;
    },
  });
}

type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

async function resolveCredentialEnv(accountId?: string): Promise<Record<string, string>> {
  if (!accountId) return {};
  const account = await readAccount(accountId);
  if (!account || account.authMode !== 'api_key') return {};
  const cred = await readCredential(accountId);
  if (!cred?.apiKey) return {};
  return buildProbeEnv(account.provider as AccountProvider, cred.apiKey, account.baseUrl);
}

const execAsync = promisify(exec);

async function detectAvailableRuntimes(): Promise<DetectedRuntime[]> {
  const results: DetectedRuntime[] = [];
  const engines: CliEngine[] = ['claude', 'codex', 'opencode'];
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
  const activeProcesses = new Map<string, ActiveProcess>();
  const processKey = (agentId: string, projectId?: string) => `${agentId}@${projectId || 'default'}`;
  const processStartGuard = new ProcessStartGuard();
  const broadcast = (event: string, data: unknown) => io.emit(event, data);
  const dispatchGateway = new DispatchGateway();
  let resolveDispatchStartupReady: (() => void) | undefined;
  const dispatchStartupReady = new Promise<void>((resolve) => {
    resolveDispatchStartupReady = resolve;
  });
  // Deferred until after the Harness port is constructed; the port closes over this handler.
  // eslint-disable-next-line prefer-const
  let handleTerminalStart: ((payload: TerminalStartPayload, emitToRequester?: (event: string, data: unknown) => void) => Promise<void>) | undefined;

  const harnessCoordinator = new HarnessCoordinator({
    planner: new RepositoryHarnessPlanner(),
    runtime: {
      isBusy(agentId, conversationId) {
        return activeProcesses.has(processKey(agentId, conversationId));
      },
      async execute(plan: HarnessDispatchPlan): Promise<HarnessOutcome> {
        if (!handleTerminalStart) {
          return { status: 'failed', reasonCode: 'internal_error', message: 'daemon runtime port is not ready' };
        }
        await handleTerminalStart({
          projectId: plan.trigger.conversationId,
          conversationId: plan.trigger.conversationId,
          taskId: plan.trigger.taskId,
          deliveryRunId: plan.trigger.deliveryRunId,
          agentId: plan.trigger.agentId,
          prompt: plan.prompt,
          systemPrompt: plan.systemPrompt,
          sourceNodeId: LOCAL_DAEMON_NODE_ID,
          dispatchSource: plan.trigger.source,
          dispatchIntent: plan.trigger.source === 'review_gate'
            ? 'review'
            : plan.trigger.source === 'test_gate'
              ? 'verify'
              : plan.trigger.source === 'a2a'
                ? 'delegate'
                : 'implement',
          fromAgentId: plan.trigger.fromAgentId,
          chainId: plan.trigger.chainId,
          passId: plan.trigger.passId,
          engine: plan.engine,
          runtimeId: plan.runtimeId,
          accountId: plan.accountId,
          projectPath: plan.projectPath,
          useWorktree: plan.useWorktree,
          contextScenario: plan.contextScenario,
          teamLogUpToEntryId: plan.teamLogUpToEntryId,
          traceId: plan.traceId,
          contextReport: plan.contextReport,
          contextSnapshot: plan.contextSnapshot,
          evaluation: plan.evaluation,
        }, (event, data) => io.to(plan.trigger.conversationId).emit(event, data));
        return { status: 'accepted' };
      },
    },
  });
  registerHarnessCoordinator(io, harnessCoordinator);
  registerAutonomousDeliveryE2EDriver(io);
  const evaluationCaseRunner = new EvaluationCaseRunner(harnessCoordinator);
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

  const autonomyWakeupPublishedAt = new Map<string, number>();
  let lastTeamLogArchiveSweepAt = 0;
  const autonomyGuardTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of autonomyWakeupPublishedAt) {
      if (now - timestamp > 2 * 60 * 1000) autonomyWakeupPublishedAt.delete(key);
    }

    const tasks = taskRepo.list();
    const conversationIds = Array.from(new Set(tasks.map((task) => task.conversation_id)));
    const activeDeliveryRuns = autonomousDeliveryRepo.listActive();
    if (now - lastTeamLogArchiveSweepAt >= 24 * 60 * 60 * 1000) {
      for (const conversationId of conversationIds) {
        try {
          teamLogProjection.materializeRegistered(conversationId);
        } catch (error) {
          console.warn(`[team-log] daily archive sweep failed for ${conversationId}:`, error);
        }
      }
      lastTeamLogArchiveSweepAt = now;
    }
    for (const conversationId of conversationIds) {
      const conversationTasks = tasks.filter((task) => task.conversation_id === conversationId);
      const audience = resolveTaskNotificationAudience(conversationId);
      const closureProofs = proofLogRepo.findByType({
        eventType: 'chain_closure_dispatched',
        conversationId,
        reasonCode: 'chain_ready_for_closure',
      });
      const wakeups = resolveAutonomyGuardWakeups({
        tasks: conversationTasks,
        envelopes: executionEnvelopeRepo.listByConversation(conversationId),
        coordinatorAgentIds: audience.coordinatorAgentIds,
        reviewAgentIds: audience.reviewGateAgentIds,
        qaAgentIds: audience.qaAgentIds,
        edges: taskGraphRepo.listEdges(conversationId),
        closureDispatchedRootTaskIds: closureProofs
          .map((proof) => proof.task_id)
          .filter((taskId): taskId is string => Boolean(taskId)),
        activeDeliveryRootTaskIds: activeDeliveryRuns
          .filter((run) => run.conversation_id === conversationId)
          .map((run) => run.root_task_id)
          .filter((taskId): taskId is string => Boolean(taskId)),
      });
      for (const wakeup of wakeups) {
        const key = wakeup.metadata.idempotencyKey;
        if (autonomyWakeupPublishedAt.has(key)) continue;
        autonomyWakeupPublishedAt.set(key, now);
        proofLogRepo.append({
          eventType: 'autonomy_guard.wakeup',
          conversationId: wakeup.conversationId,
          taskId: wakeup.taskId,
          agentId: wakeup.agentId,
          reasonCode: wakeup.reasonCode,
          metadata: {
            dispatchSource: wakeup.dispatchSource,
            idempotencyKey: key,
          },
        });
        const submission = submitTaskWakeupToHarness(io, wakeup);
        if (
          wakeup.reasonCode === 'chain_ready_for_closure'
          && submission?.handled
          && submission.disposition === 'accepted'
        ) {
          proofLogRepo.append({
            eventType: 'chain_closure_dispatched',
            conversationId: wakeup.conversationId,
            taskId: wakeup.metadata.rootTaskId ?? wakeup.taskId,
            agentId: wakeup.agentId,
            reasonCode: wakeup.reasonCode,
            metadata: {
              idempotencyKey: key,
              subtreeSize: wakeup.metadata.subtreeSize,
              partial: wakeup.metadata.partial,
            },
          });
        }
        io.to(wakeup.conversationId).emit('task.wakeup', {
          ...wakeup,
          id: `wakeup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          handledByHarness: submission?.handled ?? false,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }, Number(process.env.AUTONOMY_GUARD_INTERVAL_MS || 60_000));
  autonomyGuardTimer.unref();

  const workspacesRoot = process.env.ATH_WORKSPACES_ROOT || join(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
  const workdirManager = new WorkdirManager(workspacesRoot);
  workdirManager.gc(24 * 3600 * 1000);
  startWorktreeGCScheduler(workdirManager);

  const tmuxEnabled = process.env.ATH_TMUX_ENABLED === '1';
  let tmuxGateway: TmuxGateway | undefined;
  let agentPaneRegistry: AgentPaneRegistry | undefined;

  if (tmuxEnabled) {
    try {
      tmuxGateway = new TmuxGateway();
      agentPaneRegistry = new AgentPaneRegistry();
      console.log('[daemon] tmux integration enabled');
    } catch (err) {
      console.error('[daemon] tmux not available, falling back to direct spawn:', (err as Error).message);
      tmuxGateway = undefined;
    }
  }

  let restartedTmuxRecovery = Promise.resolve();
  let daemonStartupReconcileObserved = false;
  let tmuxRecoveryReady = false;
  let restartedTmuxTracker: RestartedTmuxRecoveryTracker | undefined;
  const ensureRestartedTmuxTracker = (): RestartedTmuxRecoveryTracker | undefined => {
    const unclassifiedStarted = executionEnvelopeRepo
      .listUnclassifiedStartedForNode(LOCAL_DAEMON_NODE_ID);
    // Legacy rows cannot prove whether the old executor was an in-process
    // daemon or a tmux pane. Fail closed even when tmux is disabled now: the
    // flag may have changed across the restart while the old pane survived.
    if (unclassifiedStarted.length > 0) {
      tmuxRecoveryReady = false;
      throw new Error(
        `startup recovery blocked by ${unclassifiedStarted.length} legacy started execution(s) without ownership metadata`,
      );
    }
    const persistedTmuxRecoveryRequired = executionEnvelopeRepo
      .listRecoverableTmux(LOCAL_DAEMON_NODE_ID).length > 0;
    if (!tmuxEnabled && !persistedTmuxRecoveryRequired) {
      tmuxRecoveryReady = true;
      return undefined;
    }
    if (!tmuxGateway || !agentPaneRegistry) {
      try {
        tmuxGateway = new TmuxGateway();
        agentPaneRegistry = new AgentPaneRegistry();
        console.log('[daemon] tmux integration recovered for startup reconciliation');
      } catch (error) {
        const stranded = executionEnvelopeRepo.listRecoverableTmux(LOCAL_DAEMON_NODE_ID);
        if (stranded.length > 0) {
          tmuxRecoveryReady = false;
          throw new Error(
            `tmux unavailable with ${stranded.length} recoverable execution(s): ${(error as Error).message}`,
          );
        }
        tmuxRecoveryReady = true;
        return undefined;
      }
    }
    if (!tmuxGateway || !agentPaneRegistry) {
      tmuxRecoveryReady = true;
      return undefined;
    }
    restartedTmuxTracker ??= new RestartedTmuxRecoveryTracker(() => {
      const staleEnvelopes = executionEnvelopeRepo.listRecoverableTmux(LOCAL_DAEMON_NODE_ID);
      const parsedExecutions = staleEnvelopes.map((envelope) => (
        parseRestartedTmuxExecution(envelope, LOCAL_DAEMON_NODE_ID)
      ));
      if (parsedExecutions.some((execution) => !execution)) {
        throw new Error('started tmux envelope is missing a recoverable executor reference');
      }
      return parsedExecutions as RestartedTmuxExecution[];
    });
    if (daemonStartupReconcileObserved) restartedTmuxTracker.observeStartup();
    return restartedTmuxTracker;
  };
  const reconcileRestartedTmux = async (reason: 'startup' | 'periodic') => {
    if (reason === 'startup') daemonStartupReconcileObserved = true;
    if (!daemonStartupReconcileObserved) return;
    const recover = async () => {
      const tracker = ensureRestartedTmuxTracker();
      if (!tracker || !tmuxGateway || !agentPaneRegistry) return;
      await tracker.reconcile(reason, (executions) => (
        recoverRestartedTmuxExecutions({
          executions,
          gateway: tmuxGateway!,
          registry: agentPaneRegistry!,
          expire: (envelopeId) => {
            const expired = executionEnvelopeRepo.recoverTmuxAfterRestart(envelopeId, 'process_restarted');
            if (!expired) return false;
            proofLogRepo.append({
              eventType: 'dispatch.expired',
              conversationId: expired.conversation_id,
              taskId: expired.task_id ?? undefined,
              chainId: expired.chain_id ?? undefined,
              passId: expired.pass_id ?? undefined,
              envelopeId: expired.id,
              nodeId: expired.to_node_id,
              agentId: expired.to_agent_id,
              actorId: expired.from_agent_id ?? expired.from_node_id,
              reasonCode: 'process_restarted',
            });
            return true;
          },
        })
      ));
      tmuxRecoveryReady = tracker.isReady();
    };
    restartedTmuxRecovery = restartedTmuxRecovery.then(recover, recover);
    await restartedTmuxRecovery;
  };
  ensureAutonomousDeliveryRuntime(io, `daemon:${LOCAL_DAEMON_NODE_ID}`, {
    beforeReconcile: reconcileRestartedTmux,
    afterEnvelopeRecovery: () => {
      if (!daemonStartupReconcileObserved) return;
      if (!tmuxRecoveryReady) return;
      resolveDispatchStartupReady?.();
      resolveDispatchStartupReady = undefined;
    },
  });

  // Read agents from DB for A2A mention patterns
  const db = getDb();
  const dbAgents = db.prepare('SELECT id, name FROM agents').all() as { id: string; name: string }[];
  const a2aMessenger = new AgentMessenger(db, io,
    dbAgents.map(a => ({
      id: a.id,
      mentionPatterns: [`@${a.id}`, `@${a.name}`],
    })),
    createRuntimeSnapshotProvider(),
    (input) => {
      const submission = harnessCoordinator.submit({
        id: `a2a:${input.entryId}`,
        source: 'a2a',
        conversationId: input.conversationId,
        taskId: input.referencedTaskId,
        agentId: input.agentId,
        prompt: input.prompt,
        fromAgentId: input.fromAgentId,
        chainId: input.chainId,
        passId: input.passId,
        idempotencyKey: `a2a:${input.chainId}:${input.entryId}:${input.agentId}`,
      });
      return { handled: submission.handled, completion: submission.completion };
    },
  );

  // Expire stale A2A chains on startup
  const expired = a2aMessenger.expireStale();
  if (expired > 0) {
    console.log(`[a2a] expired ${expired} stale chains`);
  }

  // Agent pane listing endpoint
  io.on('connection', (socket: Socket) => {
    let connectedRuntimeNodeId: string | undefined;
    const joinedConversationIds = new Set<string>();

    socket.on('conversation:join', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) return;
      socket.join(conversationId);
      joinedConversationIds.add(conversationId);
      a2aMessenger.orchestrator.resendPendingDeliveries(conversationId);
    });

    socket.on('conversation:leave', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) return;
      socket.leave(conversationId);
      joinedConversationIds.delete(conversationId);
    });

    socket.on('runtime:hello', (payload: {
      nodeId?: string;
      kind?: RuntimeNodeKind;
      label?: string;
      endpoint?: string;
      capabilities?: string[];
    }) => {
      if (!payload?.nodeId) return;
      connectedRuntimeNodeId = payload.nodeId;
      dispatchGateway.ensureRuntimeNode({
        id: payload.nodeId,
        kind: payload.kind ?? 'browser',
        label: payload.label ?? payload.nodeId,
        endpoint: payload.endpoint,
        capabilities: payload.capabilities ?? ['socket-transport'],
        trustLevel: payload.kind === 'browser' ? 'paired' : 'local',
      });
      dispatchGateway.heartbeat(payload.nodeId);
      socket.emit('runtime:registered', { nodeId: payload.nodeId });
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

    socket.on('agent-panes:list', (callback) => {
      if (!agentPaneRegistry) {
        callback?.({ panes: [] });
        return;
      }
      callback?.({ panes: agentPaneRegistry.listAll() });
    });

    socket.on('a2a:user-message', (payload: {
      conversationId?: string;
      messageId?: string;
      targetAgentIds?: string[];
      prompt?: string;
      taskId?: string;
    }) => {
      const conversationId = payload?.conversationId;
      const messageId = payload?.messageId;
      if (!conversationId || !messageId) return;

      if (payload.targetAgentIds?.length) {
        // Direct user-to-agent dispatch remains client-driven; register it as
        // executing so the agent's later @mentions continue in the same chain.
        a2aMessenger.registerExternalUserDispatch(
          conversationId,
          messageId,
          payload.targetAgentIds,
          payload.prompt ?? '',
          payload.taskId,
        );
      } else {
        a2aMessenger.abortConversationChains(conversationId, 'new_user_message_without_a2a_target');
      }
    });

    socket.on('a2a:user-turn-created', (payload: {
      conversationId?: string;
      messageId?: string;
      targetAgentIds?: string[];
      prompt?: string;
      taskId?: string;
    }) => {
      const conversationId = payload?.conversationId;
      const messageId = payload?.messageId;
      if (!conversationId || !messageId) return;

      if (payload.targetAgentIds?.length) {
        a2aMessenger.registerExternalUserDispatch(
          conversationId,
          messageId,
          payload.targetAgentIds,
          payload.prompt ?? '',
          payload.taskId,
        );
      } else {
        a2aMessenger.abortConversationChains(conversationId, 'new_user_turn_without_pass');
      }
    });

    socket.on('a2a:agent-started', (payload: {
      chainId?: string;
      entryId?: string;
      conversationId?: string;
      agentId?: string;
      passId?: string;
    }) => {
      if (!payload.chainId || !payload.entryId || !payload.conversationId || !payload.agentId) return;
      a2aMessenger.orchestrator.markDispatchStarted(
        payload.chainId,
        payload.entryId,
        payload.conversationId,
        payload.agentId,
        payload.passId,
      );
    });

    socket.on('a2a:dispatch-failed', (payload: {
      chainId?: string;
      entryId?: string;
      conversationId?: string;
      agentId?: string;
      reason?: string;
    }) => {
      if (!payload.chainId || !payload.entryId || !payload.conversationId || !payload.agentId) return;
      a2aMessenger.orchestrator.markDispatchFailed(
        payload.chainId,
        payload.entryId,
        payload.conversationId,
        payload.agentId,
        payload.reason ?? 'client dispatch failed',
      );
    });

    socket.on('a2a:dispatch-deferred', (payload: {
      chainId?: string;
      entryId?: string;
      conversationId?: string;
      agentId?: string;
      passId?: string;
      reason?: string;
    }) => {
      if (!payload.chainId || !payload.entryId || !payload.conversationId || !payload.agentId) return;
      a2aMessenger.orchestrator.markDispatchDeferred(
        payload.chainId,
        payload.entryId,
        payload.conversationId,
        payload.agentId,
        payload.reason ?? 'target agent is busy',
        payload.passId,
      );
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

  handleTerminalStart = async ({
        projectId,
        taskId,
        deliveryRunId,
        agentId,
        prompt: incomingPrompt,
        systemPrompt,
        conversationId,
        sourceNodeId,
        dispatchSource,
        dispatchIntent,
        fromAgentId,
        chainId,
        passId,
        opencodeBridgeUrl,
        engine: rawEngine,
        runtimeId,
        providerProfileId,
        channel,
        authContextId,
        accountId,
        force,
        projectSlug,
        projectPath,
        useWorktree,
        contextScenario,
        teamLogUpToEntryId,
        traceId: requestedTraceId,
        contextReport,
        contextSnapshot,
        evaluation,
      }: TerminalStartPayload, emitToRequester = broadcast) => {
      await dispatchStartupReady;
      const startKey = processKey(agentId, projectId || conversationId);
      const activeKey = processKey(agentId, projectId);
      if (!processStartGuard.claim(startKey, activeProcesses.has(activeKey), Boolean(force))) {
        emitToRequester('agent:error', {
          agentId,
          message: 'Agent is already starting or running',
          reasonCode: 'agent_busy',
        });
        emitToRequester('terminal:exit', { agentId, code: 1, command: 'dispatch', reasonCode: 'agent_busy' });
        return;
      }
      console.log(`[daemon] terminal:start agent=${agentId}, engine=${rawEngine}, accountId=${accountId ?? '(none)'}, force=${force}, busy=${activeProcesses.has(processKey(agentId, projectId))}`);
      console.log(`[daemon] systemPrompt=${systemPrompt ? `${systemPrompt.length} chars` : '(none)'}, prompt=${incomingPrompt ? `${incomingPrompt.length} chars` : '(none)'}`);
      let primaryCommand = 'unknown';
      let runtimeConfigDir: string | undefined;
      let controlEnvelopeId: string | undefined;
      let trackedInvocationId: string | undefined;
      let invocationTraceId = requestedTraceId;
      let rootObservationSpanId: string | undefined;
      let messageObservationSpanId: string | undefined;
      let completionObservationBuffer = '';
      let evaluationObservedDigest: string | undefined;
      let thinkingObservationBuffer = '';
      let runtimeContextObservationRecorded = false;
      const captureThinking = isThinkingCaptureEnabled();
      const openToolSpans = new Map<string, string[]>();
      let finishObservation: (status: 'ok' | 'error' | 'cancelled', errorMessage?: string) => void = () => {};
      // ACP per-runtime cleanup (e.g. codex temp CODEX_HOME). Declared here so
      // the outer catch (terminal:start error) can clean up if setup succeeds
      // but a later step throws before the execute IIFE takes over.
      let acpCleanup: (() => void) | undefined;
      let revokeAcpTools: (() => void) | undefined;
      let ownedActiveProcess: ActiveProcess | undefined;
      const registerActiveProcess = (active: ActiveProcess) => {
        ownedActiveProcess = active;
        activeProcesses.set(activeKey, active);
      };
      const deleteOwnedActiveProcess = (active = ownedActiveProcess) => (
        active ? deleteIfCurrent(activeProcesses, activeKey, active) : false
      );
      try {
      if (!conversationId && !projectId) {
        throw new Error('session_scope_missing: terminal:start requires conversationId or projectId');
      }
      const sessionConvId = conversationId || projectId!;
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
        phase: 'requested' | 'sent' | 'started' | 'completed' | 'blocked' | 'failed',
        reasonCode?: string,
      ) => {
        if (!controlEnvelopeId) return;
        io.to(sessionConvId).emit('dispatch.receipt', {
          receiptId: `${controlEnvelopeId}:${phase}`,
          conversationId: sessionConvId,
          taskId,
          targetAgentId: agentId,
          source: dispatchSource ?? 'user',
          phase,
          chainId,
          passId,
          reasonCode,
          createdAt: new Date().toISOString(),
        });
      };
      const markEnvelopeStarted = (): boolean => {
        if (!controlEnvelopeId) return true;
        const started = dispatchGateway.markStarted(controlEnvelopeId);
        if (!started) {
          invocationRepo.updateStatus(invocation.id, 'failed', {
            reason_code: 'dispatch_expired',
            error_message: 'Dispatch expired before runtime start',
          });
          emitDispatchReceipt('failed', 'dispatch_expired');
          throw new DispatchExpiredBeforeStartError();
        }
        emitDispatchReceipt('started');
        return true;
      };
      const markEnvelopeCompleted = () => {
        if (!controlEnvelopeId) {
          finishObservation('ok');
          return true;
        }
        if (!dispatchGateway.markCompleted(controlEnvelopeId)) return false;
        finishObservation('ok');
        emitDispatchReceipt('completed');
        return true;
      };
      const markEnvelopeFailed = (reasonCode: string) => {
        if (!controlEnvelopeId) {
          finishObservation(reasonCode === 'cancelled' ? 'cancelled' : 'error', reasonCode);
          return true;
        }
        if (!dispatchGateway.markFailed(
          controlEnvelopeId,
          reasonCode,
          'idle',
          trackedInvocationId ? {
            id: trackedInvocationId,
            errorMessage: `execution terminated: ${reasonCode}`,
          } : undefined,
        )) return false;
        finishObservation(reasonCode === 'cancelled' ? 'cancelled' : 'error', reasonCode);
        emitDispatchReceipt('failed', reasonCode);
        return true;
      };

      const engineFromRuntime =
        runtimeId && runtimeId in RUNTIME_ENGINE_MAP ? RUNTIME_ENGINE_MAP[runtimeId] : undefined;
      const engine: CliEngine =
        engineFromRuntime || (rawEngine && rawEngine in ENGINE_COMMAND ? rawEngine : 'opencode');
      primaryCommand = ENGINE_COMMAND[engine];

      const targetNodeId = opencodeBridgeUrl
        ? `bridge:${String(opencodeBridgeUrl).trim().replace(/\/+$/, '')}`
        : LOCAL_DAEMON_NODE_ID;
      const useTmuxTransport = Boolean(
        tmuxEnabled && tmuxGateway && agentPaneRegistry && !opencodeBridgeUrl,
      );
      const executorKind = opencodeBridgeUrl
        ? 'bridge_proxy'
        : useTmuxTransport
          ? 'tmux_pane'
          : 'daemon_process';
      if (opencodeBridgeUrl) {
        dispatchGateway.ensureRuntimeNode({
          id: targetNodeId,
          kind: 'bridge',
          label: 'OpenCode bridge',
          endpoint: String(opencodeBridgeUrl).trim().replace(/\/+$/, ''),
          capabilities: ['execute', 'bridge-run'],
          trustLevel: 'paired',
        });
      }

      const envelope = dispatchGateway.requestDispatch({
        source: dispatchSource ?? 'user',
        intent: dispatchIntent ?? 'answer',
        conversationId: sessionConvId,
        taskId,
        chainId,
        passId,
        fromNodeId: sourceNodeId ?? 'browser:unknown',
        fromAgentId,
        toNodeId: targetNodeId,
        toAgentId: agentId,
        runtimeId: runtimeId ?? engine,
        payload: {
          prompt: prompt || '',
          executorKind,
          executorOwnerNodeId: LOCAL_DAEMON_NODE_ID,
          contextRefs: [
            ...(taskId ? [`task:${taskId}`] : []),
            ...(chainId ? [`chain:${chainId}`] : []),
            ...(passId ? [`pass:${passId}`] : []),
          ],
        },
      });
      controlEnvelopeId = envelope.id;
      emitDispatchReceipt('requested', envelope.reason_code ?? undefined);

      if (envelope.status === 'blocked') {
        emitDispatchReceipt('blocked', envelope.reason_code ?? 'runtime_blocked');
        emitToRequester('agent:error', {
          agentId,
          message: `目标运行实例不可达：${envelope.reason_code ?? 'blocked'}`,
          reasonCode: envelope.reason_code ?? 'runtime_blocked',
        });
        return;
      }

      // Only kill existing process on explicit force send
      if (force) {
        const forced = activeProcesses.get(activeKey);
        if (forced) {
          await forced.kill();
          await forced.onTerminated?.('force_killed');
          deleteIfCurrent(activeProcesses, activeKey, forced);
        }
      }
      // If agent is busy and not forcing, reject silently — client should have queued
      if (!force && activeProcesses.has(processKey(agentId, projectId))) {
        markEnvelopeFailed('agent_busy');
        emitToRequester('agent:error', {
          agentId,
          message: 'Agent is busy, message queued',
          reasonCode: 'agent_busy',
        });
        return;
      }
      const sentEnvelope = dispatchGateway.markSent(controlEnvelopeId);
      if (!sentEnvelope) {
        emitDispatchReceipt('failed', 'dispatch_expired');
        throw new DispatchExpiredBeforeStartError();
      }
      emitDispatchReceipt('sent');

      const credentialEnv = await resolveCredentialEnv(accountId);

      // --- Session & Invocation tracking (SQLite) ---
      // Use conversationId for session scoping (project-level session per agent)
      const sessionIsolationKey = evaluation ? `evaluation:${evaluation.executionId}` : '';
      let existingSession = sessionRepo.findActiveByConversation(agentId, sessionConvId, sessionIsolationKey);

      if (existingSession && sessionRepo.sealIfLatestInvocationLoadFailed(existingSession.id)) {
        console.warn(
          `[daemon] rotating session ${existingSession.id} for ${agentId} in ${sessionConvId} after persisted ACP load failure`,
        );
        existingSession = undefined;
      }

      if (!existingSession) {
        const nextSeq = sessionRepo.nextSeqForAgent(agentId, taskId || '');
        existingSession = sessionRepo.getOrCreateActive({
          id: generateSortableId('ses'),
          conversationId: sessionConvId,
          agentId,
          taskId: taskId || undefined,
          seq: nextSeq,
          isolationKey: sessionIsolationKey,
        });
      }
      if (
        !opencodeBridgeUrl
        && !tmuxGateway
        && existingSession.cli_session_id
        && sessionRepo.releaseUnconfirmedRuntimeSessionId(
          existingSession.id,
          existingSession.cli_session_id,
        )
      ) {
        console.warn(
          `[daemon] released unconfirmed runtime session for ${agentId} in ${sessionConvId}`,
        );
        existingSession = sessionRepo.getById(existingSession.id)!;
      }
      const agentSession: AgentSessionRow = existingSession;

      const invocation: InvocationRow = invocationRepo.create({
        id: generateSortableId('inv'),
        conversation_id: sessionConvId,
        task_id: taskId || '',
        agent_id: agentId,
        session_id: agentSession.id,
        engine,
        account_id: accountId,
        prompt: prompt || '',
      });
      trackedInvocationId = invocation.id;
      const tmuxWorktreeId = projectId || 'default';
      const tmuxServerId = useTmuxTransport
        ? `${tmuxWorktreeId}--${controlEnvelopeId}`
        : undefined;
      const boundExecutor = dispatchGateway.bindExecutor(controlEnvelopeId, {
        invocationId: invocation.id,
        scopeId: projectId || sessionConvId,
        ...(tmuxServerId ? { worktreeId: tmuxWorktreeId, tmuxServerId } : {}),
      });
      if (!boundExecutor) markEnvelopeStarted();

      const ensureMessageObservationSpan = () => {
        if (messageObservationSpanId || !invocationTraceId || !rootObservationSpanId) return messageObservationSpanId;
        try {
          messageObservationSpanId = observationSpanRepo.start({
            traceId: invocationTraceId,
            parentSpanId: rootObservationSpanId,
            name: 'agent.message',
            kind: 'message',
            conversationId: sessionConvId,
            taskId,
            agentId,
            invocationId: invocation.id,
            envelopeId: controlEnvelopeId,
            chainId,
            passId,
            attributes: {
              'ath.schema.version': 1,
              'gen_ai.operation.name': 'chat',
              'gen_ai.output.type': 'text',
            },
          }).span_id;
        } catch (error) {
          console.warn('[observability] failed to start message span:', error);
        }
        return messageObservationSpanId;
      };

      const capturePromptObservation = (assembledPrompt: string, effectiveSystemPrompt?: string) => {
        if (!rootObservationSpanId) return;
        try {
          capturePromptPayloads({
            spanId: rootObservationSpanId,
            assembledPrompt,
            systemPrompt: effectiveSystemPrompt,
            onCaptured: () => broadcast('observability:updated', { conversationId: sessionConvId, invocationId: invocation.id }),
          });
        } catch (error) {
          console.warn('[observability] failed to capture prompt payload:', error);
        }
      };

      const recordRuntimeContextObservation = (input: {
        transport: 'bridge' | 'tmux' | 'acp';
        systemPromptChannel: 'none' | 'bridge' | 'instructions' | 'backend' | 'inline';
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

      const finishMessageObservation = (
        status: 'ok' | 'error' | 'cancelled',
        fallbackOutput?: string,
        usage?: Record<string, unknown>,
        errorMessage?: string,
      ) => {
        const completion = completionObservationBuffer || fallbackOutput || '';
        if (!completion && !thinkingObservationBuffer) return;
        const spanId = ensureMessageObservationSpan();
        if (!spanId) return;
        try {
          if (completion) spanPayloadRepo.put(spanId, 'completion', completion);
          if (captureThinking && thinkingObservationBuffer) {
            spanPayloadRepo.put(spanId, 'thinking', thinkingObservationBuffer);
          }
          observationSpanRepo.finish(spanId, status, {
            outputPreview: completion,
            errorMessage,
            attributes: usage ? { 'gen_ai.usage': usage } : undefined,
          });
          broadcast('observability:updated', { conversationId: sessionConvId, invocationId: invocation.id });
        } catch (error) {
          console.warn('[observability] failed to finish message span:', error);
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
            'ath.runtime.id': runtimeId ?? engine,
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
          if (status === 'ok') {
            try {
              observationSpanRepo.finishOpenToolsByInvocation(
                invocation.id,
                'acp_tool_terminal_missing',
              );
            } catch (error) {
              console.warn(`[observability] failed to close incomplete tools for ${invocation.id}:`, error);
            }
          }
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
      const effectiveSessionId = agentSession.cli_session_id ?? undefined;

      // Build CLI args for non-Backend paths (tmux, bridge)
      const primaryArgs = (() => {
        switch (engine) {
          case 'opencode': {
            return buildOpenCodeRunArgs({
              prompt: prompt || '',
              sessionId: effectiveSessionId,
            });
          }
          case 'claude': {
            const a = ['-p', prompt || '', '--output-format', 'stream-json'];
            if (systemPrompt) a.push('--append-system-prompt', systemPrompt);
            if (effectiveSessionId) a.push('--resume', effectiveSessionId);
            return a;
          }
          case 'codex': {
            const merged = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt || ''}` : (prompt || '');
            return ['-q', merged, '--full-auto'];
          }
          case 'gemini': {
            const merged = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt || ''}` : (prompt || '');
            return ['-p', merged];
          }
          case 'mock': return [join(/*turbopackIgnore: true*/ process.cwd(), 'backend', 'mock-opencode.js')];
          default: return [];
        }
      })();

      runtimeConfigDir = undefined;
      let runtimeConfigEnv: Record<string, string> = {};

      if (engine === 'opencode') {
        // Offline evaluation must use only the frozen Harness context. Loading
        // project-local Skills or authorizing the live shared workspace would
        // leak mutable production state into the isolated worktree.
        const projectSkillPaths = evaluation ? [] : resolveOpenCodeProjectSkillPaths(projectPath);
        const account = accountId ? await readAccount(accountId) : undefined;
        const cred = accountId ? await readCredential(accountId) : undefined;
        const invocationId = makeInvocationId(agentId);
        const result = generateRuntimeConfig(invocationId, {
          provider: account?.provider as RuntimeAccountProvider | undefined,
          apiKey: cred?.apiKey,
          baseUrl: account?.baseUrl,
          models: account?.models,
          defaultModel: account?.models?.[0],
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

      const mergedEnv: Record<string, string> = { ...process.env, ...credentialEnv, ...runtimeConfigEnv } as Record<string, string>;

      let sessionAnnounced = false;
      let invocationSessionRecorded = false;
      let observedRuntimeSessionId: string | undefined;
      let hasBackgroundChildActivity = false;
      const allowsProductionEffects = allowsProductionCollaborationEffects(evaluation);
      const persistedText = new StreamTextPersistence(evaluationSafeTextSink(evaluation, {
        create(content) {
            const id = messageRepo.append({
            conversationId: sessionConvId,
            taskId,
            senderType: 'agent',
            senderId: agentId,
            content,
              contentType: 'text',
              invocationId: invocation.id,
              metadata: { invocationId: invocation.id },
          });
          sessionRepo.incrementMessageCount(agentSession.id);
          return id;
        },
        append: (messageId, content) => messageRepo.appendTextChunk(messageId, content),
      }));

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
          void (async () => {
            const active = ownedActiveProcess;
            if (!active || activeProcesses.get(activeKey) !== active) return;
            try {
              await active.kill();
              await active.onTerminated?.('timeout');
              deleteOwnedActiveProcess(active);
              if (!active.onTerminated) markEnvelopeFailed('timeout');
              broadcast('agent:error', {
                agentId,
                conversationId: sessionConvId,
                message: `CLI 响应超时 (${Math.round(timeoutMs / 1000)}s)，已自动终止。`,
                reasonCode: 'timeout' as const,
              });
            } catch (error) {
              console.error('[daemon] timeout could not confirm process termination:', error);
            }
          })();
        }, timeoutMs);
        if (timeoutTimer) timeoutTimer.unref();
      };

      const clearProcessTimeout = () => {
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      };

      let a2aCompletionHandled = false;
      const completeAgentA2A = (finalContent?: string) => {
        if (a2aCompletionHandled) return;
        a2aCompletionHandled = true;

        // This buffer belongs to this invocation. A process-level map keyed by
        // agent/session lets a replaced invocation consume or erase the new
        // invocation's response while its async completion is still unwinding.
        const accumulated = completionObservationBuffer || finalContent;
        // Held-out output must never drive the production collaboration loop.
        // Evaluation completion is reconciled through eval_case_execution after
        // the invocation finishes; it must not materialize TeamLog entries,
        // consume production cursors, scan @mentions, or advance A2A chains.
        if (!allowsProductionEffects) return;
        try {
          // Watchers are best-effort on every platform. The completed-turn
          // boundary is the consistency barrier before handoff scanning.
          syncTasksToDb(taskProjectDir, sessionConvId, io);
        } catch (error) {
          console.warn(`[task-sync] completion barrier failed for ${sessionConvId}:`, error);
        }
        let validExit = true;
        if (contextScenario) {
          const exit = checkValidExit(contextScenario, accumulated);
          validExit = exit.valid;
          if (!exit.valid) {
            proofLogRepo.append({
              eventType: 'no_valid_exit',
              conversationId: sessionConvId,
              taskId,
              chainId,
              passId,
              agentId,
              reasonCode: exit.reason,
              metadata: {
                scenario: contextScenario,
                outcomeSummary: accumulated?.slice(0, 200) ?? '',
              },
            });
          }
        }
        if (contextScenario === 'closure' && validExit && sessionConvId && taskId) {
          try {
            const closureProof = proofLogRepo.findByType({
              eventType: 'chain_closure_dispatched',
              conversationId: sessionConvId,
              taskId,
            }).at(-1);
            const evaluationTriggerId = closureProof?.id ?? `closure:${sessionConvId}:${taskId}:${chainId ?? 'no-chain'}`;
            const sampling = agentEvaluation.shouldEvaluateClosure(sessionConvId, evaluationTriggerId);
            if (!sampling.allowed) {
              proofLogRepo.append({
                eventType: 'eval.skipped',
                conversationId: sessionConvId,
                taskId,
                chainId,
                reasonCode: sampling.reason,
                metadata: { triggerId: evaluationTriggerId },
              });
            } else {
              const submitted = agentEvaluation.submit({
                conversationId: sessionConvId,
                triggerId: evaluationTriggerId,
                rootTaskId: taskId,
                chainId,
                evidenceCutoffAt: new Date().toISOString(),
                mode: 'online',
              });
              io.to(sessionConvId).emit('evaluation:queued', {
                conversationId: sessionConvId,
                runId: submitted.runId,
              });
            }
          } catch (error) {
            console.warn(`[evaluation] closure submit failed for ${sessionConvId}/${taskId}:`, error);
          }
        }
        if (effectiveTeamLogUpToEntryId) {
          teamLogProjection.markConsumed(sessionConvId, agentId, effectiveTeamLogUpToEntryId);
        }
        try {
          teamLogProjection.materializeRegistered(sessionConvId);
        } catch (error) {
          console.warn(`[team-log] materialize after completion failed for ${sessionConvId}:`, error);
        }
        if (accumulated && sessionConvId) {
          a2aMessenger.onAgentResponse(agentId, accumulated, {
            conversationId: sessionConvId,
            taskId,
            triggerMessageId: undefined,
            chainDepth: 0,
            epochId: undefined,
          }).catch(err => console.error('[a2a] onAgentResponse error:', err));
        }
        if (sessionConvId) {
          a2aMessenger.orchestrator.onAgentDone(agentId, sessionConvId);
        }
      };

      // --- Heartbeat: keep client watchdog alive while process is running ---
      const HEARTBEAT_INTERVAL_MS = 30_000;
      const heartbeatTimer = setInterval(() => {
        if (activeProcesses.has(processKey(agentId, projectId))) {
          broadcast('agent:event', {
            agentId,
            sessionId: agentSession?.cli_session_id,
            event: { type: 'heartbeat' },
          });
        } else {
          clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref();

      // Start initial timeout
      if (timeoutMs > 0) resetTimeout();

      // --- Bridge NDJSON line parser (OpenCode format) ---
      const parseAndForwardBridgeLine = (line: string): boolean => {
        const trimmed = line.replace(STRIP_ANSI_RE, '').trim();
        if (!trimmed) return false;
        let parsed: unknown;
        try { parsed = JSON.parse(trimmed); } catch { return false; }
        if (!parsed || typeof parsed !== 'object') return false;
        const obj = parsed as Record<string, unknown>;
        const part = (obj.part && typeof obj.part === 'object') ? (obj.part as Record<string, unknown>) : undefined;
        const type = typeof obj.type === 'string' ? obj.type : undefined;

        const sessionId =
          (typeof obj.sessionID === 'string' ? obj.sessionID : undefined) ||
          (typeof obj.sessionId === 'string' ? obj.sessionId : undefined) ||
          (typeof obj.session_id === 'string' ? obj.session_id : undefined) ||
          (typeof part?.sessionID === 'string' ? part.sessionID : undefined) ||
          (typeof part?.sessionId === 'string' ? part.sessionId : undefined);

        // Persist raw event
        eventRepo.append({
          conversationId: sessionConvId,
          taskId,
          agentId,
          type: type || 'unknown',
          payload: obj,
        });

        if (type === 'text' || type === 'message' || type === 'assistant') {
          const text = (typeof part?.text === 'string' ? part.text : undefined) || (typeof obj.content === 'string' ? obj.content : undefined);
          if (text) forwardAgentEvent({ type: 'text', content: text, sessionId });
          return !!text;
        } else if (type === 'tool_use') {
          const toolName = typeof part?.tool === 'string' ? part.tool : undefined;
          if (toolName) forwardAgentEvent({ type: 'tool_use', content: '', tool: { name: toolName, input: typeof part?.input === 'object' ? JSON.stringify(part.input) : undefined }, sessionId });
          return !!toolName;
        } else if (type === 'error') {
          const errorObj = (obj.error && typeof obj.error === 'object') ? (obj.error as Record<string, unknown>) : undefined;
          const errorName = typeof errorObj?.name === 'string' ? errorObj.name : '未知错误';
          forwardAgentEvent({ type: 'error', content: errorName, sessionId });
          return true;
        } else if (type === 'done' || type === 'result') {
          const resultText = typeof obj.result === 'string'
            ? obj.result
            : (typeof obj.content === 'string' ? obj.content : '');
          forwardAgentEvent({ type: 'done', content: resultText, sessionId });
          return true;
        }
        return false;
      };

      function isBackgroundChildTool(name: string): boolean {
        const normalized = name.trim().toLowerCase();
        return normalized === 'agent' || normalized === 'task';
      }

      function broadcastAgentActivity(status: AgentActivityStatus, reason?: string): void {
        broadcast('agent:activity', {
          conversationId: sessionConvId,
          taskId,
          agentId,
          sessionId: eventSessionId(),
          status,
          reason,
        });
      }

      function eventSessionId(): string | undefined {
        return effectiveSessionId;
      }

      function announceConfirmedSession(runtimeSessionId: string): void {
        if (sessionAnnounced) return;
        sessionAnnounced = true;
        broadcast('agent:session', {
          projectId: sessionConvId,
          conversationId: sessionConvId,
          agentId,
          sessionId: runtimeSessionId,
        });
        if (taskId && projectId) {
          workdirManager.writeSessionMeta(agentId, projectId, taskId, {
            sessionId: runtimeSessionId,
            updatedAt: '',
          });
        }
      }

      // --- Shared agent event forwarder ---
      const forwardAgentEvent = (event: AgentEvent) => {
        try {
        // Text updates are stream deltas. A non-text event closes the current
        // persisted segment while socket delivery remains fully incremental.
        if (event.type !== 'text') persistedText.closeSegment();

        // Observe runtime identity during the turn, but do not persist a new
        // binding until the Invocation completes successfully. Some adapters
        // only make a new Session loadable after the first prompt commits.
        if (event.sessionId) {
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
          if (!invocationSessionRecorded) {
            invocationSessionRecorded = true;
            invocationRepo.updateStatus(invocation.id, 'running', { cli_session_id: event.sessionId });
          }
          if (effectiveSessionId) announceConfirmedSession(event.sessionId);
        }

        if (event.type === 'tool_use' && event.tool?.name && isBackgroundChildTool(event.tool.name)) {
          hasBackgroundChildActivity = true;
          broadcastAgentActivity('awaiting_children', `tool:${event.tool.name}`);
        }

        if (event.type === 'tool_use' && event.tool?.name && invocationTraceId && rootObservationSpanId) {
          try {
            const toolSpan = observationSpanRepo.start({
              traceId: invocationTraceId,
              parentSpanId: rootObservationSpanId,
              name: 'tool.execute',
              kind: 'tool',
              conversationId: sessionConvId,
              taskId,
              agentId,
              invocationId: invocation.id,
              envelopeId: controlEnvelopeId,
              chainId,
              passId,
              inputPreview: event.tool.input,
              attributes: {
                'ath.schema.version': 1,
                'gen_ai.operation.name': 'execute_tool',
                'gen_ai.tool.name': event.tool.name,
                'gen_ai.tool.call.id': event.tool.callId,
                'ath.tool.native': !isSkillTool(event.tool.name),
                'ath.tool.platform': isSkillTool(event.tool.name),
              },
            });
            if (event.tool.input !== undefined) {
              spanPayloadRepo.put(toolSpan.span_id, 'tool_input', event.tool.input);
            }
            broadcast('observability:updated', { conversationId: sessionConvId, invocationId: invocation.id });
            const key = event.tool.callId || event.tool.name;
            openToolSpans.set(key, [...(openToolSpans.get(key) ?? []), toolSpan.span_id]);
          } catch (error) {
            console.warn(`[observability] failed to start tool span:`, error);
          }
        } else if (event.type === 'tool_result' && event.tool) {
          try {
            const key = event.tool.callId || event.tool.name || '';
            const pending = openToolSpans.get(key) ?? [];
            const spanId = pending.shift();
            if (pending.length) openToolSpans.set(key, pending); else openToolSpans.delete(key);
            if (spanId) {
              if (event.tool.input !== undefined) {
                spanPayloadRepo.put(spanId, 'tool_input', event.tool.input);
              }
              spanPayloadRepo.put(spanId, 'tool_output', event.content);
              const failed = event.tool.status === 'failed';
              observationSpanRepo.finish(spanId, failed ? 'error' : 'ok', {
                outputPreview: event.content,
                ...(failed && { errorMessage: event.content || 'ACP tool call failed' }),
                attributes: { 'gen_ai.tool.status': event.tool.status ?? 'completed' },
              });
              broadcast('observability:updated', { conversationId: sessionConvId, invocationId: invocation.id });
            }
          } catch (error) {
            console.warn(`[observability] failed to finish tool span:`, error);
          }
        } else if (event.type === 'plan' && invocationTraceId && rootObservationSpanId) {
          try {
            const planSpan = observationSpanRepo.start({
              traceId: invocationTraceId,
              parentSpanId: rootObservationSpanId,
              name: 'agent.plan',
              kind: 'workflow',
              conversationId: sessionConvId,
              taskId,
              agentId,
              invocationId: invocation.id,
              envelopeId: controlEnvelopeId,
              chainId,
              passId,
              inputPreview: event.content,
              attributes: { 'ath.schema.version': 1, 'gen_ai.operation.name': 'plan' },
            });
            observationSpanRepo.finish(planSpan.span_id, 'ok');
            broadcast('observability:updated', { conversationId: sessionConvId, invocationId: invocation.id });
          } catch (error) {
            console.warn('[observability] failed to capture plan span:', error);
          }
        }

        // Forward to client
        broadcast('agent:event', {
          taskId,
          agentId,
          type: event.type,
          content: event.content,
          tool: event.tool,
          usage: event.usage,
          invocationId: invocation.id,
          sessionId: effectiveSessionId ? event.sessionId : undefined,
          conversationId: sessionConvId,
        });

        // Buffer agent text for A2A scanning
        if (event.type === 'text' && typeof event.content === 'string') {
          ensureMessageObservationSpan();
          completionObservationBuffer += event.content;
        } else if (event.type === 'thinking' && captureThinking && typeof event.content === 'string') {
          ensureMessageObservationSpan();
          thinkingObservationBuffer += event.content;
        }

        // Persist to message repo
        if (event.type === 'text' && event.content) {
          try {
          persistedText.appendChunk(event.content);
          } catch (dbErr) {
            console.error(`[daemon] Failed to persist text message for ${agentId}:`, dbErr);
          }
        } else if (allowsProductionEffects && event.type === 'tool_use' && event.tool) {
          try {
          messageRepo.append({
            conversationId: sessionConvId,
            taskId,
            senderType: 'agent',
            senderId: agentId,
            content: `🔧 使用工具：${event.tool.name}`,
            contentType: 'tool_use',
            invocationId: invocation.id,
            metadata: { toolEvent: { type: 'tool_use', name: event.tool.name, input: event.tool.input?.slice(0, 500) } },
          });
          if (agentSession) sessionRepo.incrementMessageCount(agentSession.id);
          } catch (dbErr) {
            console.error(`[daemon] Failed to persist tool_use message for ${agentId}:`, dbErr);
          }
        }
        } catch (err) {
          console.error(`[daemon] forwardAgentEvent error for ${agentId}:`, err);
        }

        // A2A v2: on agent completion, let orchestrator scan for @mentions and advance chain
        if (event.type === 'done') {
          completeAgentA2A(event.content);
        }

        // Reset timeout on each event
        resetTimeout();
      };

      // --- Bridge mode (remote opencode via HTTP proxy) ---
      if (opencodeBridgeUrl) {
        const url = String(opencodeBridgeUrl).trim().replace(/\/+$/, '');
        const controller = new AbortController();
        markEnvelopeStarted();
        const bridgeActive: ActiveProcess = { kill: () => controller.abort() };
        registerActiveProcess(bridgeActive);
        processStartGuard.markStarted(startKey);

        broadcast('terminal:data', {
          agentId,
          conversationId: sessionConvId,
          data: `\x1b[33m$ opencode-bridge ${url}\x1b[0m\r\n`,
        });
        recordRuntimeContextObservation({
          transport: 'bridge',
          systemPromptChannel: systemPrompt ? 'bridge' : 'none',
          prompt: prompt || '',
          systemPrompt: systemPrompt || undefined,
        });
        capturePromptObservation(prompt || '', systemPrompt || undefined);

        try {
          const r = await fetch(`${url}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: prompt || '',
              systemPrompt: systemPrompt || undefined,
              sessionId: effectiveSessionId,
              engine,
              runtimeId,
              providerProfileId,
              channel,
              authContextId,
            }),
            signal: controller.signal,
          });

          if (!r.ok || !r.body) {
            broadcast('agent:error', {
              agentId,
              conversationId: sessionConvId,
              message: `Bridge 连接失败 (HTTP ${r.status})`,
              reasonCode: 'spawn_failed' as const,
            });
            // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
            markEnvelopeFailed('spawn_failed');
            broadcast('terminal:exit', { agentId, code: 127, command: 'bridge', reasonCode: 'spawn_failed', conversationId: sessionConvId });
            deleteOwnedActiveProcess(bridgeActive);
            if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
            return;
          }

          const decoder = new TextDecoder();
          const reader = r.body.getReader();
          let buffer = '';
          const rawTextFallback: string[] = [];
          let parsedAgentText = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const str = decoder.decode(value, { stream: true });
            broadcast('terminal:data', { agentId, conversationId: sessionConvId, data: str.replace(/\n/g, '\r\n') });
            resetTimeout();
            buffer += str;
            let idx = buffer.indexOf('\n');
            while (idx !== -1) {
              const line = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 1);
              const parsed = parseAndForwardBridgeLine(line);
              parsedAgentText ||= parsed;
              if (!parsed) {
                const fallbackLine = line.replace(STRIP_ANSI_RE, '').trim();
                if (fallbackLine) rawTextFallback.push(fallbackLine);
              }
              idx = buffer.indexOf('\n');
            }
          }
          if (buffer.trim()) {
            const parsed = parseAndForwardBridgeLine(buffer);
            parsedAgentText ||= parsed;
            if (!parsed) {
              const fallbackLine = buffer.replace(STRIP_ANSI_RE, '').trim();
              if (fallbackLine) rawTextFallback.push(fallbackLine);
            }
          }

          completeAgentA2A(parsedAgentText ? undefined : rawTextFallback.join('\n'));
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          markEnvelopeCompleted();
          // Don't seal on successful completion — session stays active for --resume reuse
          broadcast('terminal:exit', {
            agentId,
            code: 0,
            command: 'bridge',
            conversationId: sessionConvId,
            activity: hasBackgroundChildActivity ? 'awaiting_children' : 'idle',
          });
          deleteOwnedActiveProcess(bridgeActive);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          return;
        } catch (e) {
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          const msg = String((e as Error)?.message || e);
          broadcast('agent:error', {
            agentId,
            conversationId: sessionConvId,
            message: `Bridge 错误：${msg}`,
            reasonCode: 'spawn_failed' as const,
          });
          // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
          markEnvelopeFailed('spawn_failed');
          broadcast('terminal:exit', { agentId, code: 127, command: 'bridge', reasonCode: 'spawn_failed', conversationId: sessionConvId });
          deleteOwnedActiveProcess(bridgeActive);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          return;
        }
      }

      // --- Local spawn mode ---
      const dispatchTmuxGateway = tmuxGateway;
      const dispatchPaneRegistry = agentPaneRegistry;
      if (useTmuxTransport && dispatchTmuxGateway && dispatchPaneRegistry) {
        // tmux pane mode: agent runs inside a tmux pane with remain-on-exit
        let tmuxDispatchStarted = false;
        let tmuxOwnershipPersisted = Boolean(boundExecutor);
        let tmuxPane: {
          worktreeId: string;
          tmuxServerId: string;
          paneId: string;
          invocationId: string;
        } | undefined;
        try {
          const serverId = tmuxServerId!;
          await dispatchTmuxGateway.ensureServer(serverId);
          const invocationId = invocation.id;
          let paneId: string;
          try {
            paneId = await dispatchTmuxGateway.createAgentPane(serverId);
          } catch (error) {
            if (error instanceof TmuxPaneSetupError && !error.cleanupConfirmed) {
              paneId = error.paneId;
              dispatchPaneRegistry.register(invocationId, tmuxWorktreeId, paneId, 'daemon');
              tmuxPane = { worktreeId: tmuxWorktreeId, tmuxServerId: serverId, paneId, invocationId };
            }
            throw error;
          }
          dispatchPaneRegistry.register(invocationId, tmuxWorktreeId, paneId, 'daemon');
          tmuxPane = { worktreeId: tmuxWorktreeId, tmuxServerId: serverId, paneId, invocationId };

          const bound = dispatchGateway.bindExecutor(controlEnvelopeId, {
            invocationId,
            worktreeId: tmuxWorktreeId,
            tmuxServerId: serverId,
            paneId,
            scopeId: projectId || sessionConvId,
          });
          if (!bound) markEnvelopeStarted();
          tmuxOwnershipPersisted = true;

          const envExports = Object.entries(mergedEnv).filter(([k]) => k !== 'PATH' && k !== 'HOME' && k !== 'USER').map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`).join(' ');
          recordRuntimeContextObservation({
            transport: 'tmux',
            systemPromptChannel: engine === 'opencode' && systemPrompt ? 'instructions' : 'inline',
            prompt: JSON.stringify({ command: primaryCommand, args: primaryArgs }),
            systemPrompt: systemPrompt || undefined,
          });
          capturePromptObservation(prompt || '', systemPrompt || undefined);
          const shellCmd = `${envExports ? envExports + ' ' : ''}${[primaryCommand, ...primaryArgs].map((s) => `'${s.replace(/'/g, "'\\''")}'`).join(' ')}`;
          markEnvelopeStarted();
          tmuxDispatchStarted = true;
          await dispatchTmuxGateway.execInPane(serverId, paneId, shellCmd);
          await dispatchTmuxGateway.setPaneReadOnly(serverId, paneId, true);

          broadcast('terminal:data', {
            agentId,
            conversationId: sessionConvId,
            data: `\x1b[33m$ [tmux:${paneId}] ${primaryCommand} ${primaryArgs.join(' ')}\x1b[0m\r\n`,
          });

          const tmuxActive: ActiveProcess = {
            kill: async () => {
              clearInterval(pollInterval);
              try {
                await dispatchTmuxGateway.execInPane(serverId, paneId, 'C-c');
                await new Promise((r) => setTimeout(r, 3000));
              } catch { /* pane dead */ }
              const stopped = await terminateTmuxPaneBeforeRecovery({
                gateway: dispatchTmuxGateway,
                registry: dispatchPaneRegistry,
                worktreeId: tmuxWorktreeId,
                tmuxServerId: serverId,
                paneId,
                invocationId,
              });
              if (!stopped) throw new Error('tmux pane termination could not be confirmed');
            },
            onTerminated: async (reasonCode) => {
              markEnvelopeFailed(reasonCode);
            },
          };
          // Poll pane output for terminal:data events while this invocation is
          // still the registered owner for the agent/project key.
          const pollInterval = setInterval(async () => {
            if (activeProcesses.get(activeKey) !== tmuxActive) {
              clearInterval(pollInterval);
              return;
            }
            try {
              const content = await dispatchTmuxGateway.capturePane(serverId, paneId);
              broadcast('terminal:data', { agentId, conversationId: sessionConvId, data: content.replace(/\n/g, '\r\n') });
            } catch { /* pane gone */ }
          }, 2000);
          registerActiveProcess(tmuxActive);
          processStartGuard.markStarted(startKey);
          return;
        } catch (err) {
          console.error('[daemon] tmux pane creation failed, falling back to direct spawn:', (err as Error).message);
          if (tmuxPane) {
            const paneStopped = await terminateTmuxPaneBeforeRecovery({
              gateway: dispatchTmuxGateway,
              registry: dispatchPaneRegistry,
              ...tmuxPane,
            });
            if (!paneStopped) {
              const strandedPane = tmuxPane;
              const dispatchExpired = err instanceof DispatchExpiredBeforeStartError;
              let recoveryOwnershipStarted = tmuxDispatchStarted;
              if (!dispatchExpired && !recoveryOwnershipStarted) {
                try {
                  if (!tmuxOwnershipPersisted) {
                    tmuxOwnershipPersisted = Boolean(dispatchGateway.bindExecutor(controlEnvelopeId, {
                      invocationId: strandedPane.invocationId,
                      worktreeId: strandedPane.worktreeId,
                      tmuxServerId: strandedPane.tmuxServerId,
                      paneId: strandedPane.paneId,
                      scopeId: projectId || sessionConvId,
                    }));
                  }
                  if (tmuxOwnershipPersisted) {
                    markEnvelopeStarted();
                    recoveryOwnershipStarted = true;
                  }
                } catch (ownershipError) {
                  console.error('[daemon] failed to persist stranded tmux ownership:', ownershipError);
                }
              }
              const strandedTmuxActive: ActiveProcess = {
                kill: async () => {
                  const stopped = await terminateTmuxPaneBeforeRecovery({
                    gateway: dispatchTmuxGateway,
                    registry: dispatchPaneRegistry,
                    ...strandedPane,
                  });
                  if (!stopped) throw new Error('tmux pane termination could not be confirmed');
                },
                onTerminated: async (reasonCode) => {
                  // A failed sent->started CAS already terminalized the
                  // envelope/invocation as dispatch_expired. The stranded pane
                  // is only an idle shell, so later cleanup must not overwrite
                  // that durable recovery fact.
                  if (!dispatchExpired) {
                    markEnvelopeFailed(reasonCode);
                  }
                },
              };
              registerActiveProcess(strandedTmuxActive);
              if (!dispatchExpired && recoveryOwnershipStarted) {
                invocationRepo.updateStatus(invocation.id, 'running', {
                  reason_code: 'tmux_cleanup_failed',
                  error_message: 'tmux pane could not be stopped after startup failure',
                });
              }
              processStartGuard.markStarted(startKey);
              return;
            }
          }
          if (err instanceof DispatchExpiredBeforeStartError) throw err;
          if (tmuxDispatchStarted) {
            invocationRepo.updateStatus(invocation.id, 'failed', {
              reason_code: 'spawn_failed',
              error_message: (err as Error).message,
            });
            throw err;
          }
          invocationRepo.updateStatus(invocation.id, 'failed', {
            reason_code: 'tmux_startup_failed',
            error_message: (err as Error).message,
          });
          throw err;
        }
      }

      // --- Execute via Backend abstraction ---
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
      if (taskId && taskRepo.getById(taskId)?.conversation_id === sessionConvId) {
        taskRepo.update(taskId, { work_dir: taskProjectDir });
      }
      const projectedTasks = evaluation
        ? taskRepo.getByConversation(sessionConvId).filter((item) => item.id === taskId)
        : taskRepo.getByConversation(sessionConvId);
      ensureTasksMdProjection(taskProjectDir, projectedTasks);
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
        const proof = proofLogRepo.append({
          eventType: 'eval.execution.started',
          conversationId: sessionConvId,
          taskId,
          agentId,
          metadata: {
            executionId: evaluation.executionId,
            applicationSnapshotId: evaluation.applicationSnapshotId,
            targetManifestDigest: evaluation.targetManifestDigest,
            observedManifestDigest: evaluationObservedDigest,
            worktreeHead: observedHead,
          },
        });
        transitionCaseExecution({
          id: evaluation.executionId,
          conversationId: sessionConvId,
          status: 'running',
          taskId,
          harnessTriggerId: evaluation.executionId,
          invocationId: invocation.id,
          traceId: invocationTraceId,
          proofEventId: proof.id,
          observedManifestDigest: evaluationObservedDigest,
        });
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
        : (prompt || '') + `\n\n[系统] 任务看板只读投影路径: ${join(taskProjectDir, '.ath')}/TASKS.md；不要直接编辑，状态与证据只通过本轮明确暴露的平台任务工具提交。`;
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
      // every engine MUST resolve to a catalog entry. Unknown engines (e.g.
      // gemini/mock, which have no catalog entry and were never functional
      // through the bespoke backend) throw explicitly here; their tmux/bridge
      // paths (primaryArgs) are unaffected.
      //
      // `executeCwd`/`executeEnv` flow into checkCapabilities opts below so the
      // ACP path's prepared cwd/env (e.g. codex CODEX_HOME) reach the spawn.
      let executeCwd = runtimeWd;
      let executeEnv: Record<string, string> = {
        ...credentialEnv,
        ...(runtimeConfigEnv || {}),
      };

      const entry = loadCatalog().find((e) => e.id === engine);
      if (!entry) {
        throw new Error(
          `no ACP catalog entry for engine: ${engine} (bespoke backends removed in Task 10)`,
        );
      }
      console.log(`[daemon] routing ${agentId} (${engine}) → ACP (${entry.delivery}/${entry.id})`);
      const prepared = prepareAcpRuntime(entry, { cwd: runtimeWd, env: executeEnv });
      executeCwd = prepared.cwd;
      executeEnv = prepared.env;
      acpCleanup = prepared.cleanup;
      const permittedAcpTools = (contextReport?.availableTools ?? []).filter(isSkillTool);
      const mcpOrigin = resolveAcpMcpLoopbackOrigin(io);
      if (permittedAcpTools.length > 0 && !mcpOrigin) {
        throw new Error('acp_skill_mcp_unavailable: daemon HTTP listener has no loopback address');
      }
      const acpToolGrant = mcpOrigin
        ? registerAcpSkillMcpGrant({
          agentId,
          conversationId: sessionConvId,
          invocationId: invocation.id,
          deliveryRunId,
          projectId,
          taskId,
          taskProjectDir,
          permittedTools: permittedAcpTools,
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
      const backend: AgentBackend = createAcpBackend(entry, {
        cwd: prepared.cwd,
        env: prepared.env,
        permissionPolicy: resolveAcpPermissionPolicy(sessionConvId, deliveryRunId),
        hardDenyPermissions: process.env.ACP_PERMISSION_MODE === 'deny',
        mcpServers: acpToolGrant ? [acpToolGrant.mcpServer] : [],
        autoApproveMcpToolNames: acpToolGrant?.autoApproveToolNames ?? [],
      });

      // The per-turn timeout. timeoutMs already carries the codex-ACP floor
      // (see ~L690), so resetTimeout, backend.execute, and the retry path all
      // read this single floored value — no separate effectiveTimeoutMs needed.

      // CapabilityRouter：按 backend 能力降级（resume/systemPrompt/maxTurns/PTY）+ 警告
      const capsResult = checkCapabilities(backend, {
        prompt: promptWithWorkdir,
        opts: {
          cwd: executeCwd,
          // OpenCode loads the same system context from OPENCODE_CONFIG
          // instructions. Other ACP runtimes keep the backend system channel.
          systemPrompt: engine === 'opencode' ? undefined : systemPrompt || undefined,
          resumeSessionId: effectiveSessionId || undefined,
          timeout: timeoutMs > 0 ? timeoutMs : undefined,
          env: executeEnv,
        },
      });
      if (capsResult.warnings.length > 0) {
        console.warn(
          `[daemon] capability degradation for ${agentId} (${capsResult.warnings[0].engine}):`,
          capsResult.warnings.map((w) => `${w.field}→${w.action}`),
        );
      }
      recordRuntimeContextObservation({
        transport: 'acp',
        systemPromptChannel: engine === 'opencode' && systemPrompt
          ? 'instructions'
          : capsResult.opts.systemPrompt
            ? 'backend'
            : 'none',
        prompt: capsResult.prompt,
        systemPrompt: engine === 'opencode'
          ? systemPrompt || undefined
          : capsResult.opts.systemPrompt,
      });
      capturePromptObservation(
        capsResult.prompt,
        engine === 'opencode' ? systemPrompt || undefined : capsResult.opts.systemPrompt,
      );
      markEnvelopeStarted();
      const { events: rawEvents, result, kill } = backend.execute(capsResult.prompt, capsResult.opts);
      const events = withDoneGuarantee(rawEvents, result);

      const acpActive: ActiveProcess = { kill };
      registerActiveProcess(acpActive);
      processStartGuard.markStarted(startKey);

      // Consume events and forward to socket
      (async () => {
        try {
          for await (const event of events) {
            forwardAgentEvent(event);
          }

          // Wait for final result
          const final = await result;
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

          // Persist token usage if available
          if (final.usage && Object.keys(final.usage).length > 0 && invocation) {
            invocationRepo.updateDispatchStatus(invocation.id, 'completed', {
              tokenUsage: JSON.stringify(final.usage),
            });
          }

          // Write GC meta for workdir cleanup
          if (taskId && projectId) {
            workdirManager.writeGCMeta(agentId, projectId, taskId);
          }

          if (final.status === 'completed') {
            if (!finalRuntimeSessionId) {
              throw new Error('session_identity_missing: completed invocation returned no session id');
            }
            const binding = sessionRepo.confirmRuntimeSessionId(
              agentSession.id,
              finalRuntimeSessionId,
              invocation.id,
            );
            if (binding.status === 'mismatch') {
              throw new Error(
                `session_identity_changed: expected ${binding.current}, received ${finalRuntimeSessionId}`,
              );
            }
            announceConfirmedSession(finalRuntimeSessionId);
          } else {
            invocationRepo.failIfNonTerminal(invocation.id, {
              exit_code: 1,
              reason_code: final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : undefined),
              ...(final.error ? { error_message: final.error } : {}),
            });
            if (final.reasonCode === 'acp_session_not_found') {
              sessionRepo.seal(agentSession.id, 'runtime_resource_not_found');
            }
          }

          finishMessageObservation(
            final.status === 'completed' ? 'ok' : final.status === 'cancelled' ? 'cancelled' : 'error',
            final.output,
            final.usage,
            final.error,
          );

          // Confirmed bindings survive failure/timeout. A new binding is not
          // persisted until success, so a cancelled first turn provisions a
          // fresh runtime Session on the next dispatch.

          if (final.status === 'completed') {
            markEnvelopeCompleted();
            if (evaluation) {
              if (taskId) taskRepo.updateStatus(taskId, 'completed');
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
              sessionRepo.seal(agentSession.id, 'evaluation_execution_completed');
            }
          } else {
            markEnvelopeFailed(final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : 'runtime_failed'));
            if (evaluation) {
              if (taskId) taskRepo.updateStatus(taskId, 'blocked', final.error ?? final.reasonCode);
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
              sessionRepo.seal(agentSession.id, 'evaluation_execution_failed');
            }
          }

          broadcast('terminal:exit', {
            agentId,
            code: final.status === 'completed' ? 0 : 1,
            command,
            reasonCode: final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : undefined),
            conversationId: sessionConvId,
            activity: final.status === 'completed' && hasBackgroundChildActivity ? 'awaiting_children' : 'idle',
          });
          deleteOwnedActiveProcess(acpActive);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
          revokeAcpTools?.();
        } catch (err) {
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          console.error(`[daemon][${agentId}] backend error:`, err);
          finishMessageObservation('error', undefined, undefined, (err as Error)?.message || 'spawn_failed');
          // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
          markEnvelopeFailed('spawn_failed');
          if (evaluation) {
            try {
              if (taskId) taskRepo.updateStatus(taskId, 'blocked', (err as Error)?.message);
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
              sessionRepo.seal(agentSession.id, 'evaluation_execution_failed');
            } catch (transitionError) {
              console.error('[evaluation] failed to record execution failure:', transitionError);
            }
          }
          broadcast('terminal:exit', { agentId, code: 1, command, reasonCode: 'spawn_failed', conversationId: sessionConvId });
          deleteOwnedActiveProcess(acpActive);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
          revokeAcpTools?.();
        }
      })();
      } catch (err) {
        const dispatchExpired = err instanceof DispatchExpiredBeforeStartError;
        const terminalReasonCode = dispatchExpired ? err.reasonCode : 'internal_error';
        console.error(`[daemon] terminal:start error for agent=${agentId}:`, err);
        finishObservation(dispatchExpired ? 'cancelled' : 'error', terminalReasonCode);
        if (evaluation) {
          try {
            const current = getDb().prepare('SELECT status FROM eval_case_execution WHERE id=?')
              .get(evaluation.executionId) as { status: string } | undefined;
            if (current && !['completed', 'failed', 'cancelled'].includes(current.status)) {
              transitionCaseExecution({
                id: evaluation.executionId,
                conversationId: conversationId || projectId || '',
                status: 'failed',
                observedManifestDigest: evaluationObservedDigest,
                errorCode: terminalReasonCode,
                errorMessage: (err as Error)?.message,
              });
            }
          } catch (transitionError) {
            console.error('[evaluation] failed to record terminal setup failure:', transitionError);
          }
        }
        if (controlEnvelopeId && !dispatchExpired) {
          dispatchGateway.markFailed(controlEnvelopeId, 'internal_error');
          const receiptConversationId = conversationId || projectId || 'default';
          io.to(receiptConversationId).emit('dispatch.receipt', {
            receiptId: `${controlEnvelopeId}:failed`,
            conversationId: receiptConversationId,
            taskId,
            targetAgentId: agentId,
            source: dispatchSource ?? 'user',
            phase: 'failed',
            chainId,
            passId,
            reasonCode: 'internal_error',
            createdAt: new Date().toISOString(),
          });
        }
        broadcast('agent:error', {
          agentId,
          conversationId: conversationId || projectId || 'default',
          message: dispatchExpired
            ? '派发在运行实例启动前已过期，系统将自动恢复。'
            : `内部错误：${(err as Error)?.message || '未知'}`,
        });
        broadcast('terminal:exit', {
          agentId,
          code: 1,
          command: primaryCommand,
          reasonCode: terminalReasonCode,
          conversationId: conversationId || projectId || 'default',
        });
        deleteOwnedActiveProcess();
        if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        acpCleanup?.();
        revokeAcpTools?.();
      } finally {
        processStartGuard.release(startKey);
      }
    };

  io.on('connection', (socket: Socket) => {
    socket.on('terminal:start', (payload: TerminalStartPayload) => {
      try {
        const submission = submitSocketTerminalStart(harnessCoordinator, payload);
        void submission.completion.then((outcome) => {
          if (outcome.status === 'accepted') return;
          const reasonCode = 'reasonCode' in outcome ? outcome.reasonCode : 'internal_error';
          const conversationId = payload.conversationId || payload.projectId;
          socket.emit('agent:error', { agentId: payload.agentId, conversationId, message: `派发被服务端阻止：${reasonCode}` });
          socket.emit('terminal:exit', { agentId: payload.agentId, conversationId, code: 1, command: 'harness', reasonCode });
        });
      } catch (error) {
        const conversationId = payload.conversationId || payload.projectId;
        socket.emit('agent:error', { agentId: payload.agentId, conversationId, message: (error as Error).message });
        socket.emit('terminal:exit', { agentId: payload.agentId, conversationId, code: 1, command: 'harness', reasonCode: 'conversation_missing' });
      }
    });

    // Force-kill a running agent process
    socket.on('terminal:kill', async ({ agentId, projectId: killProjectId, force }: { agentId: string; projectId?: string; force?: boolean }) => {
      const key = processKey(agentId, killProjectId);
      const active = activeProcesses.get(key);
      if (active) {
        try {
          await active.kill();
          await active.onTerminated?.(force ? 'force_killed' : 'killed');
          deleteIfCurrent(activeProcesses, key, active);
          socket.emit('terminal:exit', { agentId, conversationId: killProjectId, code: 0, command: 'kill', reasonCode: force ? 'force_killed' : 'killed' });
        } catch (error) {
          socket.emit('agent:error', { agentId, conversationId: killProjectId, message: `无法确认运行实例已停止：${(error as Error).message}` });
        }
      }
    });

    socket.on('daemon:status', (callback) => {
      const activeRuns = projectDaemonActiveRuns(
        activeProcesses.keys(),
        (agentId, conversationId) => sessionRepo.findActiveByConversation(agentId, conversationId),
      );
      callback?.({ activeRuns });
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
    stopWorktreeGCScheduler();
    clearInterval(runtimeHealthTimer);
    clearInterval(autonomyGuardTimer);
    const entries = [...activeProcesses.entries()];
    await Promise.all(entries.map(async ([key, active]) => {
      try {
        await active.kill();
        await active.onTerminated?.('process_shutdown');
        deleteIfCurrent(activeProcesses, key, active);
      } catch (error) {
        console.error(`[daemon] shutdown could not confirm termination for ${key}:`, error);
      }
    }));
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}
