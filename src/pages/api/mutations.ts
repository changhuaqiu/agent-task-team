import type { NextApiRequest, NextApiResponse } from 'next';

type MutationType =
  | 'conversation.create'
  | 'conversation.update'
  | 'conversation.delete'
  | 'task.create'
  | 'task.updateStatus'
  | 'task.update'
  | 'task.delete'
  | 'message.append'
  | 'session.create'
  | 'session.updateCliSessionId'
  | 'session.seal'
  | 'session.sealByTask'
  | 'invocation.create'
  | 'invocation.updateStatus'
  | 'dispatch.enqueue'
  | 'event.append'
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
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<MutationResponse>) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { type, payload } = req.body as MutationRequest;

  try {
    let result: unknown;

    switch (type) {
      case 'conversation.create': {
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        result = conversationRepo.create(payload as any);
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
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const tasks = taskRepo.getByConversation(payload.id as string);
        for (const t of tasks) taskRepo.delete(t.id);
        conversationRepo.delete(payload.id as string);
        result = { id: payload.id };
        break;
      }
      case 'task.create': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
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
        result = taskRepo.create(taskPayload);
        break;
      }
      case 'task.updateStatus': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const { publishTaskChangeNotification } = await import('@/server/task-flow/task-notification-publisher');
        const { proofLogRepo } = await import('@/server/repositories/proof-log-repo');
        const { evaluateTaskStatusEvidenceGate } = await import('@/server/task-flow/task-gate-evidence');
        const { id, status, reviewNote, evidence, actorId, actorType } = payload as any;
        const previousTask = taskRepo.getById(id);
        const gateDecision = evaluateTaskStatusEvidenceGate({
          task: previousTask,
          nextStatus: status,
          actorId,
          evidence,
        });
        if (!gateDecision.allowed) {
          proofLogRepo.append({
            eventType: 'task_graph.gate_evidence.blocked',
            conversationId: previousTask?.conversation_id,
            taskId: id,
            actorId,
            reasonCode: gateDecision.reasonCode,
            metadata: {
              status,
              gateName: gateDecision.gateName,
              missingFields: gateDecision.missingFields,
            },
          });
          if (previousTask) {
            const { createGateEvidenceRecoveryWakeup } = await import('@/server/task-flow/task-wakeup');
            const recoveryAgentId = gateDecision.gateName === 'delivery_evidence'
              ? 'mario'
              : (actorId || previousTask.agent_id);
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
              (res.socket as any)?.server?.io?.to(previousTask.conversation_id).emit('task.wakeup', {
                ...wakeup,
                id: `wakeup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                createdAt: new Date().toISOString(),
              });
            }
          }
          return res.status(403).json({
            ok: false,
            error: gateDecision.message ?? 'Task gate evidence is required',
          });
        }
        taskRepo.updateStatus(id, status, reviewNote);
        const task = taskRepo.getById(id);
        if (task && gateDecision.required) {
          proofLogRepo.append({
            eventType: 'task_graph.gate_evidence.accepted',
            conversationId: task.conversation_id,
            taskId: id,
            actorId,
            metadata: {
              status,
              gateName: gateDecision.gateName,
              evidence,
            },
          });
        }
        if (task) {
          publishTaskChangeNotification({
            io: (res.socket as any)?.server?.io,
            kind: 'task.status_changed',
            task,
            previousTask,
            actorId,
            actorType,
          });
        }
        result = { id, status };
        break;
      }
      case 'task.update': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const { publishTaskChangeNotification } = await import('@/server/task-flow/task-notification-publisher');
        const { id, actorId, actorType, agentId, dependencies, artifacts, ...updates } = payload as any;
        const previousTask = taskRepo.getById(id);
        const normalizedUpdates = {
          ...updates,
          ...(agentId !== undefined ? { agent_id: agentId } : {}),
          ...(dependencies !== undefined ? { dependencies: Array.isArray(dependencies) ? JSON.stringify(dependencies) : dependencies } : {}),
          ...(artifacts !== undefined ? { artifacts: typeof artifacts === 'string' ? artifacts : JSON.stringify(artifacts) } : {}),
        };
        taskRepo.update(id, normalizedUpdates);
        const task = taskRepo.getById(id);
        if (task) {
          publishTaskChangeNotification({
            io: (res.socket as any)?.server?.io,
            kind: previousTask?.agent_id && previousTask.agent_id !== task.agent_id ? 'task.assigned' : 'task.updated',
            task,
            previousTask,
            actorId,
            actorType,
          });
        }
        result = { id };
        break;
      }
      case 'task.delete': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        taskRepo.delete(payload.id as string);
        result = { id: payload.id };
        break;
      }
      case 'message.append': {
        const { messageRepo } = await import('@/server/repositories/message-repo');
        const id = messageRepo.append(payload as any);
        result = { id };
        break;
      }
      case 'session.create': {
        const { sessionRepo } = await import('@/server/repositories/session-repo');
        result = sessionRepo.create(payload as any);
        break;
      }
      case 'session.updateCliSessionId': {
        const { sessionRepo } = await import('@/server/repositories/session-repo');
        const { id, cliSessionId } = payload as any;
        sessionRepo.updateCliSessionId(id, cliSessionId);
        result = { id };
        break;
      }
      case 'session.seal': {
        const { sessionRepo } = await import('@/server/repositories/session-repo');
        const { id, reason } = payload as any;
        sessionRepo.seal(id, reason);
        result = { id };
        break;
      }
      case 'session.sealByTask': {
        const { sessionRepo } = await import('@/server/repositories/session-repo');
        const { agentId, taskId, reason } = payload as any;
        sessionRepo.sealByTask(agentId, taskId, reason);
        result = { agentId, taskId };
        break;
      }
      case 'invocation.create': {
        const { invocationRepo } = await import('@/server/repositories/invocation-repo');
        result = invocationRepo.create(payload as any);
        break;
      }
      case 'invocation.updateStatus': {
        const { invocationRepo } = await import('@/server/repositories/invocation-repo');
        const { id, status, ...updates } = payload as any;
        invocationRepo.updateStatus(id, status, updates);
        result = { id, status };
        break;
      }
      case 'dispatch.enqueue': {
        const { invocationRepo } = await import('@/server/repositories/invocation-repo');
        const { generateSortableId } = await import('@/server/repositories/sortable-id');
        const { agentId, conversationId, prompt, referencedTaskId } = payload as any;
        if (typeof conversationId !== 'string' || !conversationId.trim()) {
          return res.status(400).json({ ok: false, error: 'dispatch.enqueue requires conversationId' });
        }
        invocationRepo.create({
          id: generateSortableId('disp'),
          conversation_id: conversationId,
          agent_id: agentId,
          task_id: referencedTaskId || '',
          prompt,
          engine: '',
        });
        result = { ok: true };
        break;
      }
      case 'event.append': {
        const { eventRepo } = await import('@/server/repositories/event-repo');
        const id = eventRepo.append(payload as any);
        result = { id };
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
          const task = taskRepo.create({
            id,
            conversation_id: conversationId,
            title: input.title,
            description: input.description || '',
            agent_id: assignment.agentId,
            dependencies: deps,
          });

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
              status: 'pending',
              depends: deps,
              deliverable: input.deliverable || '',
            });
            writeTasksMd(projectDir, existingTasks, blockers);
          } catch (e) {
            console.error('[task_create] failed to update TASKS.md:', e);
          }

          result = task;
        } else if (toolName === 'task_update_status') {
          const { evaluateTaskStatusEvidenceGate } = await import('@/server/task-flow/task-gate-evidence');
          const { proofLogRepo } = await import('@/server/repositories/proof-log-repo');
          const previousTask = taskRepo.getById(input.task_id);
          const gateDecision = evaluateTaskStatusEvidenceGate({
            task: previousTask,
            nextStatus: input.status,
            actorId: toolAgentId,
            evidence: input.evidence,
          });
          if (!gateDecision.allowed) {
            proofLogRepo.append({
              eventType: 'task_graph.gate_evidence.blocked',
              conversationId: previousTask?.conversation_id || conversationId,
              taskId: input.task_id,
              actorId: toolAgentId,
              reasonCode: gateDecision.reasonCode,
              metadata: {
                status: input.status,
                gateName: gateDecision.gateName,
                missingFields: gateDecision.missingFields,
              },
            });
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
                (res.socket as any)?.server?.io?.to(previousTask.conversation_id || conversationId).emit('task.wakeup', {
                  ...wakeup,
                  id: `wakeup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  createdAt: new Date().toISOString(),
                });
              }
            }
            return res.status(403).json({
              ok: false,
              error: gateDecision.message ?? 'Task gate evidence is required',
            });
          }
          taskRepo.updateStatus(input.task_id, input.status);
          const updatedTask = taskRepo.getById(input.task_id);
          if (updatedTask && gateDecision.required) {
            proofLogRepo.append({
              eventType: 'task_graph.gate_evidence.accepted',
              conversationId: updatedTask.conversation_id,
              taskId: input.task_id,
              actorId: toolAgentId,
              metadata: {
                status: input.status,
                gateName: gateDecision.gateName,
                evidence: input.evidence,
              },
            });
          }
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
            const STATUS_FILE: Record<string, string> = {
              pending: 'todo', in_progress: 'doing', in_review: 'review', done: 'done', blocked: 'blocked', rejected: 'rejected',
            };
            updateTaskInMd(projectDir, input.task_id, { status: STATUS_FILE[input.status] || input.status });
          } catch (e) {
            console.error('[task_update_status] failed to update TASKS.md:', e);
          }
        } else if (toolName === 'task_assign') {
          const previousTask = taskRepo.getById(input.task_id);
          taskRepo.update(input.task_id, { agent_id: input.agent_id });
          const updatedTask = taskRepo.getById(input.task_id);
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

          // Broadcast task.assigned for store to trigger dispatchToAgent
          const io = (res.socket as any)?.server?.io;
          if (io) {
            io.to(conversationId || 'default').emit('task.assigned', {
              taskId: input.task_id,
              agentId: input.agent_id,
              conversationId,
            });
          }
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
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
}
