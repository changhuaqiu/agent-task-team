import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CommandReceipt, HumanCommand } from '@/lib/human-command/types';
import type { TeamRuntime } from '@/lib/team-runtime';
import { getDb } from '@/server/db';
import { HumanA2ACommandService } from '@/server/a2a/human-command-service';
import { resolveConversationRuntime } from '@/server/invocation-pipeline/conversation-runtime';
import { messageRepo } from '@/server/repositories/message-repo';
import { generateSortableId } from '@/server/repositories/sortable-id';
import { teamLogProjection } from '@/server/team-log/TeamLogProjection';
import { CollaborationKernel } from '@/server/collaboration-kernel';
import { PlatformEventLog } from '@/server/platform-events/event-log';

interface ReceiptRow {
  idempotency_key: string;
  request_digest: string;
  receipt_json: string;
}

interface ReplyMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  metadata: string | null;
}

interface HumanCommandServiceOptions {
  db?: Database.Database;
  now?: () => Date;
  idFactory?: () => string;
  resolveRuntime?: (deliveryId: string) => TeamRuntime | undefined;
  handoff?: Pick<HumanA2ACommandService, 'submit'>;
}

export class HumanCommandInvariantError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'HumanCommandInvariantError';
  }
}

export class HumanCommandIdempotencyConflictError extends HumanCommandInvariantError {
  constructor(readonly idempotencyKey: string) {
    super(
      'human_command_idempotency_conflict',
      `幂等键已绑定到另一条命令：${idempotencyKey}`,
    );
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function requestDigest(command: HumanCommand): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(command)))
    .digest('hex');
}

function normalizedPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HumanCommandInvariantError(
      'human_command_invalid',
      `${field} 不能为空`,
    );
  }
  return value.trim();
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new HumanCommandInvariantError(
      'human_command_invalid',
      `${field} 格式不正确`,
    );
  }
  return value.trim();
}

