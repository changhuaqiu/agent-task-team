import { createHash } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Server as IOServer } from 'socket.io';
import type {
  WorkspaceCommand,
  WorkspaceCommandReceipt,
} from '@/lib/workspace-command';
import type { HumanCommand } from '@/lib/human-command';
import { getDb } from '@/server/db';
import {
  deletePhase as deletePersistedPhase,
  getPhaseById,
  upsertPhase as upsertPersistedPhase,
} from '@/server/db/phaseQueries';
import {
  HumanCommandIdempotencyConflictError,
  HumanCommandInvariantError,
  HumanCommandService,
} from '@/server/human-command/service';
import { ensureAutonomousDeliveryRuntime } from '@/server/autonomous-delivery/bootstrap';
import { advanceAutonomousDelivery, startAutonomousDelivery } from '@/server/autonomous-delivery/registry';
import { autonomousDeliveryRepo } from '@/server/autonomous-delivery/repository';
import { deliveryAdvancementQueue } from '@/server/autonomous-delivery/advancement-queue';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { generateSortableId } from '@/server/repositories/sortable-id';
import { taskGraphRepo } from '@/server/repositories/task-graph-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { taskCommandService } from '@/server/repositories/task-command-service';
import { resolveInitialTaskAgentId } from '@/server/team-runtime/task-assignment';
import {
  groupChatTaskFlow,
  type AssignTaskInput,
  type BlockTaskInput,
  type CancelTaskInput,
  type CreateRootTaskInput,
  type MergeTaskInput,
  type ReopenTaskInput,
  type ResumeTaskInput,
  type SplitTaskInput,
} from '@/server/task-flow/group-chat-task-flow';
import { evaluateTaskGraphAction } from '@/server/task-flow/task-graph-policy';
import { publishTaskChangeNotification } from '@/server/task-flow/task-notification-publisher';

interface JournalRow {
  request_digest: string;
  state: 'processing' | 'final';
  owner_token: string | null;
  lease_expires_at: string | null;
  receipt_json: string | null;
}

interface WorkspaceCommandServiceOptions {
  db?: Database.Database;
  io?: IOServer;
  now?: () => Date;
  idFactory?: () => string;
  humanCommandService?: Pick<HumanCommandService, 'submit'>;
}

export class WorkspaceCommandInvariantError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'WorkspaceCommandInvariantError';
  }
}

export class WorkspaceCommandIdempotencyConflictError extends WorkspaceCommandInvariantError {
  constructor(idempotencyKey: string) {
    super(
      'workspace_command_idempotency_conflict',
      `幂等键已绑定到另一条命令：${idempotencyKey}`,
    );
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function digest(command: WorkspaceCommand): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(command))).digest('hex');
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkspaceCommandInvariantError('workspace_command_invalid', `${field} 不能为空`);
  }
  return value.trim();
}

function normalizedPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isLegacyHumanCommand(command: WorkspaceCommand): command is HumanCommand {
  return command.type === 'delivery.requirement.submit'
    || command.type === 'delivery.plan.request'
    || command.type === 'task.progress.request';
}

export class WorkspaceCommandService {
  private readonly database?: Database.Database;
  private readonly io?: IOServer;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly humanCommandService?: Pick<HumanCommandService, 'submit'>;

