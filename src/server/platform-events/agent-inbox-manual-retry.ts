import type Database from 'better-sqlite3';
import { A2ACollaborationInvariantError } from '../a2a/errors';
import { HumanA2ACommandService } from '../a2a/human-command-service';
import { getDb } from '../db';
import {
  AgentInbox,
  AgentInboxCapacityError,
  AgentInboxConflictError,
  type AgentInboxItem,
} from './agent-inbox';

interface HumanA2ARetryPort {
  retry(command: {
    conversationId: string;
    messageId: string;
    retryId: string;
    prompt: string;
    targetAgentIds: string[];
    taskId?: string;
  }): {
    status: 'aborted' | 'offered';
    handoff?: { passes: Array<{ toAgentId: string; inboxItemId?: string }> };
  };
}

export class AgentInboxManualRetryError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
    readonly httpStatus: 409 | 422 | 429 = 409,
  ) {
    super(message);
    this.name = 'AgentInboxManualRetryError';
  }
}

export class AgentInboxManualRetryService {
  private readonly db: Database.Database;
  private readonly inbox: AgentInbox;
  private readonly humanA2A: HumanA2ARetryPort;

  constructor(options: {
    db?: Database.Database;
    inbox?: AgentInbox;
    humanA2A?: HumanA2ARetryPort;
  } = {}) {
    this.db = options.db ?? getDb();
    this.inbox = options.inbox ?? new AgentInbox({ db: this.db });
    this.humanA2A = options.humanA2A ?? new HumanA2ACommandService({ db: this.db });
  }

  retry(itemId: string): { item: AgentInboxItem; reissued: boolean } | undefined {
    const normalizedId = itemId.trim();
    if (!normalizedId) throw new AgentInboxManualRetryError(
      'inbox_item_id_required',
      'Inbox item id is required',
    );
    return this.db.transaction(() => {
      const failed = this.inbox.get(normalizedId);
      if (!failed) return undefined;
      if (failed.status === 'cancelled' && failed.lastError === 'manual_retry_reissued') {
        const replacement = this.inbox.getReissuedReplacement(failed.id);
        return replacement ? { item: replacement, reissued: true } : undefined;
      }
      if (failed.status !== 'expired') return undefined;
      if (failed.command.source !== 'a2a') {
        const released = this.inbox.retryExpired(normalizedId);
        return released ? { item: released, reissued: false } : undefined;
      }
      if (failed.command.fromAgentId !== 'human') {
        throw new AgentInboxManualRetryError(
          'a2a_retry_requires_source_recovery',
          'Agent 发起的协作失败需要由原负责人或控制面恢复',
        );
      }
      const sourceMessageId = failed.command.a2aHandoff?.sourceMessageIds?.[0]?.trim();
      if (!sourceMessageId) {
        throw new AgentInboxManualRetryError(
          'a2a_retry_source_message_missing',
          '原始用户消息不可用，无法安全重试',
        );
      }
      let handoff: ReturnType<HumanA2ARetryPort['retry']>;
      try {
        handoff = this.humanA2A.retry({
          conversationId: failed.projectId,
          messageId: sourceMessageId,
          retryId: failed.id,
          prompt: failed.command.a2aHandoff?.requestedAction?.trim() || failed.command.prompt,
          targetAgentIds: [failed.projectAgentId],
          taskId: failed.command.taskId,
        });
      } catch (error) {
        if (error instanceof A2ACollaborationInvariantError) {
          if (error.reasonCode === 'a2a_active_chain_exists') {
            throw new AgentInboxManualRetryError(
              'a2a_retry_active_work_exists',
              '当前 Project 已有 Agent 正在处理，请等待完成后再重试旧失败项',
            );
          }
          throw new AgentInboxManualRetryError(
            error.reasonCode,
            '当前协作配置已变化，无法按原目标重试，请检查 Project 成员和运行配置',
            422,
          );
        }
        if (error instanceof AgentInboxCapacityError) {
          throw new AgentInboxManualRetryError(
            error.reasonCode,
            '目标 Agent 的待处理队列已满，请稍后重试',
            429,
          );
        }
        if (error instanceof AgentInboxConflictError) {
          throw new AgentInboxManualRetryError(
            error.reasonCode,
            '重试请求与已存在的工作不一致，请刷新后重试',
          );
        }
        throw error;
      }
      const replacementId = handoff.status === 'offered'
        ? handoff.handoff?.passes.find((pass) => pass.toAgentId === failed.projectAgentId)?.inboxItemId
        : undefined;
      if (!replacementId) {
        throw new AgentInboxManualRetryError(
          'a2a_retry_replacement_missing',
          '重试未产生新的 Agent 工作',
        );
      }
      if (!this.inbox.markExpiredReissued(failed.id, replacementId)) return undefined;
      const replacement = this.inbox.get(replacementId);
      if (!replacement) throw new Error('replacement_inbox_item_not_found');
      return { item: replacement, reissued: true };
    }).immediate();
  }
}
