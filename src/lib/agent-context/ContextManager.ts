// src/lib/agent-context/ContextManager.ts

import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/types';
import type { RuntimeAgent } from '@/lib/team-runtime';
import type { TeamPack } from '@/types/teamPack';
import { ContextBudget } from './ContextBudget';
import { composeWithBudget, type BudgetPart, type ContextTier } from './BudgetGuard';
import { buildRoleLayer } from './layers/roleLayer';
import { buildProjectLayer } from './layers/projectLayer';
import { buildProjectStatusLayer } from './layers/projectStatusLayer';
import { buildCollaborationLayer } from './layers/collaborationLayer';
import { renderAllTiers, type ContextAssemblyPart } from './tiers';
import { extractToolsFromSkills } from './skillTools';
import type { SkillSummary, ToolDefinition } from './types';
import { getDirective, resolveArchetype, type ContextArchetype, type ContextCluster } from './injectionPolicy';
import { resolveScenario, type ContextScenario } from './scenarioResolver';
import type { TeamLogEnvelope } from './teamLog';
import type { SkillCompileResult, SkillDeliveryDecision } from '@/lib/skills/types';
import {
  noOpMemoryHook,
  type MemoryArtifact,
  type MemoryHook,
} from './MemoryHook';
import { collectContextFragments } from './context-registry';
import { RequiredContextError } from './context-contracts';
import type {
  ContextArtifact,
  ContextContributor,
  ContextFragment,
  ContextOmission,
  ContextQuery,
  ContextSnapshot,
  ContextTrigger,
} from './context-contracts';

export { noOpMemoryHook } from './MemoryHook';
export { RequiredContextError } from './context-contracts';
export type {
  ContextArtifact,
  ContextContributor,
  ContextFragment,
  ContextOmission,
  ContextQuery,
  ContextSnapshot,
} from './context-contracts';

// Provider 层（P1 只返回 mock，预留接口）
export interface ContextProviders {
  getRoleCard(agentId: string): Promise<RoleCard | undefined>;
  getAllRoleCards(): Promise<RoleCard[]>;
  getMessages(conversationId: string, limit?: number): Promise<ChatMessage[]>;
  getTask(taskId: string): Promise<{
    id: string;
    title: string;
    conversationId: string;
    description?: string;
    phase?: { title: string };
  } | undefined>;
  getTasks(conversationId: string): Promise<{ id: string; title: string; agentId: string; status: string }[]>;
  getTeamPack(agentId: string): Promise<TeamPack | undefined>;
  getRuntimeRoster(conversationId: string): Promise<RuntimeAgent[] | undefined>;
  getSkills(): Promise<SkillSummary[]>;
  getSkillCompilation?(): Promise<SkillCompileResult>;
  getCurrentLoad(): Record<string, number>;  // P1: 当前负载 {agentId: taskCount}
  getTeamLogEnvelope?(conversationId: string, agentId: string, taskId?: string): Promise<TeamLogEnvelope>;
}

// 对外契约
export interface ContextRequest {
  agentId: string;
  conversationId: string;          // = projectId，作用域边界
  taskId?: string;                 // 主循环 dispatch 时带
  deliveryRunId?: string;          // 自主交付路径显式绑定，避免误取历史 Run
  rawPrompt: string;
  trigger: ContextTrigger;
  /** Explicit Team Harness scenario. Omit to use the legacy trigger resolver. */
  scenario?: ContextScenario;
  a2aHandoff?: A2AHandoffPacket;   // 仅 trigger='a2a_handoff' 时带
  wakeup?: {
    reasonCode: string;
    reasonSummary?: string;
    rootTaskId?: string;
    subtreeSize?: number;
    partial?: boolean;
  };
  isFirstWake: boolean;
  budgetOverride?: ContextBudget;  // 默认从 RoleCard / 项目配置推导
  project?: { id: string; name: string; path: string }; // P1 项目信息
  /** Exact platform tool names registered in the current runtime transport. */
  registeredToolNames?: string[];
}

