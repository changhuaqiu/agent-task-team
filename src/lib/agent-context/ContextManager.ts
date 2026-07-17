// src/lib/agent-context/ContextManager.ts

import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/types';
import type { RuntimeAgent } from '@/lib/team-runtime';
import type { TeamPack } from '@/types/teamPack';
import { ContextBudget } from './ContextBudget';
import { composeWithBudget, type BudgetPart, type ContextTier } from './BudgetGuard';
import { buildRoleLayer } from './layers/roleLayer';
import { buildProjectLayer } from './layers/projectLayer';
import { buildTeamLayer } from './layers/teamLayer';
import { buildProjectStatusLayer } from './layers/projectStatusLayer';
import { buildHistoryLayer } from './layers/historyLayer';
import { buildTaskContextLayer } from './layers/taskContextLayer';
import { buildUserMessageLayer } from './layers/userMessageLayer';
import { buildBehaviorLayer } from './layers/behaviorLayer';
import { buildSkillLayer } from './layers/skillLayer';
import { buildToolLayer } from './layers/toolLayer';
import { buildProtocolLayer, deriveRoleFromCard } from './layers/protocolLayer';
import { buildA2ALayer } from './layers/a2aLayer';
import { buildTeamPackLayer } from './layers/teamPackLayer';
import { buildCollaborationLayer } from './layers/collaborationLayer';
import { extractToolsFromSkills } from './skillTools';
import type { SkillSummary, ToolDefinition } from './types';
import { getDirective, resolveArchetype, type ContextArchetype, type ContextCluster } from './injectionPolicy';
import { buildProtocolHint } from './protocolHints';
import { resolveScenario, type ContextScenario } from './scenarioResolver';
import { renderTeamLogEnvelope, type TeamLogEnvelope } from './teamLog';

// Provider 层（P1 只返回 mock，预留接口）
export interface ContextProviders {
  getRoleCard(agentId: string): Promise<RoleCard | undefined>;
  getAllRoleCards(): Promise<RoleCard[]>;
  getMessages(conversationId: string, limit?: number): Promise<ChatMessage[]>;
  getTask(taskId: string): Promise<{ id: string; title: string; description?: string; phase?: { title: string } } | undefined>;
  getTasks(conversationId: string): Promise<{ id: string; title: string; agentId: string; status: string }[]>;
  getTeamPack(agentId: string): Promise<TeamPack | undefined>;
  getRuntimeRoster(conversationId: string): Promise<RuntimeAgent[] | undefined>;
  getSkills(): Promise<SkillSummary[]>;
  getCurrentLoad(): Record<string, number>;  // P1: 当前负载 {agentId: taskCount}
  getTeamLogEnvelope?(conversationId: string, agentId: string, taskId?: string): Promise<TeamLogEnvelope>;
}

// Memory Hook（本期 NoOp）
export interface MemoryArtifact {
  id: string;
  kind: 'decision' | 'fact' | 'preference' | 'blocker';
  content: string;
  evidence?: string;
}

export interface MemoryHook {
  recall(input: {
    scope: string;
    agentId: string;
    query: string;
    limit?: number;
  }): Promise<MemoryArtifact[]>;
  write(artifact: {
    scope: string;
    agentId: string;
    kind: 'decision' | 'fact' | 'preference' | 'blocker';
    content: string;
    evidence?: string;
  }): Promise<void>;
}

// NoOp 实现
export const noOpMemoryHook: MemoryHook = {
  async recall() {
    return []; // 本期恒 0
  },
  async write() {
    // 本期 NoOp：直接 resolve
  },
};

// 对外契约
export interface ContextRequest {
  agentId: string;
  conversationId: string;          // = projectId，作用域边界
  taskId?: string;                 // 主循环 dispatch 时带
  rawPrompt: string;
  trigger: 'user_turn' | 'a2a_handoff' | 'resume';
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
  trigger: 'user_turn' | 'a2a_handoff' | 'resume';
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
  availableTools: string[];
}

