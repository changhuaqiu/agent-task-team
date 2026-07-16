import { ContextManager } from '@/lib/agent-context/ContextManager';
import type { ChatMessage } from '@/store/types';
import { sessionRepo } from '../repositories/session-repo';
import { conversationRepo } from '../repositories/conversation-repo';
import { messageRepo, type MessageRow } from '../repositories/message-repo';
import { taskRepo } from '../repositories/task-repo';
import type { HarnessPlanResolution, HarnessPlanner, HarnessTrigger } from './types';
import { resolveConversationRuntimeProfile } from './conversation-runtime';
import { teamLogProjection } from '../team-log/TeamLogProjection';

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

    try {
      const { runtime, profile } = resolution;
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
        getSkills: async () => profile.prompt.skills,
        getCurrentLoad: () => Object.fromEntries(runtime.roster.map((agent) => [
          agent.id,
          taskRepo.getByConversation(trigger.conversationId)
            .filter((item) => item.agent_id === agent.id && item.status === 'in_progress').length,
        ])),
        getTeamLogEnvelope: async (conversationId, agentId, taskId) =>
          teamLogProjection.buildEnvelope(conversationId, agentId, taskId ? { taskId } : undefined),
      });
      const activeSession = sessionRepo.findActiveByConversation(trigger.agentId, trigger.conversationId);
      const contextTrigger = trigger.source === 'a2a'
        ? 'a2a_handoff' as const
        : trigger.source === 'user'
          ? (activeSession ? 'resume' as const : 'user_turn' as const)
          : 'resume' as const;
      const context = await manager.assembleContext({
        agentId: trigger.agentId,
        conversationId: trigger.conversationId,
        taskId: trigger.taskId,
        rawPrompt: trigger.prompt,
        trigger: contextTrigger,
        a2aHandoff: trigger.source === 'a2a' ? {
          title: trigger.fromAgentId ?? 'agent',
          requestedAction: trigger.prompt,
          possessionSummary: trigger.prompt,
          relevantDecisions: [],
          evidenceRefs: [],
          constraints: [],
          openQuestions: [],
          forbiddenBehaviors: [],
          sourceMessageIds: [],
        } : undefined,
        wakeup: trigger.wakeup,
        isFirstWake: trigger.source === 'user' && !activeSession,
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
        },
      };
    } catch (error) {
      return {
        ok: false,
        outcome: {
          status: 'failed',
          reasonCode: 'context_assembly_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
