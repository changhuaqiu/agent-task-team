import type { Server as IOServer, Socket } from 'socket.io';
import { join } from 'path';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { TmuxGateway } from './tmux-gateway';
import { AgentPaneRegistry } from './agent-pane-registry';
import { readAccount } from './accounts-file';
import { readCredential } from './credentials';
import { buildProbeEnv } from './cli-probe';
import { generateRuntimeConfig, cleanupRuntimeConfig, makeInvocationId } from './opencode-config';
import { startTaskWatcher } from './task-file-watcher';
import { ensureTasksMdProjection } from './task-file-service';
import type { AccountProvider as RuntimeAccountProvider } from './opencode-config';
import type { CliEngine, DetectedRuntime } from './types';
import { sessionRepo } from './repositories/session-repo';
import type { AgentSessionRow } from './repositories/session-repo';
import { invocationRepo } from './repositories/invocation-repo';
import type { InvocationOutcome, InvocationPatch, InvocationRow } from './repositories/invocation-repo';
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
import type { ContextReport, ContextSnapshot } from '../lib/agent-context/ContextManager';
import type { ContextScenario } from '../lib/agent-context/scenarioResolver';
import { generateSpanId, generateTraceId, observationSpanRepo } from './repositories/observation-span-repo';
import { capturePromptPayloads } from './observability/prompt-observation';
import { teamLogProjection } from './team-log/TeamLogProjection';
import { renderTeamLogEnvelope } from '../lib/agent-context/teamLog';
import { ProcessStartGuard } from './process-start-guard';
import { agentEvaluation, startEvaluationWorker } from './evaluation/agent-evaluation';
import { digest } from './evaluation/defaults';
import { transitionCaseExecution } from './evaluation/application-snapshot';
import { EvaluationCaseRunner } from './evaluation/case-runner';
import {
  AcpRuntimeEventCoordinator,
  AgentInbox,
  AgentInboxScheduler,
  DurableEffectOutbox,
  registerProductionRuntimeCompletionEffects,
  runtimeCompletionContextRepo,
  RuntimeSocketProjection,
  startPlatformEventRuntime,
} from './platform-events';
import { ensureAutonomousDeliveryRuntime } from './autonomous-delivery/bootstrap';
import { deliveryAdvancementQueue } from './autonomous-delivery/advancement-queue';
import { registerAutonomousDeliveryE2EDriver } from './testing/autonomous-delivery-e2e-driver';
import { ProjectViewPublisher } from './project-view/project-view-publisher';
import type { WorkContract } from './work-contract/types';
import { renderWorkContractInstruction } from './work-contract/dispatch-contract';

type TerminalStartPayload = {
  dispatchId?: string;
  projectId?: string;
  taskId?: string;
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
  workContract?: WorkContract;
  evaluation?: HarnessDispatchPlan['evaluation'];
};

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

const DEFAULT_RUNTIME_ID_BY_ENGINE: Record<CliEngine, string> = {
  opencode: 'opencode-local',
  claude: 'claude-cli',
  codex: 'codex-cli',
  gemini: 'gemini-cli',
  mock: 'mock-runtime',
};

/** Default CLI idle timeout (ms). Configurable via CLI_TIMEOUT_MS env. 0 = disabled. */
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min
const STRIP_ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[()>]|\r/g;
const LOCAL_DAEMON_NODE_ID = 'daemon:local';
const RUNTIME_HEARTBEAT_INTERVAL_MS = 5_000;
const OPENCODE_PROJECT_SKILLS_DIR = join('.opencode', 'skills');

