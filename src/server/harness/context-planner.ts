import { ContextManager } from '@/lib/agent-context/ContextManager';
import type { ChatMessage } from '@/store/types';
import { sessionRepo } from '../repositories/session-repo';
import { conversationRepo } from '../repositories/conversation-repo';
import { messageRepo, type MessageRow } from '../repositories/message-repo';
import { taskRepo } from '../repositories/task-repo';
import type { HarnessPlanResolution, HarnessPlanner, HarnessReasonCode, HarnessTrigger } from './types';
import { resolveConversationRuntimeProfile } from './conversation-runtime';
import { teamLogProjection } from '../team-log/TeamLogProjection';
import { generateTraceId, observationSpanRepo } from '../repositories/observation-span-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { resolveExternalReferences } from './reference-resolver';
import { SkillRuntimeError, skillRuntime } from '../skills/skill-runtime';
import { skillRepo } from '../repositories/skill-repo';
import { getSupportedToolNames } from '../skill-tool-router';

const RUNTIME_IDS = {
  opencode: 'opencode-local',
  claude: 'claude-cli',
  codex: 'codex-cli',
  gemini: 'gemini-cli',
  mock: 'mock-runtime',
} as const;

function toChatMessage(row: MessageRow): ChatMessage {
  let metadata: Record<string, unknown> | undefined;
  let mentions: string[] | undefined;
  try { metadata = row.metadata ? JSON.parse(row.metadata) : undefined; } catch { /* invalid legacy metadata */ }
  try { mentions = row.mentions ? JSON.parse(row.mentions) : undefined; } catch { /* invalid legacy mentions */ }
  return {
    id: row.id,
    agentId: row.sender_type === 'human' ? 'human' : row.sender_type === 'system' ? 'system' : row.sender_id,
    content: row.content,
    timestamp: row.created_at,
    conversationId: row.conversation_id,
    referencedTaskId: row.task_id ?? undefined,
    mentions,
    intent: row.intent as ChatMessage['intent'],
    metadata,
  };
}

export class RepositoryHarnessPlanner implements HarnessPlanner {
  async prepare(trigger: HarnessTrigger): Promise<HarnessPlanResolution> {
    const conversation = conversationRepo.getById(trigger.conversationId);
    if (!conversation) {
      return { ok: false, outcome: { status: 'blocked', reasonCode: 'conversation_missing' } };
    }
    const task = trigger.taskId ? taskRepo.getById(trigger.taskId) : undefined;
    if (trigger.taskId && !task) {
      return { ok: false, outcome: { status: 'blocked', reasonCode: 'task_missing' } };
    }

    const resolution = resolveConversationRuntimeProfile(trigger.conversationId, trigger.agentId);
    if (!resolution?.runtime.roster.some((agent) => agent.id === trigger.agentId)) {
      return { ok: false, outcome: { status: 'blocked', reasonCode: 'agent_not_in_team' } };
    }
    if (!resolution.profile) {
      return { ok: false, outcome: { status: 'blocked', reasonCode: 'runtime_profile_missing' } };
    }
    const { runtime, profile } = resolution;
    const traceId = generateTraceId();
    const activeSession = sessionRepo.findActiveByConversation(trigger.agentId, trigger.conversationId);
    const isFirstWake = !activeSession;

    try {
      const boundSkillIds = profile.prompt.skills
        .map(skill => skill.id)
        .filter((skillId): skillId is string => Boolean(skillId));
      const skillCompilation = boundSkillIds.length > 0
        ? await skillRuntime.compile({ skillIds: boundSkillIds })
        : undefined;
      const manager = new ContextManager({
        getRoleCard: async () => profile.prompt.roleCard,
        getAllRoleCards: async () => runtime.roster.map((agent) => agent.roleCard).filter(Boolean) as NonNullable<typeof profile.prompt.roleCard>[],
        getMessages: async (conversationId, limit) => messageRepo
          .getByConversationAgent(conversationId, trigger.agentId, { limit: limit ?? 10 })
          .map(toChatMessage),
        getTask: async (taskId) => {
          const row = taskRepo.getById(taskId);
          return row ? { id: row.id, title: row.title, description: row.description ?? undefined } : undefined;
        },
        getTasks: async (conversationId) => taskRepo.getByConversation(conversationId).map((row) => ({
          id: row.id,
          title: row.title,
          agentId: row.agent_id,
          status: row.status,
        })),
        getTeamPack: async () => runtime.teamPack,
        getRuntimeRoster: async () => runtime.roster,
        getSkills: async () => profile.prompt.skills.map(skill => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          content: skill.content ?? '',
          files: skill.files,
          config: skill.config,
        })),
        ...(skillCompilation ? { getSkillCompilation: async () => skillCompilation } : {}),
        getCurrentLoad: () => Object.fromEntries(runtime.roster.map((agent) => [
          agent.id,
          taskRepo.getByConversation(trigger.conversationId)
            .filter((item) => item.agent_id === agent.id && item.status === 'in_progress').length,
        ])),
        getTeamLogEnvelope: async (conversationId, agentId, taskId) =>
          teamLogProjection.buildEnvelope(conversationId, agentId, taskId ? { taskId } : undefined),
      });
      const referenceResolution = await resolveExternalReferences({
        prompt: trigger.prompt,
        projectPath: conversation.project_path,
      });
      for (const record of referenceResolution.records) {
        proofLogRepo.append({
          eventType: record.status === 'resolved'
            ? 'context.reference.resolved'
            : 'context.reference.resolution_failed',
          conversationId: trigger.conversationId,
          taskId: trigger.taskId,
          chainId: trigger.chainId,
          passId: trigger.passId,
          agentId: trigger.agentId,
          reasonCode: record.reasonCode,
          metadata: { reference: record.reference, status: record.status, url: record.url },
        });
      }
      const contextTrigger = trigger.source === 'a2a'
        ? 'a2a_handoff' as const
        : trigger.source === 'user'
          ? (activeSession ? 'resume' as const : 'user_turn' as const)
          : 'resume' as const;
      const context = await manager.assembleContext({
        agentId: trigger.agentId,
        conversationId: trigger.conversationId,
        taskId: trigger.taskId,
        rawPrompt: referenceResolution.prompt,
        registeredToolNames: getSupportedToolNames(),
        trigger: contextTrigger,
        a2aHandoff: trigger.source === 'a2a' ? {
          title: trigger.fromAgentId ?? 'agent',
          requestedAction: referenceResolution.prompt,
          possessionSummary: referenceResolution.prompt,
          relevantDecisions: [],
          evidenceRefs: [],
          constraints: [],
          openQuestions: [],
          forbiddenBehaviors: [],
          sourceMessageIds: [],
        } : undefined,
        wakeup: trigger.wakeup,
        isFirstWake,
        project: {
          id: conversation.id,
          name: conversation.title,
          path: conversation.project_path ?? '',
        },
      });

