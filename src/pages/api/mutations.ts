import type { NextApiRequest, NextApiResponse } from 'next';
import type { TaskPatch } from '@/server/repositories/task-repo';

type MutationType =
  | 'conversation.create'
  | 'conversation.update'
  | 'conversation.delete'
  | 'task.create'
  | 'task.updateStatus'
  | 'task.update'
  | 'message.append'
  | 'a2a.human_handoff'
  | 'dispatch.enqueue'
  | 'dispatch.cancel'
  | 'tool.invoke'
  | 'phase.upsert'
  | 'phase.delete'
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
        const { resolveInitialTaskAssignment } = await import('@/server/team-runtime/task-assignment');
        const taskPayload = payload as any;
        if (taskPayload.conversation_id) {
          const assignment = resolveInitialTaskAssignment({
            conversationId: taskPayload.conversation_id,
            taskId: taskPayload.id,
            title: taskPayload.title,
            description: taskPayload.description,
            explicitAgentId: taskPayload.agent_id,
          });
          if (!assignment.agentId) {
            return res.status(400).json({ ok: false, error: assignment.reason });
          }
          taskPayload.agent_id = assignment.agentId;
        }
        const idempotencyKey = typeof taskPayload.idempotencyKey === 'string'
          ? taskPayload.idempotencyKey
          : stableTaskCommandKey('mutation-api:task.create', taskPayload);
        const dependencies = Array.isArray(taskPayload.dependencies)
          ? taskPayload.dependencies
          : typeof taskPayload.dependencies === 'string'
            ? JSON.parse(taskPayload.dependencies)
            : [];
        result = taskCommandService.create({
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
        break;
      }
      case 'task.updateStatus': {
        const { assertTaskStatus, taskRepo } = await import('@/server/repositories/task-repo');
        const { publishTaskChangeNotification } = await import('@/server/task-flow/task-notification-publisher');
        const { taskStatusEvidencePolicy } = await import('@/server/task-flow/task-status-evidence-policy');
        const { id, status: statusValue, reviewNote, evidence, actorId, actorType } = payload;
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
        const previousTask = taskRepo.getById(id);
        if (!previousTask) {
          return res.status(404).json({ ok: false, error: `Task not found: ${id}` });
        }
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
          if (previousTask) {
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
            if (wakeup) {
              const io = (res.socket as any)?.server?.io;
              const id = `wakeup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const { submitTaskWakeupToInvocationPipeline } = await import('@/server/invocation-pipeline/registry');
              submitTaskWakeupToInvocationPipeline(io, { ...wakeup, id });
              io?.to(previousTask.conversation_id).emit('task.wakeup', {
                ...wakeup,
                projectId: previousTask.conversation_id,
                id,
                createdAt: new Date().toISOString(),
              });
            }
          }
          return res.status(403).json({
            ok: false,
            error: gateDecision.message ?? 'Task gate evidence is required',
          });
        }
        const { stableTaskCommandKey, taskCommandService } = await import('@/server/repositories/task-command-service');
        const idempotencyKey = typeof (payload as Record<string, unknown>).idempotencyKey === 'string'
          ? String((payload as Record<string, unknown>).idempotencyKey)
          : stableTaskCommandKey('mutation-api:task.updateStatus', payload);
        const task = taskCommandService.transition({
          conversationId: previousTask.conversation_id,
          taskId: id,
          expectedTaskRevision: taskCommandService.expectedTaskRevision(
            id,
            idempotencyKey,
            previousTask.revision,
          ),
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
        result = { id, status };
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
          expectedTaskRevision: taskCommandService.expectedTaskRevision(
            id,
            idempotencyKey,
            previousTask.revision,
          ),
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
        result = { id };
        break;
      }
      case 'message.append': {
        const { messageRepo } = await import('@/server/repositories/message-repo');
        const id = messageRepo.append(payload as any);
        result = { id };
        break;
      }
      case 'a2a.human_handoff': {
        const {
          conversationId,
          messageId,
          prompt,
          targetAgentIds,
          taskId,
        } = payload as Record<string, unknown>;
        if (typeof conversationId !== 'string' || !conversationId.trim()) {
          return res.status(400).json({ ok: false, error: 'a2a.human_handoff requires conversationId' });
        }
        if (typeof messageId !== 'string' || !messageId.trim()) {
          return res.status(400).json({ ok: false, error: 'a2a.human_handoff requires messageId' });
        }
        if (typeof prompt !== 'string') {
          return res.status(400).json({ ok: false, error: 'a2a.human_handoff requires prompt' });
        }
        if (
          !Array.isArray(targetAgentIds)
          || targetAgentIds.some((id) => typeof id !== 'string' || !id.trim())
        ) {
          return res.status(400).json({ ok: false, error: 'a2a.human_handoff targetAgentIds must be strings' });
        }
        if (taskId !== undefined && typeof taskId !== 'string') {
          return res.status(400).json({ ok: false, error: 'a2a.human_handoff taskId must be a string' });
        }
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        if (!conversationRepo.getById(conversationId)) {
          return res.status(404).json({ ok: false, error: 'a2a.human_handoff conversation not found' });
        }
        if (typeof taskId === 'string' && taskId) {
          const { taskRepo } = await import('@/server/repositories/task-repo');
          const task = taskRepo.getById(taskId);
          if (!task) {
            return res.status(404).json({ ok: false, error: 'a2a.human_handoff task not found' });
          }
          if (task.conversation_id !== conversationId) {
            return res.status(409).json({ ok: false, error: 'a2a.human_handoff task scope mismatch' });
          }
        }
        const targets = [...new Set(targetAgentIds as string[])];
        const { HumanA2ACommandService } = await import('@/server/a2a/human-command-service');
        result = new HumanA2ACommandService().submit({
          conversationId,
          messageId,
          prompt,
          targetAgentIds: targets,
          taskId: typeof taskId === 'string' && taskId ? taskId : undefined,
        });
        break;
      }
      case 'dispatch.enqueue': {
        const { AgentInbox } = await import('@/server/platform-events/agent-inbox');
        const {
          agentId,
          conversationId,
          prompt,
          referencedTaskId,
          source,
          fromAgentId,
          legacyProposal,
          idempotencyKey,
        } = payload as Record<string, unknown>;
        if (typeof conversationId !== 'string' || !conversationId.trim()) {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue requires conversationId' });
        }
        if (typeof agentId !== 'string' || !agentId.trim()) {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue requires agentId' });
        }
        if (typeof prompt !== 'string' || !prompt.trim()) {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue requires prompt' });
        }
        if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue requires idempotencyKey' });
        }
        if (referencedTaskId !== undefined && typeof referencedTaskId !== 'string') {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue referencedTaskId must be a string' });
        }
        if (fromAgentId !== undefined && typeof fromAgentId !== 'string') {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue fromAgentId must be a string' });
        }
        if (legacyProposal !== undefined && typeof legacyProposal !== 'boolean') {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue legacyProposal must be a boolean' });
        }
        const allowedSources = ['user', 'a2a', 'workflow', 'review_gate', 'test_gate', 'system'];
        if (source !== undefined && (typeof source !== 'string' || !allowedSources.includes(source))) {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue source is invalid' });
        }
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        if (!conversationRepo.getById(conversationId)) {
          return res.status(404).json({ ok: false, error: 'dispatch.enqueue conversation not found' });
        }
        const { resolveConversationRuntimeProfile } = await import('@/server/invocation-pipeline/conversation-runtime');
        const runtime = resolveConversationRuntimeProfile(conversationId, agentId)?.runtime;
        if (!runtime?.roster.some((agent) => agent.id === agentId)) {
          return res.status(404).json({ ok: false, error: 'dispatch.enqueue project agent not found' });
        }
        if (typeof referencedTaskId === 'string' && referencedTaskId) {
          const { taskRepo } = await import('@/server/repositories/task-repo');
          const task = taskRepo.getById(referencedTaskId);
          if (!task) {
            return res.status(404).json({ ok: false, error: 'dispatch.enqueue task not found' });
          }
          if (task.conversation_id !== conversationId) {
            return res.status(409).json({ ok: false, error: 'dispatch.enqueue task scope mismatch' });
          }
        }
        const commandSource = (source ?? 'user') as
          'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';
        result = new AgentInbox().enqueue({
          projectId: conversationId,
          projectAgentId: agentId,
          idempotencyKey,
          command: {
            source: commandSource,
            prompt,
            taskId: typeof referencedTaskId === 'string' ? referencedTaskId : undefined,
            fromAgentId: typeof fromAgentId === 'string' ? fromAgentId : undefined,
            legacyProposal: legacyProposal === true,
          },
        });
        break;
      }
      case 'dispatch.cancel': {
        const { AgentInbox } = await import('@/server/platform-events/agent-inbox');
        const { agentId, conversationId, idempotencyKey } = payload as Record<string, unknown>;
        if (typeof conversationId !== 'string' || !conversationId.trim()) {
          return res.status(400).json({ ok: false, error: 'dispatch.cancel requires conversationId' });
        }
        if (typeof agentId !== 'string' || !agentId.trim()) {
          return res.status(400).json({ ok: false, error: 'dispatch.cancel requires agentId' });
        }
        if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') {
          return res.status(400).json({ ok: false, error: 'dispatch.cancel idempotencyKey must be a string' });
        }
        const inbox = new AgentInbox();
        const cancelled = inbox.cancelPending(
          conversationId,
          agentId,
          typeof idempotencyKey === 'string' && idempotencyKey ? idempotencyKey : undefined,
        );
        const item = typeof idempotencyKey === 'string' && idempotencyKey
          ? inbox.getByIdempotencyKey(conversationId, agentId, idempotencyKey)
          : undefined;
        result = { cancelled, status: item?.status ?? 'missing' };
        break;
      }
      case 'phase.upsert': {
        const { upsertPhase } = await import('@/server/db/phaseQueries');
        result = upsertPhase(payload as any);
        break;
      }
      case 'phase.delete': {
        const { deletePhase } = await import('@/server/db/phaseQueries');
        deletePhase(payload.id as string);
        result = { id: payload.id };
        break;
      }
      case 'tool.invoke': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const { toolName, agentId: toolAgentId, projectId: toolProjectId, input } = payload as any;
        const conversationId = (payload as any).conversationId || toolProjectId || 'default';

        if (toolName === 'task_list') {
          result = taskRepo.list();
        } else if (toolName === 'task_create') {
          const { resolveInitialTaskAssignment } = await import('@/server/team-runtime/task-assignment');
          const taskCount = taskRepo.list().length;
          const id = `TASK-${String(taskCount + 1).padStart(3, '0')}`;
          const deps = typeof input.dependencies === 'string'
            ? input.dependencies.split(',').map((s: string) => s.trim()).filter(Boolean)
            : [];
          const assignment = resolveInitialTaskAssignment({
            conversationId,
            taskId: id,
            title: input.title,
            description: input.description,
            explicitAgentId: input.agent_id,
            fallbackAgentId: toolAgentId,
          });
          if (!assignment.agentId) {
            return res.status(400).json({ ok: false, error: assignment.reason });
          }
          const { stableTaskCommandKey, taskCommandService } = await import('@/server/repositories/task-command-service');
          const idempotencyKey = stableTaskCommandKey(
            `mutation-api:tool.invoke:${toolAgentId || 'tool-agent'}`,
            { toolName, input, conversationId },
          );
          const task = taskCommandService.create({
            conversationId,
            expectedGraphRevision: taskCommandService.expectedGraphRevision(
              conversationId,
              idempotencyKey,
            ),
            idempotencyKey,
            actor: { type: 'agent', id: toolAgentId || 'tool-agent' },
            task: {
              id,
              title: input.title,
              description: input.description || '',
              agent_id: assignment.agentId,
              dependencies: deps,
            },
          }).tasks[0];

          // Also write to TASKS.md
          try {
            const { readTasksMd, writeTasksMd } = await import('@/server/task-file-service');
            const { join } = await import('path');
            const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
            const projectDir = join(wsRoot, conversationId || 'default');
            const { tasks: existingTasks, blockers } = readTasksMd(projectDir);
            existingTasks.push({
              id,
              title: input.title,
              phase: input.phase || '',
              role: input.role || 'worker',
              agent: assignment.agentId,
              status: 'ready',
              depends: deps,
              deliverable: input.deliverable || '',
            });
            writeTasksMd(projectDir, existingTasks, blockers);
          } catch (e) {
            console.error('[task_create] failed to update TASKS.md:', e);
          }

          result = task;
        } else if (toolName === 'task_update_status') {
          const { taskStatusEvidencePolicy } = await import('@/server/task-flow/task-status-evidence-policy');
          if (typeof input.status !== 'string') {
            return res.status(400).json({ ok: false, error: 'status is required' });
          }
          const { assertTaskStatus } = await import('@/server/repositories/task-repo');
          const nextStatus = assertTaskStatus(input.status);
          const previousTask = taskRepo.getById(input.task_id);
          if (!previousTask) {
            return res.status(404).json({ ok: false, error: `Task not found: ${input.task_id}` });
          }
          const gateDecision = taskStatusEvidencePolicy.evaluate({
            task: previousTask,
            nextStatus,
            evidence: input.evidence,
            actor: { type: 'agent', id: toolAgentId || 'tool-agent' },
          });
          if (!gateDecision.allowed) {
            if (previousTask) {
              const { createGateEvidenceRecoveryWakeup } = await import('@/server/task-flow/task-wakeup');
              const recoveryAgentId = gateDecision.gateName === 'delivery_evidence'
                ? 'mario'
                : (toolAgentId || previousTask.agent_id);
              const wakeup = createGateEvidenceRecoveryWakeup({
                task: previousTask,
                agentId: recoveryAgentId,
                reasonCode: gateDecision.gateName === 'delivery_evidence'
                  ? 'missing_delivery_evidence'
                  : 'missing_implementation_evidence',
                gateName: gateDecision.gateName,
                missingFields: gateDecision.missingFields,
              });
              if (wakeup) {
                const wakeupProjectId = previousTask.conversation_id || conversationId;
                const io = (res.socket as any)?.server?.io;
                const id = `wakeup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const { submitTaskWakeupToInvocationPipeline } = await import('@/server/invocation-pipeline/registry');
                submitTaskWakeupToInvocationPipeline(io, { ...wakeup, id });
                io?.to(wakeupProjectId).emit('task.wakeup', {
                  ...wakeup,
                  projectId: wakeupProjectId,
                  id,
                  createdAt: new Date().toISOString(),
                });
              }
            }
            return res.status(403).json({
              ok: false,
              error: gateDecision.message ?? 'Task gate evidence is required',
            });
          }
          const { stableTaskCommandKey, taskCommandService } = await import('@/server/repositories/task-command-service');
          const idempotencyKey = stableTaskCommandKey(
            `mutation-api:tool.invoke:${toolAgentId || 'tool-agent'}`,
            { toolName, input, conversationId },
          );
          const updatedTask = taskCommandService.transition({
            conversationId: previousTask.conversation_id,
            taskId: previousTask.id,
            expectedTaskRevision: taskCommandService.expectedTaskRevision(
              previousTask.id,
              idempotencyKey,
              previousTask.revision,
            ),
            expectedGraphRevision: taskCommandService.expectedGraphRevision(
              previousTask.conversation_id,
              idempotencyKey,
            ),
            idempotencyKey,
            actor: { type: 'agent', id: toolAgentId || 'tool-agent' },
            to: nextStatus,
          }).result.task;
          result = updatedTask;
          if (updatedTask) {
            const { publishTaskChangeNotification } = await import('@/server/task-flow/task-notification-publisher');
            publishTaskChangeNotification({
              io: (res.socket as any)?.server?.io,
              kind: 'task.status_changed',
              task: updatedTask,
              previousTask,
              actorId: toolAgentId,
              actorType: 'agent',
            });
          }

          // Also update TASKS.md
          try {
            const { updateTaskInMd } = await import('@/server/task-file-service');
            const { join } = await import('path');
            const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
            const existing = updatedTask;
            const convId = existing?.conversation_id || conversationId || 'default';
            const projectDir = join(wsRoot, convId);
            updateTaskInMd(projectDir, input.task_id, { status: nextStatus });
          } catch (e) {
            console.error('[task_update_status] failed to update TASKS.md:', e);
          }
        } else if (toolName === 'task_assign') {
          const previousTask = taskRepo.getById(input.task_id);
          if (!previousTask) {
            return res.status(404).json({ ok: false, error: `Task not found: ${input.task_id}` });
          }
          const { stableTaskCommandKey, taskCommandService } = await import('@/server/repositories/task-command-service');
          const idempotencyKey = stableTaskCommandKey(
            `mutation-api:tool.invoke:${toolAgentId || 'tool-agent'}`,
            { toolName, input, conversationId },
          );
          const updatedTask = taskCommandService.update({
            conversationId: previousTask.conversation_id,
            taskId: previousTask.id,
            expectedTaskRevision: taskCommandService.expectedTaskRevision(
              previousTask.id,
              idempotencyKey,
              previousTask.revision,
            ),
            expectedGraphRevision: taskCommandService.expectedGraphRevision(
              previousTask.conversation_id,
              idempotencyKey,
            ),
            idempotencyKey,
            actor: { type: 'agent', id: toolAgentId || 'tool-agent' },
            updates: { agent_id: input.agent_id },
          }).result.task;
          result = updatedTask;
          if (updatedTask) {
            const { publishTaskChangeNotification } = await import('@/server/task-flow/task-notification-publisher');
            publishTaskChangeNotification({
              io: (res.socket as any)?.server?.io,
              kind: 'task.assigned',
              task: updatedTask,
              previousTask,
              actorId: toolAgentId,
              actorType: 'agent',
            });
          }

          // Update .ath/TASKS.md
          const { updateTaskInMd } = await import('@/server/task-file-service');
          const { join: joinPath } = await import('path');
          const wsRoot = process.env.ATH_WORKSPACES_ROOT || joinPath(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
          const taskProjectDir = joinPath(wsRoot, conversationId || 'default');
          try {
            updateTaskInMd(taskProjectDir, input.task_id, { agent: input.agent_id });
          } catch (e) {
            console.error('[task_assign] failed to update .ath/TASKS.md:', e);
          }

          // publishTaskChangeNotification already emits the project-scoped
          // task.state projection. Agent execution is owned by Inbox/Harness,
          // never by a browser task.assigned listener.
        } else {
          return res.status(400).json({ ok: false, error: `Unknown tool: ${toolName}` });
        }
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