export interface AssembledContext {
  systemPrompt?: string;           // 仅首次唤醒
  userPrompt: string;
  report: ContextReport;
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

// ContextManager 实现
export class ContextManager {
  private providers: ContextProviders;
  private memoryHook: MemoryHook;

  constructor(providers: ContextProviders, memoryHook: MemoryHook = noOpMemoryHook) {
    this.providers = providers;
    this.memoryHook = memoryHook;
  }

  async assembleContext(req: ContextRequest): Promise<AssembledContext> {
    // Provider 层：取原料（只读）
    const roleCard = await this.providers.getRoleCard(req.agentId);
    const allRoleCards = await this.providers.getAllRoleCards();
    const messages = await this.providers.getMessages(req.conversationId, 10);
    const task = req.taskId ? await this.providers.getTask(req.taskId) : undefined;
    const tasks = await this.providers.getTasks(req.conversationId);
    const teamPack = await this.providers.getTeamPack(req.agentId);
    const runtimeRoster = await this.providers.getRuntimeRoster(req.conversationId);
    const scenario = resolveScenario(req);
    const archetype = resolveArchetype(roleCard);
    const teamLogEnvelope = await this.providers.getTeamLogEnvelope?.(
      req.conversationId,
      req.agentId,
      scenario === 'handoff' || scenario === 'wakeup' ? req.taskId : undefined,
    );

    // Memory Hook：recall（本期 NoOp）
    const artifacts = await this.memoryHook.recall({
      scope: req.conversationId,
      agentId: req.agentId,
      query: req.rawPrompt,
      limit: 10,
    });

    // Layer 层：复用现有 15 个 buildXxxLayer
    const parts: BudgetPart[] = [];
    const budget = req.budgetOverride ?? new ContextBudget();

    const push = (
      cluster: ContextCluster,
      layer: string,
      content: string | null | undefined,
      opts: { tier: ContextTier; importance: number; scope?: string; private?: boolean },
    ) => {
      if (getDirective(scenario, archetype, cluster) === 'include' && content) {
        parts.push({ layer, content, ...opts });
      }
    };

    // Skills + tools (P3 — 能力，可按需 JIT)
    const providedSkills = await this.providers.getSkills();
    const skillSummaries: SkillSummary[] = providedSkills.length
      ? providedSkills
      : (roleCard?.capabilities?.skills ?? []).map(skillName => ({ name: skillName, content: '' }));
    const declaredTools = extractToolsFromSkills(skillSummaries);
    const tools = filterRegisteredTools(declaredTools, req.registeredToolNames);
    push('capability', 'skill', buildSkillLayer(skillSummaries), { tier: 'tool', importance: 0.6 });
    push('capability', 'tool', buildToolLayer(tools), { tier: 'tool', importance: 0.6 });

    // Team roster (P2)
    const runtimeTeam = runtimeRoster?.length
      ? [
          '## 当前团队',
          ...runtimeRoster.map((member) => {
            const marker = member.id === req.agentId ? '（当前角色）' : '';
            return `- ${member.displayName} @${member.id}${marker}`;
          }),
        ].join('\n')
      : '';
    const team = runtimeRoster !== undefined
      ? runtimeTeam
      : buildTeamLayer(req.agentId, allRoleCards ?? [], undefined);
    if (scenario !== 'wakeup') {
      push('situation', 'team', team, { tier: 'project', importance: 0.5, scope: '/project' });
    }

    push('situation', 'teamLog', teamLogEnvelope ? renderTeamLogEnvelope(teamLogEnvelope) : '', {
      tier: 'project',
      importance: 0.75,
      scope: '/project',
      private: true,
    });

    push('protocol', 'collaboration', buildCollaborationLayer(), { tier: 'system', importance: 0.8 });

    // TeamPack context (P1)
    if (teamPack && scenario !== 'wakeup') {
      push('situation', 'teamPack', buildTeamPackLayer(req.agentId, teamPack), { tier: 'project', importance: 0.6, scope: '/project' });
    }

    // Protocol layer (P0 — 约束，几乎不丢)
    const protocol = buildProtocolLayer({
      agentId: req.agentId,
      agentRole: deriveRoleFromCard(roleCard),
      projectPath: '', // P1 暂不传，待 TASK-004 升级
      hasTaskAssignment: !!task,
      isPlanner: roleCard?.category === 'planner',
    });
    const protocolHint = buildProtocolHint(scenario, req.wakeup);
    push('protocol', 'protocol', [protocol, protocolHint].filter(Boolean).join('\n\n'), { tier: 'system', importance: 0.8 });

    // History (P4 — GSSC：按 query 相关性筛选)
    // 可见性标签；filterVisible/assertVisibility 强制执行在 P2 接入（见 spec §9）
    push('dialog', 'history', buildHistoryLayer(messages, req.agentId, {
      query: req.rawPrompt,
      limit: 10,
    }), { tier: 'project', importance: 0.3, scope: `/project/${req.agentId}`, private: true });

    // Task context (P0)
    if (task) {
      push('focus', 'task', buildTaskContextLayer(task), { tier: 'project', importance: 0.8, scope: '/project' });
    }

    // A2A context (P1) or user message (P0)
    if (req.a2aHandoff) {
      push('focus', 'a2a', buildA2ALayer({
        a2aFrom: req.a2aHandoff.title,
        a2aContent: req.a2aHandoff.possessionSummary,
        a2aContextSnapshot: JSON.stringify({
          ...req.a2aHandoff,
          possessionSummary: undefined,
        }),
      }), { tier: 'project', importance: 0.7, scope: '/project' });
    } else {
      // 可见性标签；filterVisible/assertVisibility 强制执行在 P2 接入（见 spec §9）
      push('dialog', 'userMessage', buildUserMessageLayer(req.rawPrompt), { tier: 'project', importance: 0.9, scope: `/project/${req.agentId}`, private: true });
    }

    // Behavior (P0 — 闭环动作要求)
    push('protocol', 'behavior', buildBehaviorLayer(), { tier: 'system', importance: 0.7 });

    // Budget 层：复用 BudgetGuard
    const { prompt: userPrompt, report: budgetReport } = composeWithBudget(parts, budget);

    // Health 层：生成 ContextReport
    const systemLayers = parts.filter(p => p.tier === 'system');
    const p0Intact = systemLayers.every(l => !budgetReport.trimmed.includes(l.layer)); // system 层完整（字段名保留兼容）// 注：p0Intact 现指 system 层完整；userMessage 等 former-P0 已归 project 层

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
      droppedLayers: budgetReport.trimmed,
      recalledArtifacts: artifacts.length, // 本期恒 0
      teamLogUpToEntryId: teamLogEnvelope?.upToEntryId,
      loadedSkills: skillSummaries.map(skill => skill.name),
      availableTools: tools.map(tool => tool.name),
    };

    // System prompt（仅首次唤醒）
    let systemPrompt: string | undefined;
    if (getDirective(scenario, archetype, 'identity') === 'include') {
      const rosterForStatus = (runtimeRoster ?? []).map((a) => ({ id: a.id, name: a.displayName, emoji: a.emoji ?? '🤖' })); // 花名册由 provider 供给（§4 唯一耦合面）；全局 store 兜底已按设计移除

      const projectStatus = tasks?.length
        ? buildProjectStatusLayer(rosterForStatus, tasks.map(t => ({
            ...t,
            status: t.status === 'pending' || t.status === 'in_progress' || t.status === 'done'
              ? t.status
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
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    return {
      systemPrompt,
      userPrompt,
      report,
      sessionId: `${req.conversationId}-${req.agentId}`,
    };
  }
}