// 健康度报告
export interface ContextReport {
  trigger: ContextTrigger;
  scenario: ContextScenario;
  archetype: ContextArchetype;
  includedClusters: ContextCluster[];
  omittedClusters: ContextCluster[];
  tokensUsed: number;
  tokensBudget: number;
  saturation: number;              // tokensUsed / tokensBudget
  layers: Array<{ layer: string; priority?: number; tier?: ContextTier; importance?: number; tokens: number; trimmed: boolean }>;
  p0Intact: boolean;               // P0 层是否完整未裁剪
  droppedLayers: string[];
  recalledArtifacts: number;       // 记忆命中数（本期恒 0）
  teamLogUpToEntryId?: string;
  loadedSkills: string[];
  eligibleSkills: Array<{ skillId: string; name: string; revision: string }>;
  activatedSkills: Array<{ skillId: string; name: string; revision: string; activationReason: string }>;
  skillDecisions: SkillDeliveryDecision[];
  availableTools: string[];
  snapshotId: string;
  fragmentCount: number;
  missingRequired: string[];
  omissions: ContextOmission[];
}

export interface AssembledContext {
  systemPrompt?: string;           // 仅首次唤醒
  userPrompt: string;
  report: ContextReport;
  snapshot: ContextSnapshot;
  sessionId: string;
}

export function filterRegisteredTools(
  declaredTools: ToolDefinition[],
  registeredToolNames: string[] | undefined,
): ToolDefinition[] {
  const registered = new Set(registeredToolNames ?? []);
  return declaredTools.filter(tool => registered.has(tool.name));
}

// A2A 交接包（P1 只定义类型，P2 接入）
export interface A2AHandoffPacket {
  title: string;
  requestedAction: string;
  possessionSummary: string;
  relevantDecisions: string[];
  evidenceRefs: string[];
  constraints: string[];
  openQuestions: string[];
  forbiddenBehaviors: string[];
  sourceMessageIds: string[];
  remainingBudget?: number;        // 预算元数据
}

export interface ContextManagerOptions {
  contributors?: ContextContributor[];
  now?: () => Date;
}

const FRAGMENT_POLICY: Record<ContextCluster, { tier: ContextTier; importance: number }> = {
  identity: { tier: 'system', importance: 0.9 },
  protocol: { tier: 'system', importance: 0.8 },
  capability: { tier: 'tool', importance: 0.6 },
  situation: { tier: 'project', importance: 0.6 },
  focus: { tier: 'project', importance: 0.8 },
  dialog: { tier: 'project', importance: 0.3 },
};

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function renderFragmentContent(fragment: ContextArtifact): string {
  if (typeof fragment.content === 'string') return fragment.content;
  return [
    fragment.content.summary,
    `Artifact: ${fragment.content.artifactRef}`,
  ].filter(Boolean).join('\n');
}

function legacyPartToFragment(
  part: ContextAssemblyPart,
  index: number,
  req: ContextRequest,
  observedAt: string,
): ContextFragment {
  const subject = (() => {
    if (['userMessage', 'history', 'teamLog', 'system'].includes(part.layer)) {
      return { kind: 'agent' as const, id: req.agentId };
    }
    if (['team', 'teamPack'].includes(part.layer)) {
      return { kind: 'team' as const, id: req.conversationId };
    }
    if (['project', 'projectStatus'].includes(part.layer)) {
      return { kind: 'project' as const, id: req.conversationId };
    }
    if (['task', 'a2a', 'wakeup'].includes(part.layer) && req.taskId) {
      return { kind: 'task' as const, id: req.taskId };
    }
    return { kind: 'agent' as const, id: req.agentId };
  })();
  return {
    id: `legacy:${index}:${part.layer}`,
    kind: `legacy.${part.layer}`,
    cluster: part.cluster,
    scope: { kind: 'project', projectId: req.conversationId },
    subject,
    producer: 'legacy-tier-adapter',
    version: 'legacy-assembly-v1',
    content: part.content,
    visibility: part.private
      ? { kind: 'agent', agentId: part.source ?? req.agentId }
      : { kind: 'team' },
    freshness: { observedAt },
    evidenceRefs: [],
    required: part.layer === 'userMessage' || part.layer === 'a2a',
  };
}

function createMemoryContributor(memoryHook: MemoryHook): ContextContributor {
  return {
    id: 'memory-hook',
    async contribute(query: ContextQuery): Promise<ContextFragment[]> {
      const artifacts = await memoryHook.recall({
        scope: query.conversationId,
        agentId: query.agentId,
        query: query.requestText,
        limit: 10,
      });
      return artifacts.map((artifact: MemoryArtifact) => ({
        id: `memory:${artifact.id}`,
        kind: `memory.${artifact.kind}`,
        cluster: artifact.kind === 'blocker' ? 'focus' : 'situation',
        scope: { kind: 'project', projectId: query.conversationId },
        subject: { kind: 'agent', id: query.agentId },
        producer: 'memory-hook',
        version: artifact.timestamp || query.now,
        content: artifact.content,
        visibility: { kind: 'agent', agentId: query.agentId },
        freshness: { observedAt: artifact.timestamp || query.now },
        evidenceRefs: artifact.evidence ? [artifact.evidence] : [],
      }));
    },
  };
}

