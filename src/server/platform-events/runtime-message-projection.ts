import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { messageRepo } from '../repositories/message-repo';
import { sessionRepo } from '../repositories/session-repo';
import type { PlatformEventHandler } from './dispatcher';

export interface RuntimeMessageProjectionOptions {
  db?: Database.Database;
}

export class RuntimeMessageProjection {
  private readonly database?: Database.Database;

  constructor(options: RuntimeMessageProjectionOptions = {}) {
    this.database = options.db;
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (!event.type.startsWith('runtime.')) return;
    if (signal.aborted) throw signal.reason ?? new Error('runtime_message_projection_aborted');
    const content = this.messageContent(event);
    if (!content || !event.invocationId || !event.projectAgentId) return;
    const invocationId = event.invocationId;
    const projectAgentId = event.projectAgentId;
    const db = this.database ?? getDb();
    db.transaction(() => {
      const projected = db.prepare(
        `SELECT 1 FROM runtime_message_projection WHERE event_id=?`,
      ).get(event.eventId);
      if (projected) return;
      const evaluation = db.prepare(
        `SELECT 1 FROM eval_case_execution WHERE invocation_id=? LIMIT 1`,
      ).get(invocationId);
      let messageId: string | undefined;
      if (!evaluation) {
        const invocation = invocationRepo.getById(invocationId);
        messageId = messageRepo.append({
          conversationId: event.projectId,
          taskId: invocation?.task_id || undefined,
          senderType: 'agent',
          senderId: projectAgentId,
          content: content.text,
          contentType: content.type,
          invocationId,
          metadata: {
            sourceEventId: event.eventId,
            ...(content.metadata ?? {}),
          },
        });
        const logicalSessionId = event.subject?.type === 'logical_session'
          ? event.subject.id
          : invocation?.session_id;
        if (logicalSessionId) sessionRepo.incrementMessageCount(logicalSessionId);
      }
      db.prepare(`
        INSERT INTO runtime_message_projection (event_id,message_id,projected_at)
        VALUES (?, ?, ?)
      `).run(event.eventId, messageId ?? null, new Date().toISOString());
    }).immediate();
  };

  private messageContent(event: Parameters<PlatformEventHandler>[0]): {
    text: string;
    type: string;
    metadata?: Record<string, unknown>;
  } | undefined {
    if (event.type === 'runtime.message.segment.completed') {
      const payload = event.payload as { text?: string; segmentId?: string };
      if (!payload.text) return undefined;
      return {
        text: payload.text,
        type: 'text',
        metadata: { segmentId: payload.segmentId },
      };
    }
    if (event.type === 'runtime.tool.started') {
      const payload = event.payload as { toolName?: string; input?: string; callId?: string };
      if (!payload.toolName) return undefined;
      return {
        text: `🔧 使用工具：${payload.toolName}`,
        type: 'tool_use',
        metadata: {
          toolEvent: {
            type: 'tool_use',
            name: payload.toolName,
            input: payload.input?.slice(0, 500),
            callId: payload.callId,
          },
        },
      };
    }
    return undefined;
  }
}
