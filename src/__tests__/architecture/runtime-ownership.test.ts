import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
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

function exportedSurfaceFromText(path: string, contents: string): Set<string> {
  const file = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const addName = (name: ts.PropertyName | ts.BindingName | undefined) => {
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) names.add(name.text);
  };
  const addObjectProperties = (expression: ts.Expression | undefined) => {
    if (!expression || !ts.isObjectLiteralExpression(expression)) return;
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) continue;
      addName(property.name);
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) {
        names.add(property.initializer.text);
      }
    }
  };

  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      statement.exportClause.elements.forEach((element) => {
        names.add(element.name.text);
        if (element.propertyName) names.add(element.propertyName.text);
      });
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) names.add(statement.expression.text);
      addObjectProperties(statement.expression);
      continue;
    }
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addName(declaration.name);
        addObjectProperties(declaration.initializer);
      }
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
    ) {
      addName(statement.name);
    }
  }
  return names;
}

function exportedSurface(path: string): Set<string> {
  return exportedSurfaceFromText(path, source(path));
}

describe('runtime ownership architecture', () => {
  const nextConfig = source('next.config.ts');
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

  it('keeps Team Runtime initial assignment as a direct derived value', () => {
    const productionFiles = productionTypeScriptFiles('src');
    const retiredWorkflowSurface = /\bTeamModeEngine\b|\bWorkflowPolicy\b|\bresolveWorkflowPolicy\b|\bselectInitialAgent\b|\bworkflowPolicy\b|\bgetNextAgent\b|\bgetNextRole\b|\bcanCommunicate\b/;
    expect(productionFiles.filter((path) => retiredWorkflowSurface.test(source(path)))).toEqual([]);
    expect(existsSync(resolve(process.cwd(), 'src/lib/orchestration/TeamModeEngine.ts'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/lib/team-runtime/resolveWorkflowPolicy.ts'))).toBe(false);

    const runtimeTypes = source('src/lib/team-runtime/types.ts');
    const runtimeBarrel = source('src/lib/team-runtime/index.ts');
    const teamRuntimeResolver = source('src/lib/team-runtime/resolveTeamRuntime.ts');
    const taskAssignment = source('src/server/team-runtime/task-assignment.ts');
    const teamPackTypes = source('src/types/teamPack.ts');
    expect(runtimeTypes).toContain('initialAgentId: string | null;');
    expect(runtimeTypes).not.toContain('interface TaskAssignment');
    expect(runtimeBarrel).not.toMatch(/resolveWorkflowPolicy|WorkflowPolicy|TaskAssignment/);
    expect(teamPackTypes).not.toMatch(/export interface Task\b/);
    expect(teamRuntimeResolver).toContain("teamPack.teamMode === 'pipeline'");
    expect(teamRuntimeResolver).toContain("teamPack.teamMode === 'parallel'");
    expect(teamRuntimeResolver).not.toMatch(/new Date|taskResult|assignedAt/);
    expect(taskAssignment).toContain('runtime.initialAgentId');
    expect(taskAssignment).not.toContain('fallbackAgentId');
    expect(taskAssignment).not.toContain('TaskAssignmentSource');
    const commandGuard = source('src/server/a2a/command-guard.ts');
    const teamPackLayer = source('src/lib/agent-context/layers/teamPackLayer.ts');
    const retiredCommunicationSurface = /\bCommunicationPolicy\b|\bresolveCommunicationPolicy\b|\bcommunicationPolicy\b|\bexplainBlock\b|\bgetEscalationTarget(?:FromMatrix)?\b/;
    expect(productionFiles.filter((path) => retiredCommunicationSurface.test(source(path)))).toEqual([]);
    expect(existsSync(resolve(process.cwd(), 'src/lib/team-runtime/resolveCommunicationPolicy.ts'))).toBe(false);
    expect(runtimeTypes).toContain('explainHandoffBlock(fromAgentId: string, toAgentId: string): string | undefined;');
    expect(runtimeBarrel).not.toMatch(/resolveCommunicationPolicy|CommunicationPolicy/);
    expect(commandGuard).toContain('runtime.explainHandoffBlock(');
    expect(commandGuard.match(/runtime\.explainHandoffBlock\(/g)).toHaveLength(1);
    expect(teamPackLayer).toMatch(/canReceiveFrom/);
    expect(teamPackLayer).toMatch(/canEscalateTo/);
  });

  it('keeps TeamPack membership on roles instead of a parallel Agent-Pack interface', () => {
    const teamPackRepo = source('src/server/repositories/team-pack-repo.ts');
    for (const retiredMethod of [
      'addRole',
      'removeRole',
      'assignAgentToPack',
      'removeAgentFromPack',
      'getAgentsForPack',
      'getPacksForAgent',
    ]) {
      expect(teamPackRepo).not.toMatch(new RegExp(`\\b${retiredMethod}\\b`));
    }
    expect(teamPackRepo).not.toContain('agent_team_pack');
    expect(
      productionTypeScriptFiles('src')
        .filter((path) => path !== 'src/server/db/migrate.ts')
        .filter((path) => /agent_team_pack/.test(source(path))),
    ).toEqual([]);

    const migrations = source('src/server/db/migrate.ts');
    expect(migrations).toContain('version: 78');
    expect(migrations).toContain('DROP TABLE IF EXISTS agent_team_pack');
  });

  it('keeps runtime repositories free of zero-consumer query and wrapper methods', () => {
    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');
    const retiredByOwner = {
      sessionRepo: [
        'findByAgentAndTask',
        'updateCliSessionId',
        'sealByTask',
        'sealByConversation',
        'countByAgentAndConversation',
        'listActiveByAgent',
        'findLatestActiveByAgent',
      ],
      invocationRepo: ['getActive', 'findLatestCompletedForAgent'],
      agentBindingRepo: ['listByNode'],
    } as const;

    for (const [owner, methods] of Object.entries(retiredByOwner)) {
      for (const method of methods) {
        expect(production).not.toMatch(new RegExp(`\\b${owner}\\.${method}\\b`));
      }
    }

    const repositorySources = [
      source('src/server/repositories/session-repo.ts'),
      source('src/server/repositories/invocation-repo.ts'),
      source('src/server/repositories/agent-binding-repo.ts'),
    ].join('\n');
    for (const methods of Object.values(retiredByOwner)) {
      for (const method of methods) {
        expect(repositorySources).not.toMatch(new RegExp(`\\b${method}\\s*\\(`));
      }
    }
  });

  it('keeps message and observability repositories on their aggregate read interfaces', () => {
    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');
    const retiredByOwner = {
      messageRepo: ['getByTask', 'getByAgent', 'countByConversation'],
      observationSpanRepo: ['listByTrace'],
      spanPayloadRepo: ['get'],
      proofLogRepo: ['getById'],
    } as const;
    const repositoryByOwner = {
      messageRepo: source('src/server/repositories/message-repo.ts'),
      observationSpanRepo: source('src/server/repositories/observation-span-repo.ts'),
      spanPayloadRepo: source('src/server/repositories/span-payload-repo.ts'),
      proofLogRepo: source('src/server/repositories/proof-log-repo.ts'),
    } as const;

    for (const [owner, methods] of Object.entries(retiredByOwner)) {
      for (const method of methods) {
        expect(production).not.toMatch(new RegExp(`\\b${owner}\\.${method}\\b`));
        expect(repositoryByOwner[owner as keyof typeof repositoryByOwner])
          .not.toMatch(new RegExp(`^  ${method}\\s*\\(`, 'm'));
      }
    }
  });

  it('keeps Message, Task, and Skill repositories free of dead helper interfaces', () => {
    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');
    const retiredByOwner = {
      messageRepo: ['appendTextChunk'],
      taskRepo: ['getByAgent', 'delete'],
      skillRepo: ['getRevisionByHash'],
    } as const;
    const repositoryByOwner = {
      messageRepo: source('src/server/repositories/message-repo.ts'),
      taskRepo: source('src/server/repositories/task-repo.ts'),
      skillRepo: source('src/server/repositories/skill-repo.ts'),
    } as const;

    for (const [owner, methods] of Object.entries(retiredByOwner)) {
      for (const method of methods) {
        expect(production).not.toMatch(new RegExp(`\\b${owner}\\.${method}\\b`));
        expect(repositoryByOwner[owner as keyof typeof repositoryByOwner])
          .not.toMatch(new RegExp(`^  ${method}\\s*\\(`, 'm'));
      }
    }
  });

  it('keeps Session, Invocation, and Skill repositories on their aggregate read interfaces', () => {
    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');
    const retiredByOwner = {
      sessionRepo: ['findActive'],
      invocationRepo: ['getByAgent'],
      skillRepo: ['getSkillIdsForAgent'],
    } as const;
    const repositoryByOwner = {
      sessionRepo: source('src/server/repositories/session-repo.ts'),
      invocationRepo: source('src/server/repositories/invocation-repo.ts'),
      skillRepo: source('src/server/repositories/skill-repo.ts'),
    } as const;

    for (const [owner, methods] of Object.entries(retiredByOwner)) {
      for (const method of methods) {
        expect(production).not.toMatch(new RegExp(`\\b${owner}\\.${method}\\b`));
        expect(repositoryByOwner[owner as keyof typeof repositoryByOwner])
          .not.toMatch(new RegExp(`^  ${method}\\s*\\(`, 'm'));
      }
    }
  });

  it('keeps WorkContract row and task-authority queries internal to the repository', () => {
    const repository = source('src/server/work-contract/repository.ts');
    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');

    expect(repository).not.toMatch(
      /^  (?:(?:public|private|protected)\s+)?getContract\s*(?:\(|=)/m,
    );
    expect(production).not.toMatch(/\bworkContractRepo\.getContract\b/);
    expect(repository).toMatch(/^  private getContractRow\s*\(/m);
    expect(repository).toMatch(/^  private listActiveAuthoritiesForTask\s*\(/m);
    expect(repository).not.toMatch(/^  getContractRow\s*\(/m);
    expect(repository).not.toMatch(/^  listActiveAuthoritiesForTask\s*\(/m);
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
    const productionFiles = productionTypeScriptFiles('src');
    const runtimeIdentityFiles = [
      'src/server/types.ts',
      'src/lib/team-runtime/types.ts',
      'src/server/daemon.ts',
      'src/server/invocation-pipeline/context-planner.ts',
    ];
    const retiredGeminiRuntime = /['"]gemini(?:-cli)?['"]/;
    expect(runtimeIdentityFiles.filter((path) => retiredGeminiRuntime.test(source(path)))).toEqual([]);
    expect(productionFiles.filter((path) => /\bCliEngine\b/.test(source(path)))).toEqual([]);
    expect(source('src/server/types.ts')).toContain('engine: RuntimeCliEngine;');
    expect(taskHubStore).not.toMatch(/export type \{[^}]*CliEngine/);
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

  it('keeps Task Graph row lookup details private to repository writes and aggregate reads', () => {
    const repository = source('src/server/repositories/task-graph-repo.ts');
    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');
    for (const retired of [
      'getEdgeById',
      'getArtifactById',
      'getBindingById',
      'listBindings',
      'listActions',
      'listArtifacts',
      'TaskGraphCommitRow',
    ]) {
      expect(repository).not.toMatch(new RegExp(`\\b${retired}\\b`));
      expect(production).not.toMatch(new RegExp(`\\btaskGraphRepo\\.${retired}\\b`));
    }
    expect(repository).toContain('export interface TaskGraphCommitRecord');
    expect(repository).toContain("ORDER BY created_at ASC, id ASC");
  });

  it('keeps WebUI notices read-only and removes the legacy Supervisor vocabulary', () => {
    expect(taskHubStore).not.toContain('SupervisorOutput');
    expect(taskHubStore).not.toContain('supervisor.output');
    expect(deliveryApi).not.toContain('Delivery supervisor');
    expect(githubIngress).not.toContain('resolveSupervisor');
    expect(githubIngress).not.toContain('supervisor');
  });

  it('keeps retired test-only and zero-consumer interfaces out of production source', () => {
    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');
    for (const retired of [
      'WorkflowStepStatus',
      'TeamRole',
      'A2APass',
      'PassBlockPhase',
      'getTaskCounter',
      'takeInFlightDispatch',
      'clearInFlightDispatch',
      'InFlightDispatch',
      'inFlightDispatches',
      'nextTaskStatuses',
      'listCredentialIds',
      'deleteRoleCard',
      'isThinkingCaptureEnabled',
      'ATH_OBSERVABILITY_CAPTURE_THINKING',
      'HOST_THOUGHT_ONLY_OPENCODE_MODEL',
      'fingerprintCurrentInputs',
      'createCodeChangePermissionPolicy',
      'packageFromLegacyInput',
      'stopTaskWatcher',
    ]) {
      expect(production).not.toMatch(new RegExp(`\\b${retired}\\b`));
    }
  });

  it('keeps A2A, ACP, delivery, and role-card scan implementation types private', () => {
    const internalByOwner: Record<string, string[]> = {
      'src/server/a2a/collaboration.ts': [
        'A2APassGroupStatus',
        'A2APassGroup',
        'A2AAggregatePass',
        'A2ACollaborationRepositoryOptions',
      ],
      'src/server/a2a/command-guard.ts': [
        'A2ACommandGuardBranch',
        'A2ACommandGuardInput',
        'A2ACommandGuardOptions',
      ],
      'src/server/a2a/human-command-service.ts': [
        'HumanHandoffCommand',
        'HumanHandoffResult',
        'HumanA2ACommandServiceOptions',
      ],
      'src/server/a2a/types-possession.ts': [
        'PossessionHolderType',
        'PossessionChainStatus',
        'PossessionStatus',
      ],
      'src/server/acp-skill-mcp.ts': ['AcpSkillToolDefinition', 'AcpSkillMcpScope'],
      'src/server/agent/acp/acpBackend.ts': ['AcpFailureReasonCode', 'AcpRuntimeLimits'],
      'src/server/agent/acp/execOptions.ts': ['AcpExecOptionsInput'],
      'src/server/agent/acp/permissionPolicy.ts': [
        'AcpPermissionDecision',
        'AutonomousAcpAuthorization',
      ],
      'src/server/agent/acp/runtimeSetup.ts': ['PreparedRuntime', 'PrepareAcpOptions'],
      'src/server/autonomous-delivery/advancement-queue.ts': [
        'DeliveryAdvancementRequestQueueOptions',
      ],
      'src/server/autonomous-delivery/control-command-adapter.ts': [
        'ProductionControlCommandAdapterOptions',
      ],
      'src/server/autonomous-delivery/control-decision-repository.ts': [
        'PersistedControlActionStatus',
        'PersistedControlDecisionRow',
      ],
      'src/server/autonomous-delivery/control-decision.ts': [
        'ControlActionType',
        'RetryBudgetSnapshot',
        'WorkCellControlState',
      ],
      'src/server/autonomous-delivery/control-process-manager.ts': [
        'DeliveryControlProcessManagerOptions',
        'ControlReconcileResult',
      ],
      'src/server/autonomous-delivery/control-runtime.ts': ['DeliveryControlRuntimeOptions'],
      'src/server/autonomous-delivery/control-snapshot-builder.ts': [
        'ControlSnapshotRetryLimits',
        'RepositoryControlSnapshotBuilderOptions',
      ],
      'src/server/autonomous-delivery/delivery-effects.ts': [
        'DeliveryIntegrationEffectPayload',
        'RegisterDeliveryEffectsOptions',
      ],
      'src/server/autonomous-delivery/provider-actions.ts': [
        'ProviderCommandResult',
        'ProviderIntegrationObservation',
      ],
      'src/server/autonomous-delivery/types.ts': ['GitHubIssueGoalSource'],
      'src/server/autonomous-delivery/verification-receipt.ts': ['VerificationReceiptCandidate'],
      'src/server/autonomous-delivery/wait-for-graph.ts': ['WaitForDeadlock'],
      'src/server/security-scanner.ts': ['ScanResult', 'SecurityScanner', 'securityScanner'],
    };

    for (const [owner, names] of Object.entries(internalByOwner)) {
      const publicNames = exportedSurface(owner);
      for (const name of names) expect(publicNames).not.toContain(name);
    }

    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');
    expect(production).not.toMatch(/\binterface\s+SecurityScanner\b/);
    expect(production).not.toMatch(/\bsecurityScanner\.scan\b/);
    expect(source('src/server/security-scanner.ts')).toContain(
      'export function scanRoleCardContent',
    );
    expect(source('src/server/role-card-import.ts')).toContain(
      'scanRoleCardContent(parsed.soulContent)',
    );
  });

  it('keeps ACP mapping, permission, and session diagnostics behind formal interfaces', () => {
    const internalByOwner: Record<string, string[]> = {
      'src/server/agent/acp/agentEventMapper.ts': ['mapAcpUpdate'],
      'src/server/agent/acp/permissionPolicy.ts': ['createAutonomousWorkPermissionPolicy'],
      'src/server/agent/acp/acpBackend.ts': [
        'sanitizeAcpDiagnostic',
        'isAcpResourceNotFound',
        'describeAcpSessionLoadFailure',
      ],
    };

    for (const [owner, names] of Object.entries(internalByOwner)) {
      const publicNames = exportedSurface(owner);
      for (const name of names) expect(publicNames).not.toContain(name);
    }

    expect(exportedSurface('src/server/agent/acp/agentEventMapper.ts')).toContain(
      'createTurnScopedAcpEventMapper',
    );
    expect(exportedSurface('src/server/agent/acp/permissionPolicy.ts')).toContain(
      'createWorkContractPermissionPolicy',
    );
    expect(exportedSurface('src/server/agent/acp/acpBackend.ts')).toContain('AcpBackend');
    expect(exportedSurface('src/server/agent/acp/acpBackend.ts')).toContain(
      'getActiveAcpRunCount',
    );
  });

  it('keeps scalar lookups and state-machine helpers behind their owning modules', () => {
    expect(exportedSurfaceFromText('object-alias.ts', `
      const getPhaseById = () => undefined;
      const getAgentById = () => undefined;
      export const api = { lookup: getPhaseById };
      export default { find: getAgentById };
    `)).toEqual(new Set(['api', 'lookup', 'getPhaseById', 'find', 'getAgentById']));

    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');
    for (const retired of ['closeDb', 'assertInvocationOutcome', 'deletePhasesByConversation']) {
      expect(production).not.toMatch(new RegExp(`\\b${retired}\\b`));
    }

    const internalByOwner: Record<string, string[]> = {
      'src/server/repositories/invocation-repo.ts': [
        'INVOCATION_STATUSES',
        'INVOCATION_OUTCOMES',
        'InvocationTransition',
        'InvalidInvocationTransitionError',
        'InvalidInvocationStatusError',
        'StaleInvocationTransitionError',
        'InvalidInvocationOutcomeError',
        'assertInvocationStatus',
        'canTransitionInvocation',
      ],
      'src/server/db/phaseQueries.ts': ['getPhaseById'],
      'src/server/db/agentQueries.ts': ['getAgentById'],
      'src/server/agent/acp/acpBackend.ts': ['acpSessionMeta'],
      'src/server/work-contract/dispatch-contract.ts': ['deriveWorkId'],
      'src/server/task-flow/task-notification-publisher.ts': ['emitTaskState'],
      'src/server/task-file-watcher.ts': ['resolveTaskStorageIds'],
      'src/server/worktree-gc.ts': ['runWorktreeGC'],
      'src/server/invocation-pipeline/registry.ts': ['submitAgentActivation'],
    };

    for (const [owner, names] of Object.entries(internalByOwner)) {
      const publicNames = exportedSurface(owner);
      for (const name of names) {
        expect(publicNames).not.toContain(name);
      }
    }
  });

  it('keeps test adapters outside production modules and leaf helpers internal', () => {
    expect(existsSync(resolve(process.cwd(), 'src/server/agent/acp/mockAcpAgent.ts'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/server/github-issue-hook/test-fixtures.ts'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/test-helpers/acp/mockAcpAgent.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/test-helpers/github-issue-hook.ts'))).toBe(true);
    expect(nextConfig).toContain("'src/test-helpers/**/*'");
    expect(nextConfig).toContain("'src/**/*.test.ts'");
    expect(nextConfig).toContain("'src/**/*.test.tsx'");
    expect(
      productionTypeScriptFiles('src/server').filter((path) => /(?:mock|fixture)/i.test(path)),
    ).toEqual([]);

    const productionImportsTestHelpers = productionTypeScriptFiles('src')
      .filter((path) => !path.startsWith('src/test-helpers/'))
      .filter((path) => /['"][^'"]*test-helpers\//.test(source(path)));
    expect(productionImportsTestHelpers).toEqual([]);

    const internalByOwner: Record<string, string[]> = {
      'src/store/daemonStore.ts': [
        'getBrowserRuntimeNodeId',
        'scheduleBufferFlush',
        'flushStreamBufferForMessage',
        'appendToStreamBuffer',
      ],
      'src/components/task-hub/TokenSummary.tsx': ['TokenSummaryCard'],
      'src/server/autonomous-delivery/context-contributor.ts': ['AutonomousDeliveryContextContributor'],
      'src/server/platform-events/agent-inbox.ts': ['AGENT_INBOX_STATUSES'],
      'src/server/platform-events/types.ts': ['RUNTIME_LIFECYCLE_EVENT_TYPES'],
      'src/server/github-issue-hook/signature.ts': ['MAX_GITHUB_WEBHOOK_BYTES'],
      'src/server/error-messages.ts': ['ERROR_MESSAGES'],
      'src/server/evaluation/defaults.ts': ['DEFAULT_RUBRIC_ID', 'DEFAULT_DATASET_ID'],
      'src/server/engineering-collaboration/github-cli-verifier.ts': ['GitProviderVerificationError'],
      'src/server/project-context/manifest-validation.ts': ['digestProjectContextManifest'],
      'src/server/autonomous-delivery/repository.ts': [
        'InvalidDeliveryRunTransitionError',
        'InvalidDeliveryRunStateError',
        'DeliveryRunIdempotencyConflictError',
        'ActiveDeliveryRunConflictError',
        'DeliveryReceiptIdempotencyConflictError',
      ],
      'src/server/autonomous-delivery/control-decision-repository.ts': ['ControlDecisionConflictError'],
      'src/server/repositories/execution-envelope-repo.ts': [
        'InvalidExecutionEnvelopeTransitionError',
        'StaleExecutionEnvelopeTransitionError',
        'InvalidExecutionEnvelopeReasonError',
      ],
    };

    for (const [owner, names] of Object.entries(internalByOwner)) {
      const publicNames = exportedSurface(owner);
      for (const name of names) expect(publicNames).not.toContain(name);
    }
  });

  it('keeps strict-unused production placeholders retired', () => {
    const daemonSource = source('src/server/daemon.ts');
    expect(daemonSource).not.toContain('publishTerminalOutput');
    expect(daemonSource).not.toContain('runtimeStartedAtMs');
    expect(daemonSource).not.toContain("import { autonomousDeliveryRepo }");

    expect(source('src/pages/api/team-packs/[packId].ts')).not.toContain('interface UpdateInput');
    expect(source('src/components/task-hub/AgentBindingPanel.tsx')).not.toContain('agentName: string');
    expect(source('src/components/role-card/RoleCardListPage.tsx')).not.toContain('onClose: () => void');
    expect(source('src/lib/agent-context/layers/roleLayer.ts')).toMatch(
      /buildRoleLayer\(roleCard\?: RoleCard\)/,
    );

    const outboxSource = source('src/server/platform-events/durable-effect-outbox.ts');
    expect(outboxSource).not.toMatch(/private fail\([\s\S]*?registration:/);
  });

  it('keeps Workdir and Worktree implementation details behind their owners', () => {
    const workdirSource = source('src/server/workdir-manager.ts');
    const production = productionTypeScriptFiles('src').map((path) => source(path)).join('\n');

    for (const retired of ['refreshContextFiles', '.ath-role.md', '.ath-team.md', 'activeDirs', '.session.json']) {
      expect(production).not.toContain(retired);
    }
    for (const retired of ['writeSessionMeta', 'readSessionMeta', 'SessionMeta']) {
      expect(production).not.toMatch(new RegExp(`\\b${retired}\\b`));
    }

    expect(workdirSource).toMatch(/private async resolveProjectWorkdir\(/);
    expect(exportedSurface('src/server/workdir-manager.ts')).toEqual(expect.not.arrayContaining([
      'GCMeta',
      'safeWorkdirSegment',
    ]));
    expect(exportedSurface('src/server/worktree-manager.ts')).toEqual(expect.not.arrayContaining([
      'BRANCH_PREFIX',
      'WorktreeInfo',
    ]));
    expect(exportedSurface('src/server/workdir-manager.ts')).toContain('WorkdirManager');
    expect(exportedSurface('src/server/worktree-manager.ts')).toContain('WorktreeManager');
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
