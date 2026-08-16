import type { NextApiRequest, NextApiResponse } from 'next';
import type { TaskPatch } from '@/server/repositories/task-repo';
import { taskEvidenceRecoveryCommand } from '@/server/task-flow/task-evidence-recovery-command';

type MutationType =
  | 'conversation.create'
  | 'conversation.update'
  | 'conversation.delete'
  | 'task.create'
  | 'task.updateStatus'
  | 'task.update'
  | 'message.append'
  | 'ath.initBreakdown';

interface MutationRequest {
  type: MutationType;
  payload: Record<string, unknown>;
}

interface MutationResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
  reasonCode?: string;
  candidates?: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<MutationResponse>) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Request body must be an object' });
  }
  const { type, payload } = req.body as Partial<MutationRequest>;
  if (typeof type !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ ok: false, error: 'Request body requires type and payload' });
  }

  try {
    let result: unknown;

    switch (type) {
      case 'conversation.create': {
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        const conversation = conversationRepo.create(payload as any);
        try {
          if (conversation.project_path) {
            const { projectContextService } = await import('@/server/project-context');
            const path = await import('node:path');
            const identity = (value: string) => {
              const resolved = path.resolve(value);
              return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
            };
            const selectedIdentity = identity(conversation.project_path);
            const resolveWorkstreams = () => conversationRepo.list()
              .filter(row => (
                Boolean(row.project_path) && identity(row.project_path!) === selectedIdentity
              ))
              .map(row => ({
                id: row.id,
                title: row.title,
                goal: row.goal,
                status: row.status,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              }));
            await projectContextService.prepare({
              mode: 'initialize',
              projectPath: conversation.project_path,
              conversation: {
                id: conversation.id,
                title: conversation.title,
                goal: conversation.goal,
                status: conversation.status,
                createdAt: conversation.created_at,
                updatedAt: conversation.updated_at,
              },
              resolveWorkstreams,
              requestText: conversation.goal ?? conversation.title,
            });
          }
          result = conversation;
        } catch (error) {
          conversationRepo.delete(conversation.id);
          if (conversation.project_path) {
            try {
              const { projectContextService } = await import('@/server/project-context');
              const path = await import('node:path');
              const identity = (value: string) => {
                const resolved = path.resolve(value);
                return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
              };
              const selectedIdentity = identity(conversation.project_path);
              const resolveWorkstreams = () => conversationRepo.list()
                .filter(row => (
                  Boolean(row.project_path) && identity(row.project_path!) === selectedIdentity
                ))
                .map(row => ({
                  id: row.id,
                  title: row.title,
                  goal: row.goal,
                  status: row.status,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
                }));
              await projectContextService.prepare({
                mode: 'rollback',
                projectPath: conversation.project_path,
                conversationId: conversation.id,
                resolveWorkstreams,
              });
            } catch (rollbackError) {
              console.error('[api/mutations] project context rollback failed:', rollbackError);
            }
          }
          throw error;
        }
        break;
      }
      case 'conversation.update': {
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        const { id, ...updates } = payload as any;
        conversationRepo.update(id, updates);
        result = { id };
        break;
      }
      case 'conversation.delete': {
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        const id = payload.id as string;
        result = { id, deleted: conversationRepo.deleteAggregate(id) };
        break;
      }
      case 'task.create': {
        const { stableTaskCommandKey, taskCommandService } = await import('@/server/repositories/task-command-service');
        const { resolveInitialTaskAgentId } = await import('@/server/team-runtime/task-assignment');
        const { publishTaskChangeNotification } = await import('@/server/task-flow/task-notification-publisher');
        const taskPayload = payload as any;
        if (taskPayload.conversation_id) {
          const agentId = resolveInitialTaskAgentId({
            conversationId: taskPayload.conversation_id,
            explicitAgentId: taskPayload.agent_id,
          });
          if (!agentId) {
            return res.status(400).json({ ok: false, error: 'No workflow assignment was available.' });
          }
          taskPayload.agent_id = agentId;
        }
        const idempotencyKey = typeof taskPayload.idempotencyKey === 'string'
          ? taskPayload.idempotencyKey
          : stableTaskCommandKey('mutation-api:task.create', taskPayload);
        const dependencies = Array.isArray(taskPayload.dependencies)
          ? taskPayload.dependencies
          : typeof taskPayload.dependencies === 'string'
            ? JSON.parse(taskPayload.dependencies)
            : [];
        const task = taskCommandService.create({
          conversationId: taskPayload.conversation_id,
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            taskPayload.conversation_id,
            idempotencyKey,
          ),
          idempotencyKey,
          actor: { type: 'user', id: 'webui:local-user' },
          task: {
            id: taskPayload.id,
            title: taskPayload.title,
            description: taskPayload.description,
            agent_id: taskPayload.agent_id,
            dependencies,
          },
        }).tasks[0];
        if (task && taskPayload.requestExecution === true) {
          publishTaskChangeNotification({
            io: (res.socket as any)?.server?.io,
            kind: 'task.updated',
            task,
            actorId: 'webui:local-user',
            actorType: 'user',
          });
        }
        result = task;
        break;
      }
      case 'task.updateStatus': {
        const { assertTaskStatus, taskRepo } = await import('@/server/repositories/task-repo');
        const { publishTaskChangeNotification } = await import('@/server/task-flow/task-notification-publisher');
        const { taskStatusEvidencePolicy } = await import('@/server/task-flow/task-status-evidence-policy');
        const { id, status: statusValue, reviewNote, evidence, actorId, actorType, expectedTaskRevision } = payload;
        if (typeof id !== 'string' || !id.trim()) {
          return res.status(400).json({ ok: false, error: 'task id is required' });
        }
        if (typeof statusValue !== 'string') {
          return res.status(400).json({ ok: false, error: 'status is required' });
        }
        const commandActorId = typeof actorId === 'string' && actorId
          ? actorId
          : 'mutation-api';
        const commandActorType: 'user' | 'agent' | 'system' = actorType === 'user' || actorType === 'agent'
          ? actorType
          : 'system';
        const status = assertTaskStatus(statusValue);
        if (!Number.isSafeInteger(expectedTaskRevision) || Number(expectedTaskRevision) < 0) {
          return res.status(400).json({
            ok: false,
            error: 'expectedTaskRevision is required',
            reasonCode: 'task_revision_required',
          });
        }
        const { stableTaskCommandKey, taskCommandService } = await import('@/server/repositories/task-command-service');
        const idempotencyKey = typeof (payload as Record<string, unknown>).idempotencyKey === 'string'
          ? String((payload as Record<string, unknown>).idempotencyKey)
          : stableTaskCommandKey('mutation-api:task.updateStatus', payload);
        const rejectedReplay = taskEvidenceRecoveryCommand.replay({
          idempotencyKey,
          request: payload,
        });
        if (rejectedReplay) {
          return res.status(403).json(rejectedReplay.response);
        }
        const previousTask = taskRepo.getById(id);
        if (!previousTask) {
          return res.status(404).json({ ok: false, error: `Task not found: ${id}` });
        }
        const replaying = taskCommandService.hasRecordedCommand(
          previousTask.conversation_id,
          idempotencyKey,
        );
        if (!replaying && previousTask.revision !== Number(expectedTaskRevision)) {
          return res.status(409).json({
            ok: false,
            error: `stale_task_revision:${id}:${String(expectedTaskRevision)}:${previousTask.revision}`,
            reasonCode: 'stale_task_revision',
          });
        }
        if (!replaying) {
          const gateDecision = taskStatusEvidencePolicy.evaluate({
            task: previousTask,
            nextStatus: status,
            evidence,
            actor: {
              type: commandActorType,
              id: commandActorId,
            },
          });
          if (!gateDecision.allowed) {
            const { createGateEvidenceRecoveryWakeup } = await import('@/server/task-flow/task-wakeup');
            const recoveryAgentId = gateDecision.gateName === 'delivery_evidence'
              ? 'mario'
              : typeof actorId === 'string' && actorId.trim()
                ? actorId
                : previousTask.agent_id;
            const wakeup = createGateEvidenceRecoveryWakeup({
              task: previousTask,
              agentId: recoveryAgentId,
              reasonCode: gateDecision.gateName === 'delivery_evidence'
                ? 'missing_delivery_evidence'
                : 'missing_implementation_evidence',
              gateName: gateDecision.gateName,
              missingFields: gateDecision.missingFields,
            });
            const error = gateDecision.message ?? 'Task gate evidence is required';
            const admission = taskEvidenceRecoveryCommand.admit({
              conversationId: previousTask.conversation_id,
              taskId: previousTask.id,
              expectedTaskRevision: Number(expectedTaskRevision),
              idempotencyKey,
              request: payload,
              error,
              wakeup,
            });
            if (admission.status === 'stale') {
              return res.status(409).json({
                ok: false,
                error: `stale_task_revision:${id}:${String(expectedTaskRevision)}:${String(admission.actualRevision ?? 'missing')}`,
                reasonCode: 'stale_task_revision',
              });
            }
            if (admission.status === 'recorded' && admission.receipt.wakeup) {
              const io = (res.socket as any)?.server?.io;
              io?.to(previousTask.conversation_id).emit('task.wakeup', {
                ...admission.receipt.wakeup,
                projectId: previousTask.conversation_id,
                id: admission.receipt.recoveryInboxItemId,
                createdAt: admission.receipt.recordedAt,
              });
            }
            return res.status(403).json(admission.receipt.response);
          }
        }
        const task = taskCommandService.transition({
          conversationId: previousTask.conversation_id,
          taskId: id,
          expectedTaskRevision: Number(expectedTaskRevision),
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            previousTask.conversation_id,
            idempotencyKey,
          ),
          idempotencyKey,
          actor: {
            type: commandActorType,
            id: commandActorId,
          },
          to: status,
          reviewNote: typeof reviewNote === 'string' ? reviewNote : undefined,
        }).result.task;
        if (task) {
          publishTaskChangeNotification({
            io: (res.socket as any)?.server?.io,
            kind: 'task.status_changed',
            task,
            previousTask,
            actorId: commandActorId,
            actorType: commandActorType,
          });
        }
        result = task;
        break;
      }
      case 'task.update': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const { publishTaskChangeNotification } = await import('@/server/task-flow/task-notification-publisher');
        const {
          id,
          actorId,
          actorType,
          agentId,
          dependencies,
          artifacts,
          status,
          expectedTaskRevision,
          idempotencyKey: requestedIdempotencyKey,
          ...updates
        } = payload;
        if (typeof id !== 'string' || !id.trim()) {
          return res.status(400).json({ ok: false, error: 'task id is required' });
        }
        if (status !== undefined) {
          return res.status(400).json({
            ok: false,
            error: 'Task status must be changed through task.updateStatus',
            reasonCode: 'task_status_owner_required',
          });
        }
        const previousTask = taskRepo.getById(id);
        const normalizedUpdates = {
          ...updates,
          ...(agentId !== undefined ? { agent_id: agentId } : {}),
          ...(artifacts !== undefined ? { artifacts: typeof artifacts === 'string' ? artifacts : JSON.stringify(artifacts) } : {}),
        } as Partial<Omit<TaskPatch, 'dependencies'>>;
        if (!previousTask) {
          return res.status(404).json({ ok: false, error: `Task not found: ${id}` });
        }
        const commandActorId = typeof actorId === 'string' && actorId
          ? actorId
          : 'mutation-api';
        const commandActorType: 'user' | 'agent' | 'system' = actorType === 'user' || actorType === 'agent'
          ? actorType
          : 'system';
        const { stableTaskCommandKey, taskCommandService } = await import('@/server/repositories/task-command-service');
        const idempotencyKey = typeof requestedIdempotencyKey === 'string'
          ? requestedIdempotencyKey
          : stableTaskCommandKey('mutation-api:task.update', payload);
        if (!Number.isSafeInteger(expectedTaskRevision) || Number(expectedTaskRevision) < 0) {
          return res.status(400).json({
            ok: false,
            error: 'expectedTaskRevision is required',
            reasonCode: 'task_revision_required',
          });
        }
        const replaying = taskCommandService.hasRecordedCommand(
          previousTask.conversation_id,
          idempotencyKey,
        );
        if (!replaying && previousTask.revision !== Number(expectedTaskRevision)) {
          return res.status(409).json({
            ok: false,
            error: `stale_task_revision:${id}:${String(expectedTaskRevision)}:${previousTask.revision}`,
            reasonCode: 'stale_task_revision',
          });
        }
        let dependencyTaskIds: string[] | undefined;
        if (dependencies !== undefined) {
          let candidate: unknown = dependencies;
          if (typeof candidate === 'string') {
            try {
              candidate = JSON.parse(candidate);
            } catch {
              return res.status(400).json({
                ok: false,
                error: 'Task dependencies must be a JSON array of task IDs',
                reasonCode: 'task_dependencies_invalid',
              });
            }
          }
          if (
            !Array.isArray(candidate)
            || candidate.some((dependency) => typeof dependency !== 'string')
          ) {
            return res.status(400).json({
              ok: false,
              error: 'Task dependencies must be an array of task IDs',
              reasonCode: 'task_dependencies_invalid',
            });
          }
          dependencyTaskIds = candidate;
        }
        const commandInput = {
          conversationId: previousTask.conversation_id,
          taskId: id,
          expectedTaskRevision: Number(expectedTaskRevision),
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            previousTask.conversation_id,
            idempotencyKey,
          ),
          idempotencyKey,
          actor: {
            type: commandActorType,
            id: commandActorId,
          },
        };
        const task = dependencyTaskIds === undefined
          ? taskCommandService.update({
              ...commandInput,
              updates: normalizedUpdates,
            }).result.task
          : taskCommandService.replaceDependencies({
              ...commandInput,
              dependencyTaskIds,
              updates: normalizedUpdates,
            }).result.task;
        if (task) {
          publishTaskChangeNotification({
            io: (res.socket as any)?.server?.io,
            kind: previousTask?.agent_id && previousTask.agent_id !== task.agent_id ? 'task.assigned' : 'task.updated',
            task,
            previousTask,
            actorId: commandActorId,
            actorType: commandActorType,
          });
        }
        result = task;
        break;
      }
      case 'message.append': {
        const { messageRepo } = await import('@/server/repositories/message-repo');
        const id = messageRepo.append(payload as any);
        result = { id };
        break;
      }
      case 'ath.initBreakdown': {
        const { initProjectDir, writeTasksMd } = await import('@/server/task-file-service');
        const { conversationId, projectName, projectGoal, tasks } = payload as any;

        // Scope .ath/ under workspaces/<conversationId>/ so projects don't collide
        const { join } = await import('path');
        const workspacesRoot = process.env.ATH_WORKSPACES_ROOT || join(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
        const projectDir = join(workspacesRoot, conversationId || 'default');

        initProjectDir(projectDir, {
          name: projectName || 'Project',
          goal: projectGoal || '',
          techStack: ['Next.js', 'TypeScript', 'SQLite'],
          constraints: ['All existing tests must pass'],
        });

        if (tasks?.length) {
          writeTasksMd(projectDir, tasks);
        }

        result = { projectDir };
        break;
      }
      default:
        return res.status(400).json({ ok: false, error: `Unknown mutation type: ${type}` });
    }

    res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error(`[api/mutations] Error in ${type}:`, error);
    if ((res as any).headersSent) return;
    const { ProjectContextError } = await import('@/server/project-context');
    if (error instanceof ProjectContextError) {
      const status = error.reasonCode === 'ambiguous_workspace'
        || error.reasonCode === 'project_root_required'
        ? 409
        : error.reasonCode.startsWith('project_path_')
          ? 400
          : 500;
      return res.status(status).json({
        ok: false,
        error: error.message,
        reasonCode: error.reasonCode,
        candidates: error.candidates,
      });
    }
    if (
      error instanceof Error
      && 'reasonCode' in error
      && error.reasonCode === 'agent_inbox_idempotency_conflict'
    ) {
      return res.status(409).json({
        ok: false,
        error: error.message,
        reasonCode: error.reasonCode,
      });
    }
    if (
      error instanceof Error
      && 'reasonCode' in error
      && typeof error.reasonCode === 'string'
      && [
        'a2a_conversation_runtime_missing',
        'a2a_source_not_in_roster',
        'a2a_target_not_in_roster',
        'a2a_communication_policy_blocked',
      ].includes(error.reasonCode)
    ) {
      const status = [
        'a2a_conversation_runtime_missing',
        'a2a_target_not_in_roster',
      ].includes(error.reasonCode) ? 404 : 409;
      return res.status(status).json({
        ok: false,
        error: error.message,
        reasonCode: error.reasonCode,
      });
    }
    if (
      error instanceof Error
      && 'reasonCode' in error
      && typeof error.reasonCode === 'string'
      && [
        'invalid_task_status',
        'invalid_task_transition',
        'stale_task_transition',
        'stale_task_revision',
        'task_evidence_recovery_idempotency_conflict',
      ].includes(error.reasonCode)
    ) {
      const status = error.reasonCode === 'invalid_task_status' ? 400 : 409;
      return res.status(status).json({
        ok: false,
        error: error.message,
        reasonCode: error.reasonCode,
      });
    }
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
}