  constructor(options: WorkspaceCommandServiceOptions = {}) {
    this.database = options.db;
    this.io = options.io;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => generateSortableId('workspace-command-receipt'));
    this.humanCommandService = options.humanCommandService;
  }

  private db(): Database.Database {
    return this.database ?? getDb();
  }

  private assertDeliveryScope(deliveryId: string, projectPath: string) {
    const conversation = conversationRepo.getById(deliveryId);
    if (!conversation) {
      throw new WorkspaceCommandInvariantError('workspace_command_delivery_not_found', '当前交付不存在');
    }
    if (normalizedPath(conversation.project_path ?? '') !== normalizedPath(projectPath)) {
      throw new WorkspaceCommandInvariantError('workspace_command_scope_mismatch', '当前项目与命令目标不一致');
    }
    return conversation;
  }

  async submit(command: WorkspaceCommand): Promise<WorkspaceCommandReceipt> {
    if (!command || typeof command !== 'object') {
      throw new WorkspaceCommandInvariantError('workspace_command_invalid', '命令格式不正确');
    }
    required(command.idempotencyKey, 'idempotencyKey');
    required(command.deliveryId, 'deliveryId');
    required(command.actor?.id, 'actor.id');
    if (command.actor?.type !== 'user') {
      throw new WorkspaceCommandInvariantError('workspace_command_actor_invalid', '仅接受用户命令');
    }
    if (typeof command.issuedAt !== 'string' || Number.isNaN(Date.parse(command.issuedAt))) {
      throw new WorkspaceCommandInvariantError('workspace_command_issued_at_invalid', '命令时间格式不正确');
    }

    const requestDigest = digest(command);
    const reservation = this.reserve(command, requestDigest);
    if ('receipt' in reservation) return reservation.receipt;
    const { ownerToken } = reservation;
    const stopHeartbeat = this.startLeaseHeartbeat(command.idempotencyKey, ownerToken);
    try {
      if (isLegacyHumanCommand(command)) {
        try {
          const receipt = (this.humanCommandService ?? new HumanCommandService({ db: this.db() })).submit(command);
          return this.persistReceipt(command, requestDigest, ownerToken, receipt);
        } catch (error) {
          if (error instanceof HumanCommandIdempotencyConflictError) {
            throw new WorkspaceCommandIdempotencyConflictError(command.idempotencyKey);
          }
          if (error instanceof HumanCommandInvariantError) {
            throw new WorkspaceCommandInvariantError(error.reasonCode, error.message);
          }
          throw error;
        }
      }

      switch (command.type) {
        case 'delivery.create':
          return await this.createDelivery(command, requestDigest, ownerToken);
        case 'delivery.delete':
          return this.deleteDelivery(command, requestDigest, ownerToken);
        case 'delivery.advance':
          return await this.advanceDelivery(command, requestDigest, ownerToken);
        case 'delivery.breakdown.materialize':
          return await this.materializeBreakdown(command, requestDigest, ownerToken);
        case 'delivery.breakdown.confirm':
          return await this.confirmBreakdown(command, requestDigest, ownerToken);
        case 'task.graph.apply':
          return this.applyTaskGraph(command, requestDigest, ownerToken);
        case 'task.create':
          return this.createTask(command, requestDigest, ownerToken);
        case 'task.update':
          return this.updateTask(command, requestDigest, ownerToken);
        case 'task.transition':
          return this.transitionTask(command, requestDigest, ownerToken);
        case 'work.phase.upsert':
          return this.upsertWorkPhase(command, requestDigest, ownerToken);
        case 'work.phase.delete':
          return this.deleteWorkPhase(command, requestDigest, ownerToken);
        default:
          throw new WorkspaceCommandInvariantError('workspace_command_type_unknown', '不支持的 Workspace Command');
      }
    } catch (error) {
      this.release(command.idempotencyKey, ownerToken);
      throw error;
    } finally {
      stopHeartbeat();
    }
  }

  private startLeaseHeartbeat(idempotencyKey: string, ownerToken: string): () => void {
    const renew = () => {
      const now = this.now();
      this.db().prepare(`
        UPDATE workspace_command_journal
        SET lease_expires_at=?,updated_at=?
        WHERE idempotency_key=? AND state='processing' AND owner_token=?
      `).run(
        new Date(now.getTime() + 5 * 60_000).toISOString(),
        now.toISOString(),
        idempotencyKey,
        ownerToken,
      );
    };
    const timer = setInterval(renew, 30_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private assertOwnership(idempotencyKey: string, ownerToken: string): void {
    const row = this.db().prepare(`
      SELECT 1 owned FROM workspace_command_journal
      WHERE idempotency_key=? AND state='processing' AND owner_token=? AND lease_expires_at>?
    `).get(idempotencyKey, ownerToken, this.now().toISOString()) as { owned: 1 } | undefined;
    if (!row) {
      throw new WorkspaceCommandInvariantError('workspace_command_ownership_lost', '命令执行权已失效');
    }
  }

  private reserve(
    command: WorkspaceCommand,
    requestDigest: string,
  ): { ownerToken: string } | { receipt: WorkspaceCommandReceipt } {
    const now = this.now();
    const nowIso = now.toISOString();
    const ownerToken = generateSortableId('workspace-command-owner');
    const leaseExpiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const reserve = this.db().transaction(() => {
      this.db().prepare(`
        INSERT OR IGNORE INTO workspace_command_journal (
          id,idempotency_key,request_digest,command_type,state,owner_token,
          lease_expires_at,receipt_json,created_at,updated_at
        ) VALUES (?,?,?,?, 'processing', ?,?,NULL,?,?)
      `).run(
        this.idFactory(), command.idempotencyKey, requestDigest, command.type,
        ownerToken, leaseExpiresAt, nowIso, nowIso,
      );
      let row = this.db().prepare(`
        SELECT request_digest,state,owner_token,lease_expires_at,receipt_json
        FROM workspace_command_journal WHERE idempotency_key=?
      `).get(command.idempotencyKey) as JournalRow | undefined;
      if (!row) throw new WorkspaceCommandInvariantError('workspace_command_journal_failed', '无法保留命令幂等键');
      if (row.request_digest !== requestDigest) {
        throw new WorkspaceCommandIdempotencyConflictError(command.idempotencyKey);
      }
      if (row.state === 'final' && row.receipt_json) {
        return { receipt: { ...JSON.parse(row.receipt_json) as WorkspaceCommandReceipt, duplicate: true } };
      }
      if (row.owner_token === ownerToken) return { ownerToken };
      if (row.lease_expires_at && row.lease_expires_at <= nowIso) {
        const claimed = this.db().prepare(`
          UPDATE workspace_command_journal
          SET owner_token=?,lease_expires_at=?,updated_at=?
          WHERE idempotency_key=? AND state='processing' AND lease_expires_at<=?
        `).run(ownerToken, leaseExpiresAt, nowIso, command.idempotencyKey, nowIso);
        if (claimed.changes === 1) return { ownerToken };
        row = this.db().prepare(`
          SELECT request_digest,state,owner_token,lease_expires_at,receipt_json
          FROM workspace_command_journal WHERE idempotency_key=?
        `).get(command.idempotencyKey) as JournalRow;
        if (row.state === 'final' && row.receipt_json) {
          return { receipt: { ...JSON.parse(row.receipt_json) as WorkspaceCommandReceipt, duplicate: true } };
        }
      }
      throw new WorkspaceCommandInvariantError(
        'workspace_command_in_progress',
        '相同操作正在处理中，请使用同一命令稍后重试',
      );
    });
    return reserve();
  }

  private release(idempotencyKey: string, ownerToken: string): void {
    this.db().prepare(`
      DELETE FROM workspace_command_journal
      WHERE idempotency_key=? AND state='processing' AND owner_token=?
    `).run(idempotencyKey, ownerToken);
  }

  private persistReceipt(
    command: WorkspaceCommand,
    requestDigest: string,
    ownerToken: string,
    receipt: WorkspaceCommandReceipt,
  ): WorkspaceCommandReceipt {
    const updated = this.db().prepare(`
      UPDATE workspace_command_journal
      SET state='final',owner_token=NULL,lease_expires_at=NULL,receipt_json=?,updated_at=?
      WHERE idempotency_key=? AND request_digest=? AND state='processing' AND owner_token=?
    `).run(
      JSON.stringify(receipt), receipt.recordedAt, command.idempotencyKey, requestDigest, ownerToken,
    );
    if (updated.changes !== 1) {
      throw new WorkspaceCommandInvariantError('workspace_command_ownership_lost', '命令执行权已失效');
    }
    return receipt;
  }

  private async createDelivery(
    command: Extract<WorkspaceCommand, { type: 'delivery.create' }>,
    requestDigest: string,
    ownerToken: string,
  ): Promise<WorkspaceCommandReceipt> {
    const deliveryId = required(command.deliveryId, 'deliveryId');
    const title = required(command.title, 'title');
    const goal = required(command.goal, 'goal');
    const projectPath = command.projectPath.trim();
    if (command.autonomous && !command.contract) {
      throw new WorkspaceCommandInvariantError('workspace_command_contract_required', '自主交付需要目标契约');
    }
    if (command.contract && (
      command.contract.scope.conversationId !== deliveryId
      || command.contract.goal.trim() !== goal
      || (command.contract.scope.projectPath !== undefined
        && normalizedPath(command.contract.scope.projectPath) !== normalizedPath(projectPath))
      || (command.contract.scope.repository !== undefined
        && normalizedPath(command.contract.scope.repository) !== normalizedPath(command.gitRepoRoot ?? ''))
    )) {
      throw new WorkspaceCommandInvariantError('workspace_command_scope_mismatch', '目标契约与交付范围不一致');
    }

    const prior = conversationRepo.getById(deliveryId);
    if (prior && (
      prior.title !== title
      || (prior.goal ?? '') !== goal
      || prior.priority !== command.priority
      || normalizedPath(prior.project_path ?? '') !== normalizedPath(projectPath)
      || (prior.team_pack_id ?? '') !== (command.teamPackId ?? '')
      || Boolean(prior.use_worktree) !== Boolean(command.useWorktree)
      || normalizedPath(prior.git_repo_root ?? '') !== normalizedPath(command.gitRepoRoot ?? '')
    )) {
      throw new WorkspaceCommandInvariantError('workspace_command_delivery_conflict', '交付 ID 已被其他目标占用');
    }

    const conversation = prior ?? conversationRepo.create({
      id: deliveryId,
      title,
      goal,
      priority: command.priority,
      project_path: projectPath || undefined,
      team_pack_id: command.teamPackId,
      use_worktree: command.useWorktree,
      git_repo_root: command.gitRepoRoot,
    });

    if (projectPath) {
      const { projectContextService } = await import('@/server/project-context');
      const selectedIdentity = normalizedPath(projectPath);
      await projectContextService.prepare({
        mode: 'initialize',
        projectPath,
        conversation: {
          id: conversation.id,
          title: conversation.title,
          goal: conversation.goal,
          status: conversation.status,
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
        },
        resolveWorkstreams: () => conversationRepo.list()
          .filter((row) => Boolean(row.project_path) && normalizedPath(row.project_path!) === selectedIdentity)
          .map((row) => ({
            id: row.id,
            title: row.title,
            goal: row.goal,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
        requestText: goal,
      });
      this.assertOwnership(command.idempotencyKey, ownerToken);
    }

    let result: unknown = { delivery: conversation };
    let initialAdvanceRequired = false;
    if (command.autonomous && command.contract) {
      this.assertOwnership(command.idempotencyKey, ownerToken);
      if (!this.io) throw new WorkspaceCommandInvariantError('workspace_command_runtime_unavailable', '交付运行服务尚未就绪');
      ensureAutonomousDeliveryRuntime(this.io);
      const priorRun = autonomousDeliveryRepo.getLatestByConversation(deliveryId);
      const snapshot = priorRun ?? startAutonomousDelivery(this.io, command.contract);
      if (!snapshot) throw new WorkspaceCommandInvariantError('workspace_command_runtime_unavailable', '交付运行服务尚未注册');
      initialAdvanceRequired = true;
      result = { delivery: conversation, deliveryRun: snapshot };
    }
    this.assertOwnership(command.idempotencyKey, ownerToken);
    if (!initialAdvanceRequired) {
      return this.record(command, requestDigest, ownerToken, { status: 'accepted', result });
    }
    return this.db().transaction(() => {
      deliveryAdvancementQueue.enqueue({
        sourceEventId: `${command.idempotencyKey}:initial-advance`,
        projectId: deliveryId,
        cause: { kind: 'started', ref: command.idempotencyKey },
      });
      return this.record(command, requestDigest, ownerToken, { status: 'accepted', result });
    }).immediate();
  }

  private deleteDelivery(
    command: Extract<WorkspaceCommand, { type: 'delivery.delete' }>,
    requestDigest: string,
    ownerToken: string,
  ): WorkspaceCommandReceipt {
    const conversation = conversationRepo.getById(command.deliveryId);
    if (!conversation) {
      return this.record(command, requestDigest, ownerToken, {
        status: 'accepted',
        result: { deleted: false },
      });
    }
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const deleted = conversationRepo.deleteAggregate(command.deliveryId);
    return this.record(command, requestDigest, ownerToken, { status: 'accepted', result: { deleted } });
  }

  private async advanceDelivery(
    command: Extract<WorkspaceCommand, { type: 'delivery.advance' }>,
    requestDigest: string,
    ownerToken: string,
  ): Promise<WorkspaceCommandReceipt> {
    if (!this.io) throw new WorkspaceCommandInvariantError('workspace_command_runtime_unavailable', '交付运行服务尚未就绪');
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const snapshot = autonomousDeliveryRepo.getSnapshot(required(command.runId, 'runId'));
    if (!snapshot || snapshot.run.conversation_id !== command.deliveryId) {
      throw new WorkspaceCommandInvariantError('workspace_command_run_not_found', '自主交付运行不存在');
    }
    ensureAutonomousDeliveryRuntime(this.io);
    const result = await advanceAutonomousDelivery(this.io, command.runId, {
      kind: 'manual_resume',
      idempotencyKey: command.idempotencyKey,
      actor: command.actor,
    });
    if (!result) throw new WorkspaceCommandInvariantError('workspace_command_runtime_unavailable', '交付运行服务尚未注册');
    return this.record(command, requestDigest, ownerToken, { status: 'accepted', result });
  }

  private async materializeBreakdown(
    command: Extract<WorkspaceCommand, { type: 'delivery.breakdown.materialize' }>,
    requestDigest: string,
    ownerToken: string,
  ): Promise<WorkspaceCommandReceipt> {
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const { ensureTasksMdProjection, initProjectDir, writeOwnedTasksMd } = await import('@/server/task-file-service');
    this.assertOwnership(command.idempotencyKey, ownerToken);
    const workspacesRoot = process.env.ATH_WORKSPACES_ROOT
      || path.join(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
    const projectDir = path.join(/*turbopackIgnore: true*/ workspacesRoot, command.deliveryId);
    initProjectDir(projectDir, {
      name: required(command.projectName, 'projectName'),
      goal: command.projectGoal,
      techStack: ['Next.js', 'TypeScript', 'SQLite'],
      constraints: ['All existing tests must pass'],
    });
    if (command.tasks.length) {
      ensureTasksMdProjection(projectDir, command.deliveryId, []);
      if (!writeOwnedTasksMd(projectDir, command.deliveryId, command.tasks)) {
        throw new WorkspaceCommandInvariantError('workspace_command_projection_owner_mismatch', '任务投影 owner 不一致');
      }
    }
    return this.record(command, requestDigest, ownerToken, { status: 'accepted', result: { projectDir } });
  }

  private async confirmBreakdown(
    command: Extract<WorkspaceCommand, { type: 'delivery.breakdown.confirm' }>,
    requestDigest: string,
    ownerToken: string,
  ): Promise<WorkspaceCommandReceipt> {
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    if (!command.phases.length) {
      throw new WorkspaceCommandInvariantError('workspace_command_invalid', '至少需要一个工作阶段');
    }
    const now = this.now().toISOString();
    const created = this.db().transaction(() => {
      const phases = [] as ReturnType<typeof upsertPersistedPhase>[];
      const tasks = [] as Array<{ task: NonNullable<ReturnType<typeof taskRepo.getById>>; phaseId: string }>;
      for (const phaseInput of command.phases) {
        const existingPhase = getPhaseById(required(phaseInput.id, 'phase.id'), this.db());
        if (existingPhase && existingPhase.conversationId !== command.deliveryId) {
          throw new WorkspaceCommandInvariantError('workspace_command_scope_mismatch', '阶段不属于当前交付');
        }
        const phase = upsertPersistedPhase({
          id: phaseInput.id,
          conversationId: command.deliveryId,
          title: required(phaseInput.title, 'phase.title'),
          description: phaseInput.description,
          order: phaseInput.order,
          status: phaseInput.status,
          createdAt: existingPhase?.createdAt ?? now,
          updatedAt: now,
        }, this.db());
        phases.push(phase);

        for (const taskInput of phaseInput.tasks) {
          const agentId = resolveInitialTaskAgentId({
            conversationId: command.deliveryId,
            explicitAgentId: taskInput.agentId,
          });
          if (!agentId) {
            throw new WorkspaceCommandInvariantError('workspace_command_agent_unavailable', '当前团队没有可接手任务的成员');
          }
          const taskCommandKey = `${command.idempotencyKey}:task:${taskInput.id}`;
          const commit = taskCommandService.create({
            conversationId: command.deliveryId,
            expectedGraphRevision: taskCommandService.expectedGraphRevision(command.deliveryId, taskCommandKey),
            idempotencyKey: taskCommandKey,
            actor: command.actor,
            correlationId: command.idempotencyKey,
            causationId: command.idempotencyKey,
            task: {
              id: required(taskInput.id, 'task.id'),
              title: required(taskInput.title, 'task.title'),
              description: taskInput.description,
              agent_id: agentId,
              dependencies: [...new Set(taskInput.dependencies)],
              artifacts: [],
            },
          });
          const task = commit.tasks.find((item) => item.id === taskInput.id)
            ?? taskRepo.getById(taskInput.id);
          if (!task || task.conversation_id !== command.deliveryId) {
            throw new WorkspaceCommandInvariantError('workspace_command_task_not_found', '拆解任务未能持久化');
          }
          tasks.push({ task, phaseId: phase.id });
        }
      }
      return { phases, tasks };
    })();

    const { ensureTasksMdProjection, initProjectDir, writeOwnedTasksMd } = await import('@/server/task-file-service');
    this.assertOwnership(command.idempotencyKey, ownerToken);
    const workspacesRoot = process.env.ATH_WORKSPACES_ROOT
      || path.join(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
    const projectDir = path.join(/*turbopackIgnore: true*/ workspacesRoot, command.deliveryId);
    initProjectDir(projectDir, {
      name: required(command.projectName, 'projectName'),
      goal: command.projectGoal,
      techStack: ['Next.js', 'TypeScript', 'SQLite'],
      constraints: ['All existing tests must pass'],
    });
    const mdTasks = command.phases.flatMap((phase) => phase.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      phase: phase.id,
      role: task.role,
      agent: task.agentId ?? '',
      status: 'ready' as const,
      depends: task.dependencies,
      deliverable: task.deliverable,
    })));
    ensureTasksMdProjection(projectDir, command.deliveryId, []);
    if (!writeOwnedTasksMd(projectDir, command.deliveryId, mdTasks)) {
      throw new WorkspaceCommandInvariantError('workspace_command_projection_owner_mismatch', '任务投影 owner 不一致');
    }

    for (const { task } of created.tasks) {
      publishTaskChangeNotification({
        io: this.io,
        kind: 'task.updated',
        task,
        actorId: command.actor.id,
        actorType: command.actor.type,
      });
    }
    return this.record(command, requestDigest, ownerToken, {
      status: 'accepted',
      result: { ...created, projectDir },
    });
  }

  private applyTaskGraph(
    command: Extract<WorkspaceCommand, { type: 'task.graph.apply' }>,
    requestDigest: string,
    ownerToken: string,
  ): WorkspaceCommandReceipt {
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const body: Record<string, unknown> = {
      ...command.input,
      action: command.action,
      conversationId: command.deliveryId,
      expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      actorId: command.actor.id,
      actorType: command.actor.type,
      correlationId: command.idempotencyKey,
      causationId: command.idempotencyKey,
    };
    const taskId = typeof body.taskId === 'string' ? body.taskId : undefined;
    const previousTask = taskId ? taskRepo.getById(taskId) : undefined;
    const decision = evaluateTaskGraphAction({
      action: command.action,
      actorId: command.actor.id,
      confirmed: body.confirmed === true,
      taskStatus: previousTask?.status,
      currentOwnerAgentId: previousTask?.agent_id,
      nextOwnerAgentId: typeof body.ownerAgentId === 'string' ? body.ownerAgentId : undefined,
    });
    if (!decision.allowed) {
      return this.record(command, requestDigest, ownerToken, {
        status: 'rejected',
        reasonCode: decision.reasonCode,
        userMessage: decision.message ?? '任务操作被策略拒绝',
      });
    }

    let result: unknown;
    switch (command.action) {
      case 'createRootTask': result = groupChatTaskFlow.createRootTask(body as unknown as CreateRootTaskInput); break;
      case 'splitTask': result = groupChatTaskFlow.splitTask(body as unknown as SplitTaskInput); break;
      case 'mergeTasks': result = groupChatTaskFlow.mergeTasks(body as unknown as MergeTaskInput); break;
      case 'reopenTask': result = groupChatTaskFlow.reopenTask(body as unknown as ReopenTaskInput); break;
      case 'blockTask': result = groupChatTaskFlow.blockTask(body as unknown as BlockTaskInput); break;
      case 'resumeTask': result = groupChatTaskFlow.resumeTask(body as unknown as ResumeTaskInput); break;
      case 'assignTask': result = groupChatTaskFlow.assignTask(body as unknown as AssignTaskInput); break;
      case 'cancelTask': result = groupChatTaskFlow.cancelTask(body as unknown as CancelTaskInput); break;
    }
    const updatedTask = taskId ? taskRepo.getById(taskId) : undefined;
    if (previousTask && updatedTask) {
      publishTaskChangeNotification({
        io: this.io,
        kind: command.action === 'assignTask' ? 'task.assigned' : 'task.status_changed',
        task: updatedTask,
        previousTask,
        actorId: command.actor.id,
        actorType: command.actor.type,
      });
    }
    return this.record(command, requestDigest, ownerToken, {
      status: 'accepted',
      result: {
        operationApplied: result !== undefined,
        graphRevision: taskGraphRepo.revision(command.deliveryId),
        ...(taskId ? { taskId } : {}),
      },
    });
  }

  private createTask(
    command: Extract<WorkspaceCommand, { type: 'task.create' }>,
    requestDigest: string,
    ownerToken: string,
  ): WorkspaceCommandReceipt {
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const agentId = resolveInitialTaskAgentId({
      conversationId: command.deliveryId,
      explicitAgentId: command.task.agentId,
    });
    if (!agentId && command.requestExecution) {
      throw new WorkspaceCommandInvariantError('workspace_command_agent_unavailable', '当前团队没有可接手任务的成员');
    }
    const commit = taskCommandService.create({
      conversationId: command.deliveryId,
      expectedGraphRevision: taskCommandService.expectedGraphRevision(command.deliveryId, command.idempotencyKey),
      idempotencyKey: command.idempotencyKey,
      actor: command.actor,
      task: {
        id: required(command.task.id, 'task.id'),
        title: required(command.task.title, 'task.title'),
        category: command.task.category,
        description: command.task.description,
        agent_id: agentId ?? '',
        dependencies: [...new Set(command.task.dependencies)],
        artifacts: command.task.artifacts,
      },
    });
    const task = commit.tasks[0];
    if (task && command.requestExecution) {
      publishTaskChangeNotification({
        io: this.io,
        kind: 'task.updated',
        task,
        actorId: command.actor.id,
        actorType: command.actor.type,
      });
    }
    return this.record(command, requestDigest, ownerToken, { status: 'accepted', result: { task } });
  }

  private updateTask(
    command: Extract<WorkspaceCommand, { type: 'task.update' }>,
    requestDigest: string,
    ownerToken: string,
  ): WorkspaceCommandReceipt {
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const existing = taskRepo.getById(command.taskId);
    if (!existing || existing.conversation_id !== command.deliveryId) {
      throw new WorkspaceCommandInvariantError('workspace_command_task_not_found', '当前任务不存在');
    }
    const expectedGraphRevision = taskCommandService.expectedGraphRevision(command.deliveryId, command.idempotencyKey);
    const common = {
      conversationId: command.deliveryId,
      taskId: command.taskId,
      expectedTaskRevision: taskCommandService.expectedTaskRevision(
        command.taskId,
        command.idempotencyKey,
        command.expectedTaskRevision,
      ),
      expectedGraphRevision,
      idempotencyKey: command.idempotencyKey,
      actor: command.actor,
    };
    const updates = {
      ...(command.updates.title !== undefined ? { title: command.updates.title } : {}),
      ...(command.updates.description !== undefined ? { description: command.updates.description } : {}),
      ...(command.updates.agentId !== undefined ? { agent_id: command.updates.agentId } : {}),
      ...(command.updates.artifacts !== undefined ? { artifacts: JSON.stringify(command.updates.artifacts) } : {}),
    };
    const result = command.updates.dependencies
      ? taskCommandService.replaceDependencies({
          ...common,
          dependencyTaskIds: command.updates.dependencies,
          updates,
        }).result
      : taskCommandService.update({ ...common, updates }).result;
    publishTaskChangeNotification({
      io: this.io,
      kind: command.updates.agentId !== undefined ? 'task.assigned' : 'task.updated',
      task: result.task,
      previousTask: existing,
      actorId: command.actor.id,
      actorType: command.actor.type,
    });
    return this.record(command, requestDigest, ownerToken, { status: 'accepted', result: { task: result.task } });
  }

  private transitionTask(
    command: Extract<WorkspaceCommand, { type: 'task.transition' }>,
    requestDigest: string,
    ownerToken: string,
  ): WorkspaceCommandReceipt {
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const existing = taskRepo.getById(command.taskId);
    if (!existing || existing.conversation_id !== command.deliveryId) {
      throw new WorkspaceCommandInvariantError('workspace_command_task_not_found', '当前任务不存在');
    }
    if (command.status === 'done') {
      return this.record(command, requestDigest, ownerToken, {
        status: 'rejected',
        reasonCode: 'task_completion_gate_required',
        userMessage: '任务完成必须由评审与验收证据确认，不能手动跳过',
      });
    }
    const result = taskCommandService.transition({
      conversationId: command.deliveryId,
      taskId: command.taskId,
      expectedTaskRevision: taskCommandService.expectedTaskRevision(
        command.taskId,
        command.idempotencyKey,
        command.expectedTaskRevision,
      ),
      expectedGraphRevision: taskCommandService.expectedGraphRevision(command.deliveryId, command.idempotencyKey),
      idempotencyKey: command.idempotencyKey,
      actor: command.actor,
      to: command.status,
      reviewNote: command.reviewNote,
    }).result;
    publishTaskChangeNotification({
      io: this.io,
      kind: 'task.status_changed',
      task: result.task,
      previousTask: existing,
      actorId: command.actor.id,
      actorType: command.actor.type,
    });
    return this.record(command, requestDigest, ownerToken, { status: 'accepted', result: { task: result.task } });
  }

  private upsertWorkPhase(
    command: Extract<WorkspaceCommand, { type: 'work.phase.upsert' }>,
    requestDigest: string,
    ownerToken: string,
  ): WorkspaceCommandReceipt {
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const phaseId = required(command.phase.id, 'phase.id');
    const existing = getPhaseById(phaseId, this.db());
    if (existing && existing.conversationId !== command.deliveryId) {
      throw new WorkspaceCommandInvariantError('workspace_command_scope_mismatch', '阶段不属于当前交付');
    }
    if (!Number.isFinite(command.phase.order)) {
      throw new WorkspaceCommandInvariantError('workspace_command_invalid', 'phase.order 必须是有效数字');
    }
    if (!['planned', 'active', 'done'].includes(command.phase.status)) {
      throw new WorkspaceCommandInvariantError('workspace_command_invalid', 'phase.status 不受支持');
    }
    const now = this.now().toISOString();
    const phase = upsertPersistedPhase({
      id: phaseId,
      conversationId: command.deliveryId,
      title: required(command.phase.title, 'phase.title'),
      description: command.phase.description,
      order: command.phase.order,
      status: command.phase.status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }, this.db());
    return this.record(command, requestDigest, ownerToken, { status: 'accepted', result: { phase } });
  }

  private deleteWorkPhase(
    command: Extract<WorkspaceCommand, { type: 'work.phase.delete' }>,
    requestDigest: string,
    ownerToken: string,
  ): WorkspaceCommandReceipt {
    this.assertDeliveryScope(command.deliveryId, command.projectPath);
    const phaseId = required(command.phaseId, 'phaseId');
    const existing = getPhaseById(phaseId, this.db());
    if (existing && existing.conversationId !== command.deliveryId) {
      throw new WorkspaceCommandInvariantError('workspace_command_scope_mismatch', '阶段不属于当前交付');
    }
    if (existing) deletePersistedPhase(phaseId, this.db());
    return this.record(command, requestDigest, ownerToken, {
      status: 'accepted',
      result: { phaseId, deleted: Boolean(existing) },
    });
  }

  private record(
    command: WorkspaceCommand,
    requestDigest: string,
    ownerToken: string,
    result: Pick<WorkspaceCommandReceipt, 'status' | 'reasonCode' | 'userMessage' | 'result'>,
  ): WorkspaceCommandReceipt {
    const receipt: WorkspaceCommandReceipt = {
      idempotencyKey: command.idempotencyKey,
      commandType: command.type,
      projectPath: command.projectPath,
      deliveryId: command.deliveryId,
      status: result.status,
      duplicate: false,
      targetAgentIds: [],
      ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
      ...(result.userMessage ? { userMessage: result.userMessage } : {}),
      ...(result.result !== undefined ? { result: result.result } : {}),
      recordedAt: this.now().toISOString(),
    };
    return this.persistReceipt(command, requestDigest, ownerToken, receipt);
  }
}
