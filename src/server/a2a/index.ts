// src/server/a2a/index.ts
// Thin facade — delegates all logic to Orchestrator
import type Database from 'better-sqlite3';
import type { Server as IOServer } from 'socket.io';
import type { CommunicationPolicy } from '@/lib/team-runtime';
import type { AgentMentionConfig, TaskSummary } from './types-v2';
import { Orchestrator, type OrchestratorConfig } from './orchestrator';
import { taskRepo } from '../repositories/task-repo';
import { taskGraphRepo } from '../repositories/task-graph-repo';

export interface KanbanSnapshotProvider {
  getTasks(conversationId: string): {
    id: string;
    title: string;
    status: string;
    agent_id: string;
    dependencies?: string | string[] | null;
  }[];
  getCommunicationPolicy?: (conversationId: string) => CommunicationPolicy | undefined;
  getAgentMentionConfigs?: (conversationId: string) => AgentMentionConfig[] | undefined;
}

const defaultSnapshotProvider: KanbanSnapshotProvider = {
  getTasks(conversationId: string) {
    return taskRepo.getByConversation(conversationId);
  },
};

export class AgentMessenger {
  public orchestrator: Orchestrator;

  constructor(
    db: Database.Database,
    io: IOServer,
    agentConfigs: AgentMentionConfig[],
    snapshotProvider?: KanbanSnapshotProvider,
    submitDispatch?: NonNullable<OrchestratorConfig['submitDispatch']>,
    transactionalDispatchAdmission = false,
  ) {
    const provider = snapshotProvider ?? defaultSnapshotProvider;
    this.orchestrator = new Orchestrator(db, io, agentConfigs, {
      getTasksForConversation: (conversationId: string): TaskSummary[] => {
        const rows = provider.getTasks(conversationId);
        const dependencyIdsByTask = new Map<string, Set<string>>();
        for (const row of rows) {
          const dependencies = Array.isArray(row.dependencies)
            ? row.dependencies
            : (() => {
                if (!row.dependencies) return [];
                try {
                  const parsed = JSON.parse(row.dependencies);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return row.dependencies.split(',');
                }
              })();
          dependencyIdsByTask.set(
            row.id,
            new Set(dependencies.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())),
          );
        }
        for (const edge of taskGraphRepo.listEdges(conversationId)) {
          if (edge.type !== 'depends_on') continue;
          const dependencyIds = dependencyIdsByTask.get(edge.to_task_id) ?? new Set<string>();
          dependencyIds.add(edge.from_task_id);
          dependencyIdsByTask.set(edge.to_task_id, dependencyIds);
        }
        return rows.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          agentId: t.agent_id,
          dependencyIds: Array.from(dependencyIdsByTask.get(t.id) ?? []),
        }));
      },
      getCommunicationPolicy: provider.getCommunicationPolicy?.bind(provider),
      getAgentMentionConfigs: provider.getAgentMentionConfigs?.bind(provider),
      submitDispatch,
      transactionalDispatchAdmission,
    });
  }

  async onAgentResponse(
    agentId: string,
    response: string,
    ctx: { conversationId: string; taskId?: string; triggerMessageId?: string; chainDepth: number; epochId?: string },
  ): Promise<void> {
    this.orchestrator.onAgentResponse(agentId, response, ctx.conversationId, ctx.taskId);
  }

  onUserMessage(conversationId: string, messageId: string, targetAgentId?: string, prompt?: string): void {
    this.orchestrator.onUserMessage(conversationId, messageId, targetAgentId, prompt);
  }

  beginUserChain(conversationId: string, messageId: string): void {
    this.orchestrator.onUserMessage(conversationId, messageId);
  }

  registerExternalUserDispatch(
    conversationId: string,
    messageId: string,
    targetAgentIds: string[],
    prompt: string,
    taskId?: string,
  ): void {
    this.orchestrator.registerExternalUserDispatch(conversationId, messageId, targetAgentIds, prompt, taskId);
  }

  abortConversationChains(conversationId: string, reason: string): number {
    return this.orchestrator.abortActiveChains(conversationId, reason);
  }

  expireStale(): number {
    return this.orchestrator.expireStaleChains();
  }
}

// Re-export types for backward compatibility
export type { AgentMentionConfig } from './types-v2';
