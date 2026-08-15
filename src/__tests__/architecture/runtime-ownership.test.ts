import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory)).flatMap((name) => {
    const relative = `${directory}/${name}`;
    const absolute = resolve(process.cwd(), relative);
    if (statSync(absolute).isDirectory()) return productionTypeScriptFiles(relative);
    return /\.tsx?$/.test(relative) && !/\.test\.tsx?$/.test(relative) ? [relative] : [];
  });
}

describe('runtime ownership architecture', () => {
  const daemon = source('src/server/daemon.ts');
  const taskHubStore = source('src/store/taskHubStore.ts');
  const deliveryApi = source('src/pages/api/autonomous-delivery.ts');
  const githubIngress = source('src/server/github-issue-hook/ingress.ts');
  const mutationApi = source('src/pages/api/mutations.ts');
  const phaseApi = source('src/pages/api/phases.ts');
  const taskStore = source('src/store/taskStore.ts');
  const skillTools = source('src/server/skill-tool-executor.ts');

  it('does not accept browser execution acknowledgements for server-owned A2A work', () => {
    for (const event of [
      'a2a:agent-started',
      'a2a:dispatch-failed',
      'a2a:dispatch-deferred',
      'a2a:user-message',
    ]) {
      expect(daemon).not.toContain(`socket.on('${event}'`);
    }
  });

  it('does not retain legacy automatic-control consumers in WebUI', () => {
    for (const event of ['agent:event', 'agent:error', 'task.assigned']) {
      expect(taskHubStore).not.toContain(`socket.on('${event}'`);
    }
    expect(taskHubStore).not.toContain(`socket.emit('a2a:agent-started'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:dispatch-failed'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:dispatch-deferred'`);
    expect(taskHubStore).not.toContain('handledByHarness');
    expect(taskHubStore).not.toContain('harnessFallbackReasonCode');
  });

  it('keeps the browser Store interface free of zero-consumer compatibility actions', () => {
    const storeFiles = productionTypeScriptFiles('src/store');
    for (const action of [
      'setHasHydrated',
      'createProgressMessage',
      'mergeLegacyChatMessages',
      'getConversations',
      'getEventsForSelectedConversation',
      'getDispatchReceiptsForSelectedConversation',
      'restoreConversation',
      'fixBlocker',
      'getRoleCardById',
      'getRoleCardForAgent',
    ]) {
      const actionPattern = new RegExp(`\\b${action}\\b`);
      expect(storeFiles.filter((path) => actionPattern.test(source(path)))).toEqual([]);
    }
    const retiredProgressCard = /progressData|ProgressMessageCard/;
    expect(productionTypeScriptFiles('src').filter((path) => retiredProgressCard.test(source(path)))).toEqual([]);
  });

  it('keeps browser Agent identity free of duplicate RoleCard facts', () => {
    const agentStore = source('src/store/agentStore.ts');
    const agentInterface = agentStore.match(/export interface Agent \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(agentInterface).not.toMatch(/^\s*role(?:Label)?:/m);

    const retiredRoleProjection = /\bAgentRole\b|\broleLabel\b|\bROLE_(?:LABEL_)?MAP\b/;
    expect(productionTypeScriptFiles('src').filter((path) => retiredRoleProjection.test(source(path))))
      .toEqual([]);
    expect(taskHubStore).toContain('getAgentRoleCard: (agentId: string) => RoleCard | undefined');
    for (const consumer of [
      'src/components/task-hub/AgentBar.tsx',
      'src/components/task-hub/AgentRosterModal.tsx',
      'src/components/task-hub/GlobalChatRoom.tsx',
      'src/components/task-hub/AgentMentionPopup.tsx',
      'src/components/task-hub/TaskDetailPanel.tsx',
    ]) {
      expect(source(consumer)).toContain('getAgentRoleCard');
    }
  });

  it('keeps Team Runtime workflow policy limited to real initial assignment', () => {
    const productionFiles = productionTypeScriptFiles('src');
    const retiredWorkflowSurface = /\bTeamModeEngine\b|\bgetNextAgent\b|\bgetNextRole\b|\bcanCommunicate\b/;
    expect(productionFiles.filter((path) => retiredWorkflowSurface.test(source(path)))).toEqual([]);
    expect(existsSync(resolve(process.cwd(), 'src/lib/orchestration/TeamModeEngine.ts'))).toBe(false);

    const runtimeTypes = source('src/lib/team-runtime/types.ts');
    const runtimeBarrel = source('src/lib/team-runtime/index.ts');
    const workflowPolicy = source('src/lib/team-runtime/resolveWorkflowPolicy.ts');
    const taskAssignment = source('src/server/team-runtime/task-assignment.ts');
    const teamPackTypes = source('src/types/teamPack.ts');
    expect(runtimeTypes).toContain('selectInitialAgent(): string | null;');
    expect(runtimeTypes).not.toContain('interface TaskAssignment');
    expect(runtimeBarrel).not.toMatch(/resolveWorkflowPolicy|WorkflowPolicy|TaskAssignment/);
    expect(teamPackTypes).not.toMatch(/export interface Task\b/);
    expect(workflowPolicy).toContain("teamPack.teamMode === 'pipeline'");
    expect(workflowPolicy).toContain("teamPack.teamMode === 'parallel'");
    expect(workflowPolicy).not.toMatch(/new Date|taskResult|assignedAt/);
    expect(taskAssignment).toContain('runtime.workflowPolicy.selectInitialAgent()');
    expect(taskAssignment).not.toContain('fallbackAgentId');
    expect(taskAssignment).not.toContain('TaskAssignmentSource');
    const commandGuard = source('src/server/a2a/command-guard.ts');
    const teamPackLayer = source('src/lib/agent-context/layers/teamPackLayer.ts');
    expect(productionFiles.filter((path) => /communicationPolicy\.canSend|\bgetEscalationTarget\b/.test(source(path)))).toEqual([]);
    expect(runtimeTypes).not.toContain('canSend(');
    expect(runtimeTypes).not.toContain('getEscalationTarget');
    expect(runtimeBarrel).not.toMatch(/resolveCommunicationPolicy|CommunicationPolicy/);
    expect(commandGuard).toContain('runtime.communicationPolicy.explainBlock(');
    expect(commandGuard.match(/runtime\.communicationPolicy\.explainBlock\(/g)).toHaveLength(1);
    expect(teamPackLayer).toMatch(/canReceiveFrom/);
    expect(teamPackLayer).toMatch(/canEscalateTo/);
  });

  it('keeps explicit human command adapters available', () => {
    expect(taskHubStore).toContain(`type: 'a2a.human_handoff'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:user-turn-created'`);
    expect(daemon).not.toContain(`socket.on('a2a:user-turn-created'`);
    expect(daemon).toContain(`socket.on('terminal:start'`);
    expect(daemon).toContain(`socket.on('terminal:kill'`);
  });

  it('keeps legacy proposal policy inside Invocation Planner rather than socket transport', () => {
    const socketAdapter = daemon.slice(
      daemon.indexOf('export function submitSocketTerminalStart'),
      daemon.indexOf("type AgentActivityStatus"),
    );
    const planner = source('src/server/invocation-pipeline/context-planner.ts');
    expect(socketAdapter).toContain('return coordinator.submit({');
    expect(socketAdapter).not.toMatch(/autonomousDeliveryRepo|proofLogRepo|legacy_proposal\.suppressed/);
    expect(daemon).not.toContain('legacy_proposal.suppressed');
    expect(planner).toContain(
      'trigger.legacyProposal && autonomousDeliveryRepo.getLatestByConversation(trigger.conversationId)',
    );
    expect(planner).toContain("reasonCode: 'autonomous_delivery_owns_planning'");
  });

  it('keeps acceptance verification admission on the QualityGate outcome seam', () => {
    const productionFiles = productionTypeScriptFiles('src');
    const retiredProofAdmission = /verificationReceiptFromProof|failedVerificationReceipt|VerificationProofPolicy|verifier_actor_mismatch|verifier_not_authorized/;
    expect(productionFiles.filter((path) => retiredProofAdmission.test(source(path)))).toEqual([]);
    expect(productionFiles.filter((path) => /\bvalidateAcceptanceVerificationReceipt\b/.test(source(path))).sort())
      .toEqual([
        'src/server/autonomous-delivery/verification-receipt.ts',
        'src/server/quality-gate/outcome-process-manager.ts',
      ]);
    const validator = source('src/server/autonomous-delivery/verification-receipt.ts');
    const outcomeManager = source('src/server/quality-gate/outcome-process-manager.ts');
    expect(outcomeManager.match(/validateAcceptanceVerificationReceipt\s*\(/g)).toHaveLength(1);
    expect(`${validator}\n${outcomeManager}`).not.toMatch(
      /proof-log-repo|ProofEventRow|task_graph\.gate_evidence\.accepted/,
    );
  });

  it('keeps agent execution on the ACP backend without a tmux CLI bypass', () => {
    expect(daemon).toContain('loadCatalog().find');
    expect(daemon).toContain('createAcpBackend');
    expect(daemon).not.toContain('ATH_TMUX_ENABLED');
    expect(daemon).not.toContain("transport: 'tmux'");
    const forbiddenBypass = /ATH_TMUX|TmuxGateway|AgentPaneRegistry|agent-panes:list|transport:\s*['"]tmux['"]|opencode-prompt-delivery/;
    expect(productionTypeScriptFiles('src/server').filter((path) => forbiddenBypass.test(source(path)))).toEqual([]);
  });

  it('keeps cross-platform process spawning inside the sole ACP backend', () => {
    const serverFiles = productionTypeScriptFiles('src/server');
    expect(serverFiles.filter((path) => /from ['"]cross-spawn['"]/.test(source(path))))
      .toEqual(['src/server/agent/acp/acpBackend.ts']);
    const retiredSpawnWrapper = /\bspawnCli\b|agent\/cliBridge|agent\\cliBridge/;
    expect(serverFiles.filter((path) => retiredSpawnWrapper.test(source(path)))).toEqual([]);
  });

  it('keeps terminal event normalization inside the sole ACP backend', () => {
    const productionFiles = productionTypeScriptFiles('src/server');
    const retiredDoneWrapper = /withDoneGuarantee|with-done-guarantee/;
    expect(productionFiles.filter((path) => retiredDoneWrapper.test(source(path)))).toEqual([]);
    const executeStart = daemon.indexOf(
      'const { events, result, kill } = backend.execute(promptWithWorkdir, execOptions);',
    );
    const resultBoundary = daemon.indexOf('// Wait for final result', executeStart);
    expect(executeStart).toBeGreaterThan(-1);
    expect(resultBoundary).toBeGreaterThan(executeStart);
    const eventConsumption = daemon.slice(executeStart, resultBoundary);
    expect(eventConsumption).toContain('for await (const event of events)');
    const executableEventConsumption = eventConsumption.replace(/\/\/.*$/gm, '');
    expect(executableEventConsumption.match(/\bevents\b/g)).toHaveLength(2);
    expect(source('src/server/agent/acp/acpBackend.ts')).toContain('ensureSingleTerminalDone');
  });

  it('does not retain the bespoke CLI capability downgrade layer before ACP execution', () => {
    expect(daemon).not.toContain('checkCapabilities');
    expect(daemon).toContain('buildAcpExecOptions');
    expect(daemon).toContain('backend.execute(promptWithWorkdir, execOptions)');
    const retiredCapabilityLayer = /CapabilitySet|capabilityRouter|backend\.capabilities/;
    expect(productionTypeScriptFiles('src/server').filter((path) => retiredCapabilityLayer.test(source(path)))).toEqual([]);
  });

  it('keeps context assembly on one native Fragment pipeline', () => {
    const contextFiles = productionTypeScriptFiles('src/lib/agent-context');
    const retiredContextAdapter = /legacyPartToFragment|ContextAssemblyPart|legacy-tier-adapter|legacy-assembly-v1|kind:\s*['"]legacy\./;
    expect(contextFiles.filter((path) => retiredContextAdapter.test(source(path)))).toEqual([]);
    const retiredMemorySeam = /MemoryHook|noOpMemoryHook|memory-hook|recalledArtifacts/;
    expect(productionTypeScriptFiles('src').filter((path) => retiredMemorySeam.test(source(path)))).toEqual([]);
    const budgetGuard = source('src/lib/agent-context/BudgetGuard.ts');
    expect(budgetGuard).not.toMatch(/\bpriority\??:/);
    expect(budgetGuard).toContain('tier: ContextTier');
    expect(budgetGuard).toContain('importance: number');
    expect(source('src/lib/agent-context/ContextManager.ts')).not.toContain('p0Intact');
  });

  it('keeps the formal Team Runtime roster as the sole team identity input for context', () => {
    const productionFiles = productionTypeScriptFiles('src');
    const retiredStaticRosterSeam = /\bgetAllRoleCards\b|\bbuildTeamLayer\b/;
    expect(productionFiles.filter((path) => retiredStaticRosterSeam.test(source(path)))).toEqual([]);

    const contextManager = source('src/lib/agent-context/ContextManager.ts');
    const tierContext = source('src/lib/agent-context/tiers/tierContext.ts');
    const knowledgeTier = source('src/lib/agent-context/tiers/knowledgeTier.ts');
    const planner = source('src/server/invocation-pipeline/context-planner.ts');
    expect(contextManager).toContain('getRuntimeRoster(conversationId: string): Promise<RuntimeAgent[]>;');
    expect(tierContext).not.toContain('allRoleCards');
    expect(knowledgeTier).toContain('runtimeRoster.map');
    expect(knowledgeTier).not.toContain('AGENT_ROSTER');
    expect(planner).toContain('getRuntimeRoster: async () => runtime.roster');
  });

  it('keeps production Agent engines aligned with the ACP Catalog', () => {
    const runtimeIdentityFiles = [
      'src/server/types.ts',
      'src/lib/team-runtime/types.ts',
      'src/server/daemon.ts',
      'src/server/invocation-pipeline/context-planner.ts',
    ];
    const retiredGeminiRuntime = /['"]gemini(?:-cli)?['"]/;
    expect(runtimeIdentityFiles.filter((path) => retiredGeminiRuntime.test(source(path)))).toEqual([]);
  });

  it('keeps the WorkContract root correlation above transport envelopes', () => {
    expect(daemon).toContain(
      'correlationId: workContract?.correlationId ?? invocationTraceId ?? invocation.id',
    );
    expect(daemon).not.toContain(
      'correlationId: controlEnvelopeId ?? invocationTraceId ?? invocation.id',
    );
  });

  it('routes WebUI and Agent task writes through the Task Graph owner', () => {
    for (const writer of [mutationApi, skillTools]) {
      expect(writer).not.toMatch(/taskRepo\.(create|transition|update|delete)\(/);
      expect(writer).toContain('taskCommandService');
    }
  });

  it('does not expose Task cancellation or Runtime lifecycle through generic browser mutations', () => {
    for (const action of [
      'task.delete',
      'session.create',
      'session.updateCliSessionId',
      'session.seal',
      'session.sealByTask',
      'invocation.create',
      'invocation.transition',
    ]) {
      expect(mutationApi).not.toContain(`case '${action}'`);
    }
  });

  it('keeps Phase persistence behind the dedicated Phase interface', () => {
    expect(phaseApi).toContain("if (req.method === 'GET')");
    expect(phaseApi).toContain("if (req.method === 'POST')");
    expect(phaseApi).toContain("if (req.method === 'DELETE')");
    expect(taskStore).toContain("fetch('/api/phases'");
    expect(taskStore).toContain('fetch(`/api/phases?id=${encodeURIComponent(phaseId)}`');
    for (const action of ['phase.upsert', 'phase.delete']) {
      expect(mutationApi).not.toContain(`case '${action}'`);
      expect(taskStore).not.toContain(`type: '${action}'`);
    }
    const phasePersistenceRoutes = productionTypeScriptFiles('src/pages/api')
      .filter((path) => /phaseQueries|(?:listPhasesByConversation|upsertPhase|deletePhase)\(/.test(source(path)));
    expect(phasePersistenceRoutes).toEqual(['src/pages/api/phases.ts']);
  });

  it('keeps Agent Tool execution out of generic browser mutations', () => {
    expect(mutationApi).not.toContain("case 'tool.invoke'");
    const skillToolExecutor = source('src/server/skill-tool-executor.ts');
    const acpSkillMcp = source('src/server/acp-skill-mcp.ts');
    expect(acpSkillMcp).toContain('return executeSkillTool({');
    expect(skillToolExecutor).toContain('checkRateLimit(invocation.rateLimitKey ?? invocation.agentId)');
    expect(skillToolExecutor).toContain("eventType: 'skill.tool.invoked'");
  });

  it('keeps every production Task write inside an explicit Task Graph owner module', () => {
    const allowedOwnerImplementations = new Set([
      'src/server/repositories/task-command-service.ts',
      'src/server/repositories/task-graph-repo.ts',
      'src/server/task-flow/group-chat-task-flow.ts',
    ]);
    const directWriters = productionTypeScriptFiles('src/server')
      .filter((path) => /taskRepo\.(create|transition|update|delete)\(/.test(source(path)));
    expect(directWriters.sort()).toEqual([...allowedOwnerImplementations].sort());
    expect(
      directWriters.filter((path) => path.includes('process-manager')),
    ).toEqual([]);
  });

  it('does not translate CLI-native Todo state into the Platform Task Graph', () => {
    const todoMentions = productionTypeScriptFiles('src/server')
      .filter((path) => /todo(?:read|write)/i.test(source(path)));
    expect(todoMentions).toEqual([]);
  });

  it('keeps WebUI notices read-only and removes the legacy Supervisor vocabulary', () => {
    expect(taskHubStore).not.toContain('SupervisorOutput');
    expect(taskHubStore).not.toContain('supervisor.output');
    expect(deliveryApi).not.toContain('Delivery supervisor');
    expect(githubIngress).not.toContain('resolveSupervisor');
    expect(githubIngress).not.toContain('supervisor');
  });

  it('allows global broadcast only for the system runtime catalog', () => {
    const broadcastEvents = Array.from(
      daemon.matchAll(/\bbroadcast\('([^']+)'/g),
      (match) => match[1],
    );
    expect(broadcastEvents).toEqual(['runtimes:update']);
    expect(daemon.match(/\bio\.emit\(/g)).toHaveLength(1);
  });
});