function fragmentToBudgetPart(fragment: ContextArtifact): BudgetPart {
  const policy = FRAGMENT_POLICY[fragment.cluster];
  return {
    layer: `fragment:${fragment.producer}:${fragment.id}`,
    content: renderFragmentContent(fragment),
    tier: policy.tier,
    importance: policy.importance,
    scope: fragment.scope.kind === 'project'
      ? `/project/${fragment.scope.projectId}`
      : `/global/${fragment.scope.key}`,
    private: fragment.visibility.kind !== 'team',
    source: fragment.visibility.kind === 'agent' ? fragment.visibility.agentId : undefined,
  };
}

// ContextManager 实现
export class ContextManager {
  private providers: ContextProviders;
  private memoryHook: MemoryHook;
  private options: ContextManagerOptions;

  constructor(
    providers: ContextProviders,
    memoryHook: MemoryHook = noOpMemoryHook,
    options: ContextManagerOptions = {},
  ) {
    this.providers = providers;
    this.memoryHook = memoryHook;
    this.options = options;
  }

  async assembleContext(req: ContextRequest): Promise<AssembledContext> {
    const observedAt = (this.options.now?.() ?? new Date()).toISOString();

    // Provider 层：取原料（只读）
    const roleCard = await this.providers.getRoleCard(req.agentId);
    const allRoleCards = await this.providers.getAllRoleCards();
    const messages = await this.providers.getMessages(req.conversationId, 10);
    if (req.project?.id && req.project.id !== req.conversationId) {
      throw new Error(`context_scope_mismatch: project ${req.project.id}`);
    }
    const unscopedOrCrossProjectMessage = messages.find(
      message => message.conversationId !== req.conversationId,
    );
    if (unscopedOrCrossProjectMessage) {
      const reason = unscopedOrCrossProjectMessage.conversationId
        ? 'context_scope_mismatch'
        : 'context_scope_missing';
      throw new Error(`${reason}: message ${unscopedOrCrossProjectMessage.id}`);
    }
    const task = req.taskId ? await this.providers.getTask(req.taskId) : undefined;
    if (task && task.conversationId !== req.conversationId) {
      throw new Error(`context_scope_mismatch: task ${task.id}`);
    }
    const tasks = await this.providers.getTasks(req.conversationId);
    const teamPack = await this.providers.getTeamPack(req.agentId);
    const runtimeRoster = await this.providers.getRuntimeRoster(req.conversationId);
    const scenario = resolveScenario(req);
    const archetype = resolveArchetype(roleCard);
    const teamLogEnvelope = await this.providers.getTeamLogEnvelope?.(
      req.conversationId,
      req.agentId,
      scenario === 'handoff' || scenario === 'wakeup' || scenario === 'recovery' ? req.taskId : undefined,
    );

    // Layer 层：交给四层 tier 渲染器组装（system/knowledge/task/interaction）。
    // 每个 tier 内部复用 buildXxxLayer 并管自己的 push（gated by injectionPolicy）。
    const budget = req.budgetOverride ?? new ContextBudget();

    // Skills + tools — 在 tier 外预计算，report 也要用。
    const skillCompilation = this.providers.getSkillCompilation
      ? await this.providers.getSkillCompilation()
      : undefined;
    const providedSkills = skillCompilation ? [] : await this.providers.getSkills();
    const skillSummaries: SkillSummary[] = skillCompilation
      ? skillCompilation.activated.map(skill => ({
          id: skill.skillId,
          name: skill.name,
          description: skill.description,
          content: skill.body,
          revision: skill.revision,
          contentHash: skill.contentHash,
          resourceRefs: skill.resourceRefs,
          activationReason: skill.reason,
          required: skill.required,
          config: skill.config,
        }))
      : providedSkills.length
        ? providedSkills
        : (roleCard?.capabilities?.skills ?? []).map(skillName => ({ name: skillName, content: '' }));
    const declaredTools = extractToolsFromSkills(skillSummaries);
    const tools = filterRegisteredTools(declaredTools, req.registeredToolNames);
    // Semantic scenarios and session bootstrap are orthogonal. Legacy callers
    // keep their historical policy; explicit Team Harness scenarios bootstrap
    // identity on the first session without being collapsed back to `init`.
    const bootstrapIdentity = getDirective(scenario, archetype, 'identity') === 'include'
      || (req.isFirstWake && req.scenario !== undefined);

    const legacyParts = renderAllTiers({
      req,
      scenario,
      archetype,
      bootstrapIdentity,
      agentId: req.agentId,
      conversationId: req.conversationId,
      roleCard,
      allRoleCards: allRoleCards ?? [],
      messages,
      task,
      tasks,
      teamPack,
      runtimeRoster,
      skillSummaries,
      tools,
      teamLogEnvelope,
    });

    // Bootstrap system prompt remains a separate runtime channel, but it is
    // represented as a fragment so ContextSnapshot covers everything the
    // agent actually receives.
    let systemPrompt: string | undefined;
    if (bootstrapIdentity) {
      const rosterForStatus = (runtimeRoster ?? []).map((agent) => ({
        id: agent.id,
        name: agent.displayName,
        emoji: agent.emoji ?? '🤖',
      }));
      const projectStatus = tasks?.length
        ? buildProjectStatusLayer(rosterForStatus, tasks.map(item => ({
            ...item,
            status: item.status === 'pending' || item.status === 'in_progress' || item.status === 'done'
              ? item.status
              : 'pending' as const,
          })))
        : '';

      systemPrompt = [
        buildRoleLayer({ id: req.agentId, name: roleCard?.name ?? 'Agent' }, roleCard),
        getDirective(scenario, archetype, 'situation') === 'include'
          ? buildProjectLayer(req.project ?? { name: '', path: '', id: '' })
          : '',
        getDirective(scenario, archetype, 'protocol') === 'include' ? buildCollaborationLayer() : '',
        getDirective(scenario, archetype, 'situation') === 'include' ? projectStatus : '',
      ].filter(Boolean).join('\n\n');
    }

    const requiredSkillLayers = new Set(
      skillSummaries.filter(skill => skill.required).map(skill => `skill:${skill.id ?? skill.name}`),
    );
    const legacyFragments = legacyParts.map((part, index) => ({
      ...legacyPartToFragment(part, index, req, observedAt),
      required: part.layer === 'userMessage'
        || part.layer === 'a2a'
        || requiredSkillLayers.has(part.layer),
    }));
    const bootstrapFragmentId = 'legacy:bootstrap:system';
    if (systemPrompt) {
      legacyFragments.unshift({
        id: bootstrapFragmentId,
        kind: 'legacy.system-bootstrap',
        cluster: 'identity',
        scope: { kind: 'project', projectId: req.conversationId },
        subject: { kind: 'agent', id: req.agentId },
        producer: 'legacy-tier-adapter',
        version: 'legacy-assembly-v1',
        content: systemPrompt,
        visibility: { kind: 'agent', agentId: req.agentId },
        freshness: { observedAt },
        evidenceRefs: [],
        required: true,
      });
    }

    const query: ContextQuery = {
      scenario,
      trigger: req.trigger,
      conversationId: req.conversationId,
      agentId: req.agentId,
      archetype,
      taskId: req.taskId,
      deliveryRunId: req.deliveryRunId,
      requestText: req.rawPrompt,
      budgetTokens: budget.maxTokens,
      requiredContributorIds: req.deliveryRunId ? ['autonomous-delivery'] : [],
      now: observedAt,
    };
    const collection = await collectContextFragments(
      query,
      legacyFragments,
      [createMemoryContributor(this.memoryHook), ...(this.options.contributors ?? [])],
    );
    const scenarioOmissions: ContextOmission[] = [];
    const scenarioFragments = collection.artifacts.filter(fragment => {
      if (fragment.id === bootstrapFragmentId) return true;
      if (getDirective(scenario, archetype, fragment.cluster) === 'include') return true;
      scenarioOmissions.push({
        fragmentId: fragment.id,
        producer: fragment.producer,
        reason: 'scenario_omitted',
        detail: `${scenario}:${fragment.cluster}`,
        required: fragment.required === true,
      });
      return false;
    });

    const legacyPartByFragmentId = new Map<string, ContextAssemblyPart>();
    legacyParts.forEach((part, index) => {
      legacyPartByFragmentId.set(`legacy:${index}:${part.layer}`, part);
    });
    const fragmentByLayer = new Map<string, ContextArtifact>();
    const parts = scenarioFragments
      .filter(fragment => fragment.id !== bootstrapFragmentId)
      .map(fragment => {
        const part = legacyPartByFragmentId.get(fragment.id) ?? fragmentToBudgetPart(fragment);
        fragmentByLayer.set(part.layer, fragment);
        return part;
      });

    // Budget 层：复用 BudgetGuard
    const { prompt: userPrompt, report: budgetReport } = composeWithBudget(parts, budget);
    const budgetOmissions: ContextOmission[] = budgetReport.trimmed.map(layer => {
      const fragment = fragmentByLayer.get(layer);
      return {
        fragmentId: fragment?.id ?? layer,
        producer: fragment?.producer ?? 'context-budget',
        reason: 'budget_trimmed',
        detail: layer,
        required: fragment?.required === true,
      };
    });
    const omissions = [...collection.omissions, ...scenarioOmissions, ...budgetOmissions];

    const capabilityIncluded = getDirective(scenario, archetype, 'capability') === 'include';
    const skillDecisions: SkillDeliveryDecision[] = skillSummaries.map(skill => {
      const skillId = skill.id ?? skill.name;
      const layer = `skill:${skillId}`;
      const skillPart = parts.find(part => part.layer === layer);
      const layerPresent = Boolean(skillPart);
      const trimmed = budgetReport.trimmed.includes(layer);
      const outcome = !capabilityIncluded || !layerPresent ? 'omitted' : trimmed ? 'trimmed' : 'loaded';
      const reasonCode = !capabilityIncluded
        ? 'capability_policy_omitted'
        : !layerPresent
          ? 'skill_body_empty'
          : trimmed
            ? 'skill_body_trimmed'
            : 'compiled_into_context';
      return {
        skillId,
        name: skill.name,
        revision: skill.revision ?? 'legacy-unversioned',
        contentHash: skill.contentHash ?? 'legacy-unversioned',
        outcome,
        reasonCode,
        activationReason: skill.activationReason ?? 'agent_binding',
        tokens: skillPart ? Math.ceil(skillPart.content.length / 4) : 0,
      };
    });
    const missingRequiredSkill = skillSummaries.find(skill => {
      if (!skill.required || !capabilityIncluded) return false;
      const decision = skillDecisions.find(item => item.skillId === (skill.id ?? skill.name));
      return decision?.outcome !== 'loaded';
    });
    if (missingRequiredSkill) {
      throw new Error(`required_skill_not_loaded: ${missingRequiredSkill.name}`);
    }

    // Health 层：生成 ContextReport
    const systemLayers = parts.filter(p => p.tier === 'system');
    const p0Intact = systemLayers.every(l => !budgetReport.trimmed.includes(l.layer)); // system 层完整（字段名保留兼容）// 注：p0Intact 现指 system 层完整；userMessage 等 former-P0 已归 project 层

    const trimmedLayers = new Set(budgetReport.trimmed);
    const loadedFragments = scenarioFragments.filter(fragment => {
      if (fragment.id === bootstrapFragmentId) return true;
      const legacyPart = legacyPartByFragmentId.get(fragment.id);
      const layer = legacyPart?.layer ?? fragmentToBudgetPart(fragment).layer;
      return !trimmedLayers.has(layer);
    });
    const loadedFragmentIds = new Set(loadedFragments.map(fragment => fragment.id));
    const loadedProducers = new Set(loadedFragments.map(fragment => fragment.producer));
    const missingRequired = [...new Set([
      ...collection.requiredFragmentIds.filter(id => !loadedFragmentIds.has(id)),
      ...collection.requiredContributorIds
        .filter(id => !loadedProducers.has(id))
        .map(id => `contributor:${id}`),
    ])];
    if (missingRequired.length > 0) {
      throw new RequiredContextError(missingRequired, omissions);
    }
    const snapshotBase = {
      scenario: query.scenario,
      trigger: query.trigger,
      conversationId: query.conversationId,
      agentId: query.agentId,
      archetype: query.archetype,
      taskId: query.taskId,
      deliveryRunId: query.deliveryRunId,
      budgetTokens: query.budgetTokens,
      requiredContributorIds: query.requiredContributorIds,
      now: query.now,
      requestDigest: await digest(query.requestText),
    };
    const compiledPrompt = [systemPrompt, userPrompt].filter(Boolean).join('\n\n');
    const snapshot: ContextSnapshot = {
      id: `ctx_${await digest(JSON.stringify({
        query: snapshotBase,
        fragments: loadedFragments.map(fragment => ({
          id: fragment.id,
          kind: fragment.kind,
          semantic: fragment.semantic,
          version: fragment.version,
          scope: fragment.scope,
          subject: fragment.subject,
          visibility: fragment.visibility,
          source: fragment.source,
          lifecycle: fragment.lifecycle,
          consistency: fragment.consistency,
          delivery: fragment.delivery,
          evidenceRefs: fragment.evidenceRefs,
        })),
        omissions,
        capabilities: tools.map(tool => tool.name),
        constraints: [
          ...(req.a2aHandoff?.constraints ?? []),
          ...(req.a2aHandoff?.forbiddenBehaviors ?? []),
        ],
        compiledPromptDigest: await digest(compiledPrompt),
      }))}`,
      query: snapshotBase,
      fragmentRefs: loadedFragments.map(fragment => ({
        id: fragment.id,
        kind: fragment.kind,
        producer: fragment.producer,
        version: fragment.version,
        evidenceRefs: fragment.evidenceRefs,
        lifecycle: fragment.lifecycle.class,
        consistency: fragment.consistency,
        deliveryMode: fragment.delivery.mode,
        scope: fragment.scope,
        subject: fragment.subject,
        visibility: fragment.visibility,
        sourceOwner: fragment.source.owner,
        deliveryChannel: fragment.delivery.channel,
        importance: fragment.delivery.importance,
      })),
      capabilities: tools.map(tool => tool.name),
      constraints: [...new Set([
        ...(req.a2aHandoff?.constraints ?? []),
        ...(req.a2aHandoff?.forbiddenBehaviors ?? []),
      ])],
      missingRequired,
      omissions,
      compiledPrompt,
      createdAt: observedAt,
    };

    const report: ContextReport = {
      trigger: req.trigger,
      scenario,
      archetype,
      includedClusters: (['identity', 'protocol', 'capability', 'situation', 'focus', 'dialog'] as ContextCluster[])
        .filter(cluster => getDirective(scenario, archetype, cluster) === 'include'),
      omittedClusters: (['identity', 'protocol', 'capability', 'situation', 'focus', 'dialog'] as ContextCluster[])
        .filter(cluster => getDirective(scenario, archetype, cluster) === 'omit'),
      tokensUsed: budgetReport.totalTokens,
      tokensBudget: budget.maxTokens,
      saturation: budgetReport.totalTokens / budget.maxTokens,
      layers: parts.map(p => ({
        layer: p.layer,
        priority: p.priority,        // legacy 显示字段（tier-based 层为 undefined）
        tier: p.tier,                      // 结构层（spec §8）
        importance: p.importance,          // 裁剪排序键
        tokens: Math.ceil(p.content.length / 4),
        trimmed: budgetReport.trimmed.includes(p.layer),
      })),
      p0Intact,
      droppedLayers: [
        ...omissions
          .filter(item => item.reason !== 'budget_trimmed')
          .map(item => item.fragmentId),
        ...budgetReport.trimmed,
      ],
      recalledArtifacts: collection.artifacts.filter(fragment => fragment.producer === 'memory-hook').length,
      teamLogUpToEntryId: teamLogEnvelope?.upToEntryId,
      loadedSkills: skillDecisions.filter(decision => decision.outcome === 'loaded').map(decision => decision.name),
      eligibleSkills: (skillCompilation?.catalog ?? skillSummaries.map(skill => ({
        skillId: skill.id ?? skill.name,
        name: skill.name,
        description: skill.description ?? '',
        revision: skill.revision ?? 'legacy-unversioned',
      }))).map(skill => ({ skillId: skill.skillId, name: skill.name, revision: skill.revision })),
      activatedSkills: skillSummaries.map(skill => ({
        skillId: skill.id ?? skill.name,
        name: skill.name,
        revision: skill.revision ?? 'legacy-unversioned',
        activationReason: skill.activationReason ?? 'agent_binding',
      })),
      skillDecisions,
      availableTools: tools.map(tool => tool.name),
      snapshotId: snapshot.id,
      fragmentCount: snapshot.fragmentRefs.length,
      missingRequired: snapshot.missingRequired,
      omissions: snapshot.omissions,
    };

    return {
      systemPrompt,
      userPrompt,
      report,
      snapshot,
      sessionId: `${req.conversationId}-${req.agentId}`,
    };
  }
}
