// src/server/a2a/index.ts
// Thin facade — delegates all logic to Orchestrator
import type Database from 'better-sqlite3';
import type { Server as IOServer } from 'socket.io';
import type { AgentMentionConfig, TaskSummary } from './types-v2';
import { Orchestrator } from './orchestrator';
import { taskRepo } from '../repositories/task-repo';

export interface KanbanSnapshotProvider {
  getTasks(conversationId: string): { id: string; title: string; status: string; agent_id: string }[];
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
  ) {
    const provider = snapshotProvider ?? defaultSnapshotProvider;
    this.orchestrator = new Orchestrator(db, io, agentConfigs, {
      getTasksForConversation: (conversationId: string): TaskSummary[] => {
        return provider.getTasks(conversationId).map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          agentId: t.agent_id,
        }));
      },
    });
  }

  async onAgentResponse(
    agentId: string,
    response: string,
    ctx: { conversationId: string; taskId?: string; triggerMessageId?: string; chainDepth: number; epochId?: string },
  ): Promise<void> {
    this.orchestrator.onAgentResponse(agentId, response, ctx.conversationId);
  }

  onUserMessage(conversationId: string, messageId: string, targetAgentId?: string, prompt?: string): void {
    this.orchestrator.onUserMessage(conversationId, messageId, targetAgentId, prompt);
  }

  expireStale(): number {
    return this.orchestrator.expireStaleChains();
  }
}

// Re-export types for backward compatibility
export type { AgentMentionConfig } from './types-v2';