function resolveAcpPermissionPolicy(): 'deny' | 'allow_once' {
  return process.env.ACP_PERMISSION_MODE === 'allow_once' ? 'allow_once' : 'deny';
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
  const activeProcesses = new Map<string, { kill: () => void }>();
  const processKey = (agentId: string, projectId?: string) => `${agentId}@${projectId || 'default'}`;
  const processStartGuard = new ProcessStartGuard();
  const broadcast = (event: string, data: unknown) => io.emit(event, data);
  const projectViewPublisher = new ProjectViewPublisher(io);
  const runtimeSocketProjection = new RuntimeSocketProjection({
    publish: (projectId, event) => projectViewPublisher.publish(projectId, event),
  });
  const dispatchGateway = new DispatchGateway();
  // Deferred until after the Harness port is constructed; the port closes over this handler.
  // eslint-disable-next-line prefer-const
  let handleTerminalStart: ((payload: TerminalStartPayload, emitToRequester: (event: string, data: unknown) => void) => Promise<void>) | undefined;

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
          agentId: plan.trigger.agentId,
          prompt: plan.prompt,
          systemPrompt: [
            plan.systemPrompt,
            renderWorkContractInstruction(plan.workContract),
          ].filter(Boolean).join('\n\n'),
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
          workContract: plan.workContract,
          evaluation: plan.evaluation,
        }, (event, data) => {
          const scopedData = data && typeof data === 'object'
            ? { ...(data as Record<string, unknown>), projectId: plan.trigger.conversationId }
            : { value: data, projectId: plan.trigger.conversationId };
          io.to(plan.trigger.conversationId).emit(event, scopedData);
        });
        return { status: 'accepted' };
      },
    },
  });
  registerHarnessCoordinator(io, harnessCoordinator);
  const agentInbox = new AgentInbox();
  const agentInboxScheduler = new AgentInboxScheduler({
    inbox: agentInbox,
    submit: (trigger) => harnessCoordinator.submit(trigger),
  });
  agentInboxScheduler.start();
  registerAutonomousDeliveryE2EDriver(io);
  ensureAutonomousDeliveryRuntime(io, `daemon:${LOCAL_DAEMON_NODE_ID}`);
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
          projectId: wakeup.conversationId,
          id: `wakeup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      agentInbox.enqueue({
        projectId: input.conversationId,
        projectAgentId: input.agentId,
        idempotencyKey: `a2a:${input.chainId}:${input.entryId}:${input.agentId}`,
        command: {
          source: 'a2a',
          prompt: input.prompt,
          taskId: input.referencedTaskId,
          fromAgentId: input.fromAgentId,
          chainId: input.chainId,
          passId: input.passId,
        },
      });
      return {
        handled: true,
        admitted: true,
      };
    },
    true,
  );

  const effectOutbox = new DurableEffectOutbox();
  registerProductionRuntimeCompletionEffects(effectOutbox, {
    io,
    messenger: a2aMessenger,
  });

  startPlatformEventRuntime({
    onMessageProjected: (message) => {
      projectViewPublisher.publish(message.conversation_id, {
        kind: 'chat.message.persisted',
        agentId: message.sender_id,
        invocationId: message.invocation_id ?? undefined,
        payload: { message },
      });
    },
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
        workContract,
        evaluation,
      }: TerminalStartPayload, emitToRequester) => {
      const startKey = processKey(agentId, projectId || conversationId);
      if (!processStartGuard.claim(startKey, activeProcesses.has(startKey), Boolean(force))) {
        const busyProjectId = conversationId?.trim() || projectId?.trim();
        if (busyProjectId) {
          projectViewPublisher.publish(busyProjectId, {
            kind: 'runtime.warning',
            agentId,
            payload: {
              message: 'Agent is already starting or running',
              reasonCode: 'agent_busy',
            },
          });
          projectViewPublisher.publish(busyProjectId, {
            kind: 'terminal.exited',
            agentId,
            payload: { code: 1, command: 'dispatch', reasonCode: 'agent_busy' },
          });
        } else {
          emitToRequester('command:error', {
            command: 'terminal:start',
            agentId,
            message: 'Agent is already starting or running',
            reasonCode: 'agent_busy',
          });
        }
        return;
      }
      console.log(`[daemon] terminal:start agent=${agentId}, engine=${rawEngine}, accountId=${accountId ?? '(none)'}, force=${force}, busy=${activeProcesses.has(processKey(agentId, projectId))}`);
      console.log(`[daemon] systemPrompt=${systemPrompt ? `${systemPrompt.length} chars` : '(none)'}, prompt=${incomingPrompt ? `${incomingPrompt.length} chars` : '(none)'}`);
      let primaryCommand = 'unknown';
      let runtimeConfigDir: string | undefined;
      let controlEnvelopeId: string | undefined;
      let invocationTraceId = requestedTraceId;
      let rootObservationSpanId: string | undefined;
      let evaluationObservedDigest: string | undefined;
      let runtimeContextObservationRecorded = false;
      let finishObservation: (status: 'ok' | 'error' | 'cancelled', errorMessage?: string) => void = () => {};
      // ACP per-runtime cleanup (e.g. codex temp CODEX_HOME). Declared here so
      // the outer catch (terminal:start error) can clean up if setup succeeds
      // but a later step throws before the execute IIFE takes over.
      let acpCleanup: (() => void) | undefined;
      let revokeAcpTools: (() => void) | undefined;
      let runtimeEventCoordinator: AcpRuntimeEventCoordinator | undefined;

      try {
      if (!conversationId && !projectId) {
        throw new Error('session_scope_missing: terminal:start requires conversationId or projectId');
      }
      const sessionConvId = conversationId || projectId!;
      const publishRuntimeWarning = (message: string, reasonCode?: string) => {
        projectViewPublisher.publish(sessionConvId, {
          kind: 'runtime.warning',
          agentId,
          payload: { message, reasonCode },
        });
      };
      const publishTerminalOutput = (data: string) => {
        projectViewPublisher.publish(sessionConvId, {
          kind: 'terminal.output',
          agentId,
          payload: { data },
        });
      };
      const publishTerminalExit = (input: {
        code: number;
        command: string;
        reasonCode?: string;
        activity?: AgentActivityStatus;
      }) => {
        projectViewPublisher.publish(sessionConvId, {
          kind: 'terminal.exited',
          agentId,
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
        io.to(sessionConvId).emit('dispatch.receipt', {
          projectId: sessionConvId,
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
      const acknowledgeEnvelope = () => {
        if (!controlEnvelopeId) return;
        dispatchGateway.acknowledge(controlEnvelopeId);
        emitDispatchReceipt('acknowledged');
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

      const engineFromRuntime =
        runtimeId && runtimeId in RUNTIME_ENGINE_MAP ? RUNTIME_ENGINE_MAP[runtimeId] : undefined;
      const engine: CliEngine =
        engineFromRuntime || (rawEngine && rawEngine in ENGINE_COMMAND ? rawEngine : 'opencode');
      const effectiveRuntimeId = runtimeId?.trim() || DEFAULT_RUNTIME_ID_BY_ENGINE[engine];
      primaryCommand = ENGINE_COMMAND[engine];

      const targetNodeId = opencodeBridgeUrl
        ? `bridge:${String(opencodeBridgeUrl).trim().replace(/\/+$/, '')}`
        : LOCAL_DAEMON_NODE_ID;
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
        runtimeId: effectiveRuntimeId,
        payload: {
          prompt: prompt || '',
          contextRefs: [
            ...(taskId ? [`task:${taskId}`] : []),
            ...(chainId ? [`chain:${chainId}`] : []),
            ...(passId ? [`pass:${passId}`] : []),
          ],
        },
      });
      controlEnvelopeId = envelope.id;
      emitDispatchReceipt('requested', envelope.reason_code ?? undefined);

      if (envelope.status === 'rejected') {
        emitDispatchReceipt('rejected', envelope.reason_code ?? 'runtime_rejected');
        publishRuntimeWarning(
          `目标运行实例不可达：${envelope.reason_code ?? 'blocked'}`,
          envelope.reason_code ?? 'runtime_blocked',
        );
        return;
      }

      // Only kill existing process on explicit force send
      if (force && activeProcesses.has(processKey(agentId, projectId))) {
        activeProcesses.get(processKey(agentId, projectId))?.kill();
      }
      // If agent is busy and not forcing, reject silently — client should have queued
      if (!force && activeProcesses.has(processKey(agentId, projectId))) {
        markExecutionOrEnvelopeFailed('agent_busy');
        publishRuntimeWarning('Agent is busy, message queued', 'agent_busy');
        return;
      }
      dispatchGateway.markSent(controlEnvelopeId);
      emitDispatchReceipt('sent');

      const credentialEnv = await resolveCredentialEnv(accountId);

      // --- Session & Invocation tracking (SQLite) ---
      // Use conversationId for session scoping (project-level session per agent)
      const sessionIsolationKey = evaluation ? `evaluation:${evaluation.executionId}` : '';
      const sessionExecutionProfile = {
        engine,
        runtimeId: effectiveRuntimeId,
        accountId: accountId?.trim() || undefined,
      };
      let existingSession = sessionRepo.findActiveByConversation(agentId, sessionConvId, sessionIsolationKey);

      if (
        existingSession
        && sessionRepo.sealIfExecutionProfileChanged(
          existingSession.id,
          sessionExecutionProfile,
        )
      ) {
        console.warn(
          `[daemon] rotating session ${existingSession.id} for ${agentId} in ${sessionConvId} after runtime profile change`,
        );
        existingSession = undefined;
      }

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
          executionProfile: sessionExecutionProfile,
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
        id: workContract?.attemptId ?? generateSortableId('inv'),
        conversation_id: sessionConvId,
        task_id: taskId || '',
        agent_id: agentId,
        session_id: agentSession.id,
        engine,
        account_id: accountId,
        prompt: prompt || '',
        work_contract_id: workContract?.contractId,
        work_id: workContract?.workId,
        work_epoch: workContract?.workEpoch,
        fencing_token: workContract?.fencingToken,
      });
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
      invocationRepo.transition(invocation.id, {
        to: 'starting',
        expectedFrom: 'planned',
      });
      const terminateInvocation = (
        outcome: InvocationOutcome,
        patch: InvocationPatch = {},
      ): InvocationRow => {
        const current = invocationRepo.getById(invocation.id);
        if (!current) throw new Error(`invocation_not_found: ${invocation.id}`);
        return invocationRepo.transition(invocation.id, {
          to: 'terminated',
          expectedFrom: current.status,
          outcome,
          ...patch,
        })!;
      };

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

      let announcedRuntimeSessionId: string | undefined;
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
          const active = activeProcesses.get(processKey(agentId, projectId));
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
        if (activeProcesses.has(processKey(agentId, projectId))) {
          projectViewPublisher.publish(sessionConvId, {
            kind: 'runtime.activity',
            agentId,
            invocationId: invocation.id,
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

        if (type === 'text' || type === 'message' || type === 'assistant') {
          const text = (typeof part?.text === 'string' ? part.text : undefined) || (typeof obj.content === 'string' ? obj.content : undefined);
          if (text) handleAdapterSignal({ type: 'text', content: text, sessionId });
          return !!text;
        } else if (type === 'tool_use') {
          const toolName = typeof part?.tool === 'string' ? part.tool : undefined;
          if (toolName) handleAdapterSignal({ type: 'tool_use', content: '', tool: { name: toolName, input: typeof part?.input === 'object' ? JSON.stringify(part.input) : undefined }, sessionId });
          return !!toolName;
        } else if (type === 'error') {
          const errorObj = (obj.error && typeof obj.error === 'object') ? (obj.error as Record<string, unknown>) : undefined;
          const errorName = typeof errorObj?.name === 'string' ? errorObj.name : '未知错误';
          handleAdapterSignal({ type: 'error', content: errorName, sessionId });
          return true;
        } else if (type === 'done' || type === 'result') {
          const resultText = typeof obj.result === 'string'
            ? obj.result
            : (typeof obj.content === 'string' ? obj.content : '');
          handleAdapterSignal({ type: 'done', content: resultText, sessionId });
          return true;
        }
        return false;
      };

      function isBackgroundChildTool(name: string): boolean {
        const normalized = name.trim().toLowerCase();
        return normalized === 'agent' || normalized === 'task';
      }

      function broadcastAgentActivity(status: AgentActivityStatus, reason?: string): void {
        projectViewPublisher.publish(sessionConvId, {
          kind: 'runtime.activity',
          agentId,
          invocationId: invocation.id,
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

      function announceConfirmedSession(runtimeSessionId: string): void {
        if (announcedRuntimeSessionId === runtimeSessionId) return;
        announcedRuntimeSessionId = runtimeSessionId;
        projectViewPublisher.publish(sessionConvId, {
          kind: 'runtime.session',
          agentId,
          invocationId: invocation.id,
          payload: { sessionId: runtimeSessionId },
        });
        if (taskId && projectId) {
          workdirManager.writeSessionMeta(agentId, projectId, taskId, {
            sessionId: runtimeSessionId,
            updatedAt: '',
          });
        }
      }

      // Adapter signals enter the Runtime coordinator first. Text/thinking
      // deltas stay on a transient transport; durable consumers only observe
      // the canonical Platform Events emitted by the coordinator.
      const handleAdapterSignal = (event: AgentEvent) => {
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
              invocationRepo.transition(invocation.id, {
                to: 'running',
                expectedFrom: 'starting',
                cli_session_id: event.sessionId,
              });
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
            kind: event.type === 'text'
              ? 'runtime.text.delta'
              : 'runtime.thinking.delta',
            agentId,
            invocationId: invocation.id,
            payload: {
              taskId,
              content: event.content,
            },
          });
        }

        // Reset timeout on each event
        resetTimeout();
      };

      const canonicalEngine = (
        engine === 'opencode' || engine === 'claude' || engine === 'codex'
      ) ? engine : undefined;
      const runtimeStartedAtMs = Date.now();
      const createRuntimeEventCoordinator = () => {
        if (!canonicalEngine) return undefined;
        return new AcpRuntimeEventCoordinator({
          context: {
            projectId: sessionConvId,
            projectAgentId: agentId,
            invocationId: invocation.id,
            logicalSessionId: agentSession.id,
            runtimeActorId: targetNodeId,
            correlationId: controlEnvelopeId ?? invocationTraceId ?? invocation.id,
            causationId: controlEnvelopeId,
          },
          engine: canonicalEngine,
          runtimeNodeId: targetNodeId,
          envelopeId: controlEnvelopeId,
          isPlatformTool: isSkillTool,
          onPublished: (event) => {
            if (
              event.type === 'runtime.session.bound'
              || event.type === 'runtime.session.confirmed'
            ) {
              const payload = event.payload as {
                runtimeSessionId?: string;
                binding?: 'created' | 'resumed';
              };
              const canAnnounce = event.type === 'runtime.session.confirmed'
                || payload.binding === 'resumed';
              if (canAnnounce && payload.runtimeSessionId) {
                announceConfirmedSession(payload.runtimeSessionId);
              }
            } else {
              runtimeSocketProjection.project(event);
            }
          },
          onPublishError: (type, error) => {
            console.warn(
              `[platform-event] failed to publish/project ${type} for ${invocation.id}:`,
              error,
            );
          },
        });
      };
      if (canonicalEngine && !tmuxGateway) {
        runtimeEventCoordinator = createRuntimeEventCoordinator();
        runtimeEventCoordinator?.accept();
      }

      // --- Bridge mode (remote opencode via HTTP proxy) ---
      if (opencodeBridgeUrl) {
        const url = String(opencodeBridgeUrl).trim().replace(/\/+$/, '');
        const controller = new AbortController();
        activeProcesses.set(processKey(agentId, projectId), { kill: () => controller.abort() });
        processStartGuard.markStarted(startKey);
        acknowledgeEnvelope();
        runtimeEventCoordinator?.start();

        publishTerminalOutput(`\x1b[33m$ opencode-bridge ${url}\x1b[0m\r\n`);
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
            publishRuntimeWarning(`Bridge 连接失败 (HTTP ${r.status})`, 'spawn_failed');
            // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
            runtimeEventCoordinator?.failSetup('spawn_failed', observedRuntimeSessionId);
            markExecutionOrEnvelopeFailed('spawn_failed');
            publishTerminalExit({ code: 127, command: 'bridge', reasonCode: 'spawn_failed' });
            activeProcesses.delete(processKey(agentId, projectId));
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
            publishTerminalOutput(str.replace(/\n/g, '\r\n'));
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

          if (!parsedAgentText && rawTextFallback.length > 0) {
            handleAdapterSignal({ type: 'text', content: rawTextFallback.join('\n') });
          }
          runtimeEventCoordinator?.terminate({
            status: 'completed',
            durationMs: Math.max(0, Date.now() - runtimeStartedAtMs),
            sessionId: observedRuntimeSessionId ?? effectiveSessionId,
          });
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          markExecutionCompleted();
          // Don't seal on successful completion — session stays active for --resume reuse
          publishTerminalExit({
            code: 0,
            command: 'bridge',
            activity: hasBackgroundChildActivity ? 'awaiting_children' : 'idle',
          });
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          return;
        } catch (e) {
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          const msg = String((e as Error)?.message || e);
          publishRuntimeWarning(`Bridge 错误：${msg}`, 'spawn_failed');
          // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
          runtimeEventCoordinator?.failSetup('spawn_failed', observedRuntimeSessionId);
          markExecutionOrEnvelopeFailed('spawn_failed');
          publishTerminalExit({ code: 127, command: 'bridge', reasonCode: 'spawn_failed' });
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          return;
        }
      }

      // --- Local spawn mode ---
      if (tmuxGateway && agentPaneRegistry) {
        // tmux pane mode: agent runs inside a tmux pane with remain-on-exit
        try {
          const worktreeId = projectId || 'default';
          await tmuxGateway.ensureServer(worktreeId);
          const paneId = await tmuxGateway.createAgentPane(worktreeId);
          const invocationId = `${agentId}-${Date.now()}`;
          agentPaneRegistry.register(invocationId, worktreeId, paneId, 'daemon');

          const envExports = Object.entries(mergedEnv).filter(([k]) => k !== 'PATH' && k !== 'HOME' && k !== 'USER').map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`).join(' ');
          recordRuntimeContextObservation({
            transport: 'tmux',
            systemPromptChannel: engine === 'opencode' && systemPrompt ? 'instructions' : 'inline',
            prompt: JSON.stringify({ command: primaryCommand, args: primaryArgs }),
            systemPrompt: systemPrompt || undefined,
          });
          capturePromptObservation(prompt || '', systemPrompt || undefined);
          const shellCmd = `${envExports ? envExports + ' ' : ''}${[primaryCommand, ...primaryArgs].map((s) => `'${s.replace(/'/g, "'\\''")}'`).join(' ')}`;
          await tmuxGateway.execInPane(worktreeId, paneId, shellCmd);
          await tmuxGateway.setPaneReadOnly(worktreeId, paneId, true);

          publishTerminalOutput(
            `\x1b[33m$ [tmux:${paneId}] ${primaryCommand} ${primaryArgs.join(' ')}\x1b[0m\r\n`,
          );

          // Poll pane output for terminal:data events
          const pollInterval = setInterval(async () => {
            if (!activeProcesses.has(processKey(agentId, projectId))) {
              clearInterval(pollInterval);
              return;
            }
            try {
              const content = await tmuxGateway.capturePane(worktreeId, paneId);
              publishTerminalOutput(content.replace(/\n/g, '\r\n'));
            } catch { /* pane gone */ }
          }, 2000);

          activeProcesses.set(processKey(agentId, projectId), {
            kill: async () => {
              clearInterval(pollInterval);
              try {
                await tmuxGateway.execInPane(worktreeId, paneId, 'C-c');
                await new Promise((r) => setTimeout(r, 3000));
              } catch { /* pane dead */ }
              try {
                await tmuxGateway.killPane(worktreeId, paneId);
              } catch { /* already dead */ }
              agentPaneRegistry.remove(invocationId);
            },
          });
          processStartGuard.markStarted(startKey);
          acknowledgeEnvelope();
          return;
        } catch (err) {
          console.error('[daemon] tmux pane creation failed, falling back to direct spawn:', (err as Error).message);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        }
      }

      // --- Execute via Backend abstraction ---
      if (!runtimeEventCoordinator && canonicalEngine) {
        runtimeEventCoordinator = createRuntimeEventCoordinator();
        runtimeEventCoordinator?.accept();
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
      const backend: AgentBackend = createAcpBackend(entry, {
        cwd: prepared.cwd,
        env: prepared.env,
        permissionPolicy: resolveAcpPermissionPolicy(),
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
      const { events: rawEvents, result, kill } = backend.execute(capsResult.prompt, capsResult.opts);
      runtimeEventCoordinator?.start();
      const events = withDoneGuarantee(rawEvents, result);

      activeProcesses.set(processKey(agentId, projectId), { kill });
      processStartGuard.markStarted(startKey);
      acknowledgeEnvelope();

      // Consume events and forward to socket
      (async () => {
        try {
          for await (const event of events) {
            handleAdapterSignal(event);
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
            if (binding.status === 'bound') {
              runtimeEventCoordinator?.confirmSession(finalRuntimeSessionId);
            }
            terminateInvocation('completed', {
              exit_code: 0,
              cli_session_id: finalRuntimeSessionId,
            });
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
              sessionRepo.seal(agentSession.id, 'runtime_resource_not_found');
            }
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
              if (taskId) taskRepo.transition(taskId, { to: 'done' });
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
            markExecutionOrEnvelopeFailed(
              final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : 'runtime_failed'),
            );
            if (evaluation) {
              if (taskId) {
                taskRepo.transition(taskId, {
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
              sessionRepo.seal(agentSession.id, 'evaluation_execution_failed');
            }
          }

          publishTerminalExit({
            code: final.status === 'completed' ? 0 : 1,
            command,
            reasonCode: final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : undefined),
            activity: final.status === 'completed' && hasBackgroundChildActivity ? 'awaiting_children' : 'idle',
          });
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
          revokeAcpTools?.();
        } catch (err) {
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          console.error(`[daemon][${agentId}] backend error:`, err);
          runtimeEventCoordinator?.failSetup('spawn_failed', observedRuntimeSessionId);
          try {
            terminateInvocation('failed', {
              exit_code: 1,
              reason_code: 'spawn_failed',
              error_message: (err as Error)?.message,
            });
          } catch (invocationError) {
            console.error('[daemon] failed to terminate invocation after backend error:', invocationError);
          }
          // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
          markExecutionOrEnvelopeFailed('spawn_failed');
          if (evaluation) {
            try {
              if (taskId) {
                taskRepo.transition(taskId, {
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
              sessionRepo.seal(agentSession.id, 'evaluation_execution_failed');
            } catch (transitionError) {
              console.error('[evaluation] failed to record execution failure:', transitionError);
            }
          }
          publishTerminalExit({ code: 1, command, reasonCode: 'spawn_failed' });
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
          revokeAcpTools?.();
        }
      })();
      } catch (err) {
        console.error(`[daemon] terminal:start error for agent=${agentId}:`, err);
        finishObservation('error', 'internal_error');
        runtimeEventCoordinator?.failSetup('internal_error');
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
                errorCode: 'internal_error',
                errorMessage: (err as Error)?.message,
              });
            }
          } catch (transitionError) {
            console.error('[evaluation] failed to record terminal setup failure:', transitionError);
          }
        }
        if (controlEnvelopeId) {
          const receiptConversationId = conversationId || projectId || 'default';
          const current = executionEnvelopeRepo.getById(controlEnvelopeId);
          if (current?.status === 'acknowledged') {
            dispatchGateway.markExecutionFailed(controlEnvelopeId, 'internal_error');
          } else if (current && current.status !== 'rejected' && current.status !== 'expired') {
            dispatchGateway.reject(controlEnvelopeId, 'internal_error');
            io.to(receiptConversationId).emit('dispatch.receipt', {
              projectId: receiptConversationId,
              receiptId: `${controlEnvelopeId}:rejected`,
              conversationId: receiptConversationId,
              taskId,
              targetAgentId: agentId,
              source: dispatchSource ?? 'user',
              phase: 'rejected',
              chainId,
              passId,
              reasonCode: 'internal_error',
              createdAt: new Date().toISOString(),
            });
          }
        }
        const failureProjectId = conversationId?.trim() || projectId?.trim();
        if (failureProjectId) {
          projectViewPublisher.publish(failureProjectId, {
            kind: 'runtime.warning',
            agentId,
            payload: {
              message: `内部错误：${(err as Error)?.message || '未知'}`,
              reasonCode: 'internal_error',
            },
          });
          projectViewPublisher.publish(failureProjectId, {
            kind: 'terminal.exited',
            agentId,
            payload: {
              code: 1,
              command: primaryCommand,
              reasonCode: 'internal_error',
            },
          });
        } else {
          emitToRequester('command:error', {
            command: 'terminal:start',
            agentId,
            message: `内部错误：${(err as Error)?.message || '未知'}`,
            reasonCode: 'internal_error',
          });
        }
        activeProcesses.delete(processKey(agentId, projectId));
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
          const projectId = payload.conversationId?.trim() || payload.projectId?.trim();
          if (!projectId) return;
          projectViewPublisher.publish(projectId, {
            kind: 'runtime.warning',
            agentId: payload.agentId,
            payload: { message: `派发被服务端阻止：${reasonCode}`, reasonCode },
          });
          projectViewPublisher.publish(projectId, {
            kind: 'terminal.exited',
            agentId: payload.agentId,
            payload: { code: 1, command: 'harness', reasonCode },
          });
        });
      } catch (error) {
        const commandProjectId = payload.conversationId?.trim() || payload.projectId?.trim();
        socket.emit('command:error', {
          command: 'terminal:start',
          projectId: commandProjectId,
          agentId: payload.agentId,
          message: (error as Error).message,
          reasonCode: 'conversation_missing',
        });
      }
    });

    // Force-kill a running agent process
    socket.on('terminal:kill', ({ agentId, projectId: killProjectId, force }: { agentId: string; projectId?: string; force?: boolean }) => {
      if (!killProjectId?.trim()) {
        socket.emit('command:error', { command: 'terminal:kill', reasonCode: 'project_id_required' });
        return;
      }
      const key = processKey(agentId, killProjectId);
      if (activeProcesses.has(key)) {
        activeProcesses.get(key)?.kill();
        activeProcesses.delete(key);
        projectViewPublisher.publish(killProjectId, {
          kind: 'terminal.exited',
          agentId,
          payload: {
            code: 0,
            command: 'kill',
            reasonCode: force ? 'force_killed' : 'killed',
          },
        });
      }
    });

    socket.on('daemon:status', ({ projectId }: { projectId?: string }, callback) => {
      const activeAgents: Record<string, { taskId?: string; conversationId?: string }> = {};
      const normalizedProjectId = projectId?.trim();
      if (!normalizedProjectId) {
        callback?.({ activeAgents, error: 'project_id_required' });
        return;
      }
      for (const [key] of activeProcesses) {
        const separator = key.lastIndexOf('@');
        const agentId = separator >= 0 ? key.slice(0, separator) : key;
        const activeProjectId = separator >= 0 ? key.slice(separator + 1) : 'default';
        if (activeProjectId !== normalizedProjectId) continue;
        const session = sessionRepo.findActiveByConversation(agentId, normalizedProjectId, '');
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
  const shutdown = () => {
    agentInboxScheduler.stop();
    stopWorktreeGCScheduler();
    clearInterval(runtimeHealthTimer);
    clearInterval(autonomyGuardTimer);
    for (const active of activeProcesses.values()) active.kill();
    activeProcesses.clear();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
