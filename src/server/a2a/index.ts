// src/server/a2a/index.ts
import type Database from 'better-sqlite3';
import type { Server as IOServer } from 'socket.io';
import { scanMentions } from './scanner';
import { shouldDeliver, recordPingPong } from './router';
import { MailboxRepo } from './mailbox';
import { buildA2ADispatchPrompt } from './queue';
import type { AgentMentionConfig, ResponseContext } from './types';

function hasSubstantiveWork(text: string): boolean {
  return text.includes('tool_use') || text.length > 200;
}

export class AgentMessenger {
  private mailbox: MailboxRepo;
  private agents: AgentMentionConfig[];

  constructor(
    private db: Database.Database,
    private io: IOServer,
    agentConfigs: AgentMentionConfig[],
  ) {
    this.mailbox = new MailboxRepo(db);
    this.agents = agentConfigs;
  }

  async onAgentResponse(
    agentId: string,
    response: string,
    ctx: ResponseContext,
  ): Promise<void> {
    // 1. Scan for @mentions
    const targets = scanMentions(response, this.agents, agentId);
    if (targets.length === 0) return;

    // 2. Record ping-pong state
    const substantive = hasSubstantiveWork(response);

    for (const target of targets) {
      // 3. Router check
      const decision = shouldDeliver({
        fromAgentId: agentId,
        toAgentId: target.agentId,
        chainDepth: ctx.chainDepth,
      });

      if (!decision.deliver) {
        this.io.emit('agent:event', {
          type: 'system',
          content: `A2A 投递被阻止：${decision.reason}`,
          conversationId: ctx.conversationId,
        });
        continue;
      }

      // 4. Write mailbox entry
      const entryId = `mb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const contextSnapshot = JSON.stringify({});

      this.mailbox.insert({
        id: entryId,
        conversationId: ctx.conversationId,
        fromAgentId: agentId,
        toAgentId: target.agentId,
        triggerMessageId: ctx.triggerMessageId,
        taskId: ctx.taskId,
        content: response,
        contextSnapshot,
        status: 'pending',
        chainDepth: ctx.chainDepth + 1,
        a2aFrom: agentId,
        source: 'a2a',
        createdAt: new Date().toISOString(),
      });

      // 5. Record ping-pong
      recordPingPong(agentId, target.agentId, substantive);

      // 6. Build prompt and emit socket event
      // NOTE: We construct the prompt inline rather than reading back from DB
      // because raw SQL returns snake_case but MailboxEntry uses camelCase
      const prompt = buildA2ADispatchPrompt({
        id: entryId,
        conversationId: ctx.conversationId,
        fromAgentId: agentId,
        toAgentId: target.agentId,
        content: response,
        contextSnapshot,
        status: 'pending',
        chainDepth: ctx.chainDepth + 1,
        a2aFrom: agentId,
        source: 'a2a',
        createdAt: new Date().toISOString(),
      });

      this.io.emit('a2a:dispatch', {
        agentId: target.agentId,
        prompt,
        referencedTaskId: ctx.taskId,
        fromAgentId: agentId,
        conversationId: ctx.conversationId,
      });

      // 7. Update mailbox status
      this.mailbox.updateStatus(entryId, 'delivered');
    }
  }

  expireStale(): number {
    return this.mailbox.expireStale(30 * 60 * 1000);
  }
}