function objectValue(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export class HumanCommandService {
  private readonly database?: Database.Database;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly resolveRuntime: (deliveryId: string) => TeamRuntime | undefined;
  private readonly handoff?: Pick<HumanA2ACommandService, 'submit'>;

  constructor(options: HumanCommandServiceOptions = {}) {
    this.database = options.db;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => generateSortableId('human-command-receipt'));
    this.resolveRuntime = options.resolveRuntime ?? resolveConversationRuntime;
    this.handoff = options.handoff;
  }

  private db(): Database.Database {
    return this.database ?? getDb();
  }

  submit(command: HumanCommand): CommandReceipt {
    if (
      !command
      || (
        command.type !== 'delivery.requirement.submit'
        && command.type !== 'delivery.plan.request'
        && command.type !== 'task.progress.request'
      )
    ) {
      throw new HumanCommandInvariantError('human_command_type_unknown', '不支持的 Human Command');
    }
    if (command.type === 'delivery.plan.request') return this.submitPlan(command);
    if (command.type === 'task.progress.request') return this.submitTaskProgress(command);
    const idempotencyKey = nonEmpty(command.idempotencyKey, 'idempotencyKey');
    const projectPath = stringValue(command.projectPath, 'projectPath');
    const deliveryId = nonEmpty(command.deliveryId, 'deliveryId');
    const actorId = nonEmpty(command.actor?.id, 'actor.id');
    const content = nonEmpty(command.content, 'content');
    if (command.actor?.type !== 'user') {
      throw new HumanCommandInvariantError('human_command_actor_invalid', '补充要求必须由用户提交');
    }
    if (!Array.isArray(command.targetAgentIds) || command.targetAgentIds.some((id) => typeof id !== 'string')) {
      throw new HumanCommandInvariantError('human_command_targets_invalid', '目标成员列表格式不正确');
    }
    if (command.taskId !== undefined && (typeof command.taskId !== 'string' || !command.taskId.trim())) {
      throw new HumanCommandInvariantError('human_command_task_invalid', '任务引用格式不正确');
    }
    if (command.replyToMessageId !== undefined && (
      typeof command.replyToMessageId !== 'string' || !command.replyToMessageId.trim()
    )) {
      throw new HumanCommandInvariantError('human_command_reply_invalid', '回复目标格式不正确');
    }
    if (command.mentions !== undefined && (
      !Array.isArray(command.mentions)
      || command.mentions.some((mention) => typeof mention !== 'string')
    )) {
      throw new HumanCommandInvariantError('human_command_mentions_invalid', '成员引用格式不正确');
    }
    if (
      command.intent !== undefined
      && !['ideate', 'execute', 'review', 'general'].includes(command.intent)
    ) {
      throw new HumanCommandInvariantError('human_command_intent_invalid', '要求意图格式不正确');
    }
    if (typeof command.issuedAt !== 'string' || Number.isNaN(Date.parse(command.issuedAt))) {
      throw new HumanCommandInvariantError('human_command_issued_at_invalid', '命令时间格式不正确');
    }
    const normalizedTargets = [...new Set(command.targetAgentIds.map((id) => id.trim()).filter(Boolean))];
    const normalizedCommand: HumanCommand = {
      ...command,
      idempotencyKey,
      projectPath,
      deliveryId,
      actor: { type: 'user', id: actorId },
      content,
      targetAgentIds: normalizedTargets,
      ...(command.taskId ? { taskId: command.taskId.trim() } : {}),
      ...(command.replyToMessageId ? { replyToMessageId: command.replyToMessageId.trim() } : {}),
      ...(command.mentions ? { mentions: command.mentions.map((mention) => mention.trim()).filter(Boolean) } : {}),
    };
    const digest = requestDigest(normalizedCommand);
    const db = this.db();

    const receipt = db.transaction(() => {
      const existing = db.prepare(`
        SELECT idempotency_key,request_digest,receipt_json
        FROM human_command_receipt WHERE idempotency_key=?
      `).get(idempotencyKey) as ReceiptRow | undefined;
      if (existing) {
        if (existing.request_digest !== digest) {
          throw new HumanCommandIdempotencyConflictError(idempotencyKey);
        }
        return { ...JSON.parse(existing.receipt_json) as CommandReceipt, duplicate: true };
      }

      const conversation = db.prepare(`
        SELECT id,project_path FROM conversation WHERE id=?
      `).get(deliveryId) as { id: string; project_path: string | null } | undefined;
      if (!conversation) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'human_command_delivery_not_found',
          userMessage: '当前交付不存在或已被删除',
        }, null);
      }
      if (normalizedPath(conversation.project_path ?? '') !== normalizedPath(projectPath)) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'human_command_project_scope_mismatch',
          userMessage: '当前项目与命令目标不一致，请重新选择交付',
        });
      }

      if (normalizedCommand.taskId) {
        const task = db.prepare('SELECT conversation_id FROM task WHERE id=?')
          .get(normalizedCommand.taskId) as { conversation_id: string } | undefined;
        if (!task) {
          return this.recordReceipt(db, digest, normalizedCommand, {
            status: 'rejected',
            targetAgentIds: [],
            reasonCode: 'human_command_task_not_found',
            userMessage: '引用的任务不存在，请刷新后重试',
          });
        }
        if (task.conversation_id !== deliveryId) {
          return this.recordReceipt(db, digest, normalizedCommand, {
            status: 'rejected',
            targetAgentIds: [],
            reasonCode: 'human_command_task_scope_mismatch',
            userMessage: '引用的任务不属于当前交付',
          });
        }
      }

      let replyContext: {
        replyToMessageId: string;
        threadRootId: string;
        replyAuthor: string;
        replyPreview: string;
      } | undefined;
      if (normalizedCommand.replyToMessageId) {
        const reply = db.prepare(`
          SELECT id,conversation_id,sender_id,content,metadata
          FROM chat_message WHERE id=?
        `).get(normalizedCommand.replyToMessageId) as ReplyMessageRow | undefined;
        if (!reply) {
          return this.recordReceipt(db, digest, normalizedCommand, {
            status: 'rejected', targetAgentIds: [],
            reasonCode: 'human_command_reply_not_found',
            userMessage: '回复的消息不存在，请刷新后重试',
          });
        }
        if (reply.conversation_id !== deliveryId) {
          return this.recordReceipt(db, digest, normalizedCommand, {
            status: 'rejected', targetAgentIds: [],
            reasonCode: 'human_command_reply_scope_mismatch',
            userMessage: '回复的消息不属于当前项目',
          });
        }
        const replyMetadata = objectValue(reply.metadata);
        const existingRoot = replyMetadata.threadRootId;
        replyContext = {
          replyToMessageId: reply.id,
          threadRootId: typeof existingRoot === 'string' && existingRoot.trim()
            ? existingRoot.trim()
            : reply.id,
          replyAuthor: reply.sender_id === 'human' ? '你' : reply.sender_id,
          replyPreview: reply.content.replace(/\s+/g, ' ').trim().slice(0, 160),
        };
      }

      const runtime = this.resolveRuntime(deliveryId);
      if (!runtime) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'a2a_conversation_runtime_missing',
          userMessage: '当前交付的团队配置不可用',
        });
      }
      const roster = new Set(runtime.roster.map((agent) => agent.id));
      const invalidTarget = normalizedTargets.find((id) => !roster.has(id));
      if (invalidTarget) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'a2a_target_not_in_roster',
          userMessage: `成员 ${invalidTarget} 不属于当前交付团队`,
        });
      }
      const defaultTarget = runtime.initialAgentId && roster.has(runtime.initialAgentId)
        ? runtime.initialAgentId
        : runtime.roster[0]?.id;
      const targets = normalizedTargets.length > 0
        ? normalizedTargets
        : [defaultTarget].filter((id): id is string => Boolean(id));
      if (targets.length === 0) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'a2a_no_available_agent',
          userMessage: '当前交付没有可接手要求的团队成员',
        });
      }

      try {
        return db.transaction(() => {
          const messageId = messageRepo.append({
            conversationId: deliveryId,
            taskId: normalizedCommand.taskId,
            senderType: 'human',
            senderId: actorId,
            content,
            mentions: normalizedCommand.mentions,
            intent: normalizedCommand.intent ?? 'general',
            metadata: { source: 'human-command', idempotencyKey, ...(replyContext ?? {}) },
            projectTeamLog: false,
          }, db);
          new PlatformEventLog({ db }).append({
            type: 'chat.message.persisted', category: 'domain', projectId: deliveryId,
            streamKey: `message:${messageId}`, aggregate: { type: 'message', id: messageId },
            actor: { type: 'user', id: actorId }, subject: { type: 'message', id: messageId },
            correlationId: idempotencyKey, causationId: idempotencyKey,
            dedupeKey: `chat-message-persisted:${messageId}`,
            payload: { messageId, content, senderId: actorId, taskId: normalizedCommand.taskId },
          });
          const handoff = (this.handoff ?? new HumanA2ACommandService({ db })).submit({
            conversationId: deliveryId,
            messageId,
            prompt: replyContext
              ? `回复 ${replyContext.replyAuthor}：${replyContext.replyPreview}\n\n${content}`
              : content,
            targetAgentIds: targets,
            taskId: normalizedCommand.taskId,
          });
          if (handoff.status !== 'offered') {
            throw new HumanCommandInvariantError(
              'human_command_handoff_not_offered',
              '团队没有接纳这条要求',
            );
          }
          return this.recordReceipt(db, digest, normalizedCommand, {
            status: 'accepted',
            messageId,
            targetAgentIds: targets,
          });
        })();
      } catch (error) {
        if (
          error instanceof HumanCommandInvariantError
          && error.reasonCode === 'human_command_handoff_not_offered'
        ) {
          return this.recordReceipt(db, digest, normalizedCommand, {
            status: 'rejected',
            targetAgentIds: targets,
            reasonCode: error.reasonCode,
            userMessage: error.message,
          });
        }
        throw error;
      }
    }).immediate();
    if (receipt.status === 'accepted' && !receipt.duplicate) {
      teamLogProjection.materializeRegistered(deliveryId);
    }
    return receipt;
  }

  private submitPlan(command: Extract<HumanCommand, { type: 'delivery.plan.request' }>): CommandReceipt {
    const idempotencyKey = nonEmpty(command.idempotencyKey, 'idempotencyKey');
    const projectPath = stringValue(command.projectPath, 'projectPath');
    const deliveryId = nonEmpty(command.deliveryId, 'deliveryId');
    const actorId = nonEmpty(command.actor?.id, 'actor.id');
    if (command.actor?.type !== 'user') {
      throw new HumanCommandInvariantError('human_command_actor_invalid', '规划请求必须由用户提交');
    }
    if (typeof command.issuedAt !== 'string' || Number.isNaN(Date.parse(command.issuedAt))) {
      throw new HumanCommandInvariantError('human_command_issued_at_invalid', '命令时间格式不正确');
    }
    const normalizedCommand: HumanCommand = {
      ...command,
      idempotencyKey,
      projectPath,
      deliveryId,
      actor: { type: 'user', id: actorId },
    };
    const digest = requestDigest(normalizedCommand);
    const db = this.db();

    return db.transaction(() => {
      const existing = db.prepare(`
        SELECT idempotency_key,request_digest,receipt_json
        FROM human_command_receipt WHERE idempotency_key=?
      `).get(idempotencyKey) as ReceiptRow | undefined;
      if (existing) {
        if (existing.request_digest !== digest) {
          throw new HumanCommandIdempotencyConflictError(idempotencyKey);
        }
        return { ...JSON.parse(existing.receipt_json) as CommandReceipt, duplicate: true };
      }

      const conversation = db.prepare(`
        SELECT id,title,goal,project_path FROM conversation WHERE id=?
      `).get(deliveryId) as {
        id: string;
        title: string;
        goal: string | null;
        project_path: string | null;
      } | undefined;
      if (!conversation) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'human_command_delivery_not_found',
          userMessage: '当前交付不存在或已被删除',
        }, null);
      }
      if (normalizedPath(conversation.project_path ?? '') !== normalizedPath(projectPath)) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'human_command_project_scope_mismatch',
          userMessage: '当前项目与命令目标不一致，请重新选择交付',
        });
      }

      const runtime = this.resolveRuntime(deliveryId);
      const roster = runtime?.roster ?? [];
      const rosterIds = new Set(roster.map((agent) => agent.id));
      const targetAgentId = runtime?.initialAgentId && rosterIds.has(runtime.initialAgentId)
        ? runtime.initialAgentId
        : roster[0]?.id;
      if (!targetAgentId) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'a2a_no_available_agent',
          userMessage: '当前交付没有可负责规划的团队成员',
        });
      }

      const prompt = `请基于当前交付目标提出技术架构和业务方案，和用户确认后再拆分任务。\n\n交付：${conversation.title}\n目标：${conversation.goal ?? ''}${projectPath ? `\n项目路径：${projectPath}` : ''}`;
      new CollaborationKernel({ db, now: this.now }).request({
        projectId: deliveryId,
        targetAgentId,
        source: 'user',
        requestedAction: prompt,
        idempotencyKey: `human-command:${idempotencyKey}`,
        cause: {
          correlationId: idempotencyKey,
          causationId: idempotencyKey,
        },
        context: { scenario: 'planning' },
        policy: { rejectIfDeliveryOwned: true },
        replyTo: { type: 'human_command', id: idempotencyKey },
      });
      return this.recordReceipt(db, digest, normalizedCommand, {
        status: 'accepted',
        targetAgentIds: [targetAgentId],
      });
    }).immediate();
  }

  private submitTaskProgress(
    command: Extract<HumanCommand, { type: 'task.progress.request' }>,
  ): CommandReceipt {
    const idempotencyKey = nonEmpty(command.idempotencyKey, 'idempotencyKey');
    const projectPath = stringValue(command.projectPath, 'projectPath');
    const deliveryId = nonEmpty(command.deliveryId, 'deliveryId');
    const taskId = nonEmpty(command.taskId, 'taskId');
    const actorId = nonEmpty(command.actor?.id, 'actor.id');
    const request = nonEmpty(command.request, 'request');
    if (command.actor?.type !== 'user') {
      throw new HumanCommandInvariantError('human_command_actor_invalid', '进度请求必须由用户提交');
    }
    if (typeof command.issuedAt !== 'string' || Number.isNaN(Date.parse(command.issuedAt))) {
      throw new HumanCommandInvariantError('human_command_issued_at_invalid', '命令时间格式不正确');
    }
    const normalizedCommand: HumanCommand = {
      ...command,
      idempotencyKey,
      projectPath,
      deliveryId,
      taskId,
      actor: { type: 'user', id: actorId },
      request,
    };
    const digest = requestDigest(normalizedCommand);
    const db = this.db();

    return db.transaction(() => {
      const existing = db.prepare(`
        SELECT idempotency_key,request_digest,receipt_json
        FROM human_command_receipt WHERE idempotency_key=?
      `).get(idempotencyKey) as ReceiptRow | undefined;
      if (existing) {
        if (existing.request_digest !== digest) {
          throw new HumanCommandIdempotencyConflictError(idempotencyKey);
        }
        return { ...JSON.parse(existing.receipt_json) as CommandReceipt, duplicate: true };
      }

      const conversation = db.prepare(`
        SELECT id,project_path FROM conversation WHERE id=?
      `).get(deliveryId) as { id: string; project_path: string | null } | undefined;
      if (!conversation) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'human_command_delivery_not_found',
          userMessage: '当前交付不存在或已被删除',
        }, null);
      }
      if (normalizedPath(conversation.project_path ?? '') !== normalizedPath(projectPath)) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'human_command_project_scope_mismatch',
          userMessage: '当前项目与命令目标不一致，请重新选择交付',
        });
      }
      const task = db.prepare(`
        SELECT id,title,description,agent_id,conversation_id FROM task WHERE id=?
      `).get(taskId) as {
        id: string;
        title: string;
        description: string | null;
        agent_id: string;
        conversation_id: string;
      } | undefined;
      if (!task) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'human_command_task_not_found',
          userMessage: '引用的任务不存在，请刷新后重试',
        });
      }
      if (task.conversation_id !== deliveryId) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'human_command_task_scope_mismatch',
          userMessage: '引用的任务不属于当前交付',
        });
      }
      const runtime = this.resolveRuntime(deliveryId);
      if (!task.agent_id || !runtime?.roster.some((agent) => agent.id === task.agent_id)) {
        return this.recordReceipt(db, digest, normalizedCommand, {
          status: 'rejected',
          targetAgentIds: [],
          reasonCode: 'a2a_no_available_agent',
          userMessage: '当前任务没有可接收进度请求的负责人',
        });
      }

      new CollaborationKernel({ db, now: this.now }).request({
        projectId: deliveryId,
        targetAgentId: task.agent_id,
        source: 'user',
        requestedAction: `${request}\n\n任务：${task.id} ${task.title}\n${task.description ?? ''}`,
        idempotencyKey: `human-command:${idempotencyKey}`,
        cause: {
          correlationId: idempotencyKey,
          causationId: idempotencyKey,
        },
        scope: { taskId },
        context: { scenario: 'execution' },
        replyTo: { type: 'task', id: taskId },
      });
      return this.recordReceipt(db, digest, normalizedCommand, {
        status: 'accepted',
        targetAgentIds: [task.agent_id],
      });
    }).immediate();
  }

  private recordReceipt(
    db: Database.Database,
    digest: string,
    command: HumanCommand,
    result: Pick<CommandReceipt, 'status' | 'messageId' | 'targetAgentIds' | 'reasonCode' | 'userMessage'>,
    conversationId: string | null = command.deliveryId.trim(),
  ): CommandReceipt {
    const recordedAt = this.now().toISOString();
    const receipt: CommandReceipt = {
      idempotencyKey: command.idempotencyKey.trim(),
      commandType: command.type,
      projectPath: command.projectPath.trim(),
      deliveryId: command.deliveryId.trim(),
      status: result.status,
      duplicate: false,
      ...(result.messageId ? { messageId: result.messageId } : {}),
      ...('taskId' in command && command.taskId ? { taskId: command.taskId } : {}),
      targetAgentIds: [...result.targetAgentIds],
      ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
      ...(result.userMessage ? { userMessage: result.userMessage } : {}),
      recordedAt,
    };
    db.prepare(`
      INSERT INTO human_command_receipt (
        id,idempotency_key,request_digest,command_type,conversation_id,
        project_path,actor_type,actor_id,receipt_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      this.idFactory(),
      receipt.idempotencyKey,
      digest,
      receipt.commandType,
      conversationId,
      receipt.projectPath,
      command.actor.type,
      command.actor.id,
      JSON.stringify(receipt),
      recordedAt,
    );
    return receipt;
  }
}