      return {
        ok: true,
        plan: {
          trigger,
          engine: profile.execution.engine,
          accountId: profile.execution.accountId,
          runtimeId: profile.execution.runtimeId ?? RUNTIME_IDS[profile.execution.engine],
          systemPrompt: context.systemPrompt,
          prompt: context.userPrompt,
          projectPath: conversation.project_path ?? undefined,
          useWorktree: Boolean(conversation.use_worktree),
          contextScenario: context.report.scenario,
          teamLogUpToEntryId: context.report.teamLogUpToEntryId,
          traceId,
          contextReport: context.report,
        },
      };
    } catch (error) {
      const skillReasonCodes: HarnessReasonCode[] = [
        'required_skill_not_loaded', 'skill_manifest_invalid', 'skill_package_missing',
        'skill_path_invalid', 'skill_path_duplicate', 'skill_revision_mismatch',
      ];
      const reasonCode: HarnessReasonCode = error instanceof SkillRuntimeError
        && skillReasonCodes.includes(error.reasonCode as HarnessReasonCode)
        ? error.reasonCode as HarnessReasonCode
        : error instanceof Error && error.message.startsWith('required_skill_not_loaded')
          ? 'required_skill_not_loaded'
          : 'context_assembly_failed';
      if (reasonCode !== 'context_assembly_failed') {
        const decisions = profile.prompt.skills
          .filter((skill): skill is typeof skill & { id: string } => Boolean(skill.id))
          .map((skill) => {
            const revision = skillRepo.getActiveRevision(skill.id);
            return {
              skillId: skill.id,
              name: skill.name,
              revision: revision?.id ?? 'uninstalled',
              contentHash: revision?.content_hash ?? 'unknown',
              outcome: 'failed' as const,
              reasonCode,
              activationReason: 'agent_binding' as const,
              tokens: 0,
            };
          });
        try {
          const span = observationSpanRepo.start({
            traceId,
            name: 'context.compile',
            kind: 'context',
            conversationId: trigger.conversationId,
            taskId: trigger.taskId,
            agentId: trigger.agentId,
            chainId: trigger.chainId,
            passId: trigger.passId,
            attributes: {
              reasonCode,
              report: {
                scenario: isFirstWake ? 'init' : trigger.source === 'a2a' ? 'handoff' : 'iterate',
                tokensUsed: 0,
                tokensBudget: 0,
                saturation: 0,
                loadedSkills: [],
                eligibleSkills: decisions.map(({ skillId, name, revision }) => ({ skillId, name, revision })),
                activatedSkills: decisions.map(({ skillId, name, revision, activationReason }) => ({ skillId, name, revision, activationReason })),
                skillDecisions: decisions,
                availableTools: [],
              },
            },
          });
          observationSpanRepo.finish(span.span_id, 'error', { errorMessage: reasonCode });
          proofLogRepo.append({
            eventType: 'context.skill.failed',
            conversationId: trigger.conversationId,
            taskId: trigger.taskId,
            chainId: trigger.chainId,
            passId: trigger.passId,
            agentId: trigger.agentId,
            reasonCode,
            metadata: { traceId, skills: decisions.map(({ skillId, revision }) => ({ skillId, revision })) },
          });
        } catch {
          // Observability must not replace the authoritative dispatch failure.
        }
      }
      return {
        ok: false,
        outcome: {
          status: 'failed',
          reasonCode,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
