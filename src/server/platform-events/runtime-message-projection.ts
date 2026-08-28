import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { messageRepo, type MessageRow } from '../repositories/message-repo';
import { sessionRepo } from '../repositories/session-repo';
import type { PlatformEventHandler } from './dispatcher';
import { PlatformEventLog } from './event-log';

export interface RuntimeMessageProjectionOptions {
  db?: Database.Database;
  onProjected?: (message: MessageRow) => void;
}

export class RuntimeMessageProjection {
  private readonly database?: Database.Database;
  private readonly onProjected?: (message: MessageRow) => void;

  constructor(options: RuntimeMessageProjectionOptions = {}) {
    this.database = options.db;
    this.onProjected = options.onProjected;
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (!event.type.startsWith('runtime.')) return;
    if (signal.aborted) throw signal.reason ?? new Error('runtime_message_projection_aborted');
    const content = this.messageContent(event);
    if (!content || !event.invocationId || !event.projectAgentId) return;
    const invocationId = event.invocationId;
    const projectAgentId = event.projectAgentId;
    const db = this.database ?? getDb();
    const messageId = db.transaction(() => {
      const projected = db.prepare(
        `SELECT 1 FROM runtime_message_projection WHERE event_id=?`,
      ).get(event.eventId);
      if (projected) return undefined;
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
        if (content.type === 'text') {
          new PlatformEventLog({ db }).append({
            type: 'chat.message.persisted', category: 'domain', projectId: event.projectId,
            streamKey: `message:${messageId}`, aggregate: { type: 'message', id: messageId },
            actor: { type: 'agent', id: projectAgentId }, subject: { type: 'message', id: messageId },
            projectAgentId, invocationId,
            correlationId: event.correlationId, causationId: event.eventId,
            dedupeKey: `chat-message-persisted:${messageId}`,
            payload: { messageId, content: content.text, senderId: projectAgentId, contentType: content.type },
          });
        }
        const logicalSessionId = event.subject?.type === 'logical_session'
          ? event.subject.id
          : invocation?.session_id;
        if (logicalSessionId) sessionRepo.incrementMessageCount(logicalSessionId);
      }
      db.prepare(`
        INSERT INTO runtime_message_projection (event_id,message_id,projected_at)
        VALUES (?, ?, ?)
      `).run(event.eventId, messageId ?? null, new Date().toISOString());
      return messageId;
    }).immediate();
    if (messageId) {
      const message = messageRepo.getById(messageId);
      if (message && this.onProjected) {
        try {
          this.onProjected(message);
        } catch (error) {
          console.warn('[runtime-message-projection] post-persistence notification failed:', error);
        }
      }
    }
  };

  private messageContent(event: Parameters<PlatformEventHandler>[0]): {
    text: string;
    type: string;
    metadata?: Record<string, unknown>;
  } | undefined {
    if (event.type === 'runtime.thinking.segment.completed') {
      const payload = event.payload as { text?: string; segmentId?: string };
      if (!payload.text) return undefined;
      return {
        text: payload.text,
        type: 'thinking',
        metadata: { segmentId: payload.segmentId },
      };
    }
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
    if (event.type === 'runtime.tool.completed') {
      const payload = event.payload as { toolName?: string; output?: string; callId?: string };
      if (!payload.toolName) return undefined;
      return {
        text: payload.output?.slice(0, 500) || `已完成操作：${payload.toolName}`,
        type: 'tool_result',
        metadata: {
          toolEvent: {
            type: 'tool_result',
            name: payload.toolName,
            output: payload.output?.slice(0, 500),
            callId: payload.callId,
          },
        },
      };
    }
    if (event.type === 'runtime.tool.failed') {
      const payload = event.payload as {
        toolName?: string;
        message?: string;
        reasonCode?: string;
        callId?: string;
      };
      if (!payload.toolName) return undefined;
      return {
        text: payload.message?.slice(0, 500) || `操作失败：${payload.toolName}`,
        type: 'tool_result',
        metadata: {
          toolEvent: {
            type: 'error',
            name: payload.toolName,
            output: payload.message?.slice(0, 500),
            reasonCode: payload.reasonCode,
            callId: payload.callId,
          },
        },
      };
    }
    return undefined;
  }
}
