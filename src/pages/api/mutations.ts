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
        result = taskRepo.create(payload as any);
        break;
      }
      case 'task.updateStatus': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const { id, status, reviewNote } = payload as any;
        taskRepo.updateStatus(id, status, reviewNote);
        result = { id, status };
        break;
      }
      case 'task.update': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const { id, ...updates } = payload as any;
        taskRepo.update(id, updates);
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
        const { agentId, prompt, referencedTaskId } = payload as any;
        const { conversationId } = req.body as any;
        invocationRepo.create({
          id: generateSortableId('disp'),
          conversation_id: conversationId || 'default',
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
          const tasks = taskRepo.list();
          res.json({ ok: true, result: tasks });
        } else if (toolName === 'task_create') {
          const taskCount = taskRepo.list().length;
          const id = `TASK-${String(taskCount + 1).padStart(3, '0')}`;
          const deps = typeof input.dependencies === 'string'
            ? input.dependencies.split(',').map((s: string) => s.trim()).filter(Boolean)
            : [];
          const task = taskRepo.create({
            id,
            conversation_id: conversationId,
            title: input.title,
            description: input.description || '',
            agent_id: input.agent_id || toolAgentId,
            dependencies: deps,
          });

          // Also write to TASKS.md
          try {
            const { readTasksMd, writeTasksMd } = await import('@/server/task-file-service');
            const { join } = await import('path');
            const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
            const projectDir = join(wsRoot, conversationId || 'default');
            const { tasks: existingTasks, blockers } = readTasksMd(projectDir);
            existingTasks.push({
              id,
              title: input.title,
              phase: input.phase || '',
              role: input.role || 'worker',
              agent: input.agent_id || toolAgentId || '',
              status: 'pending',
              depends: deps,
              deliverable: input.deliverable || '',
            });
            writeTasksMd(projectDir, existingTasks, blockers);
          } catch (e) {
            console.error('[task_create] failed to update TASKS.md:', e);
          }

          res.json({ ok: true, result: task });
        } else if (toolName === 'task_update_status') {
          taskRepo.updateStatus(input.task_id, input.status);

          // Also update TASKS.md
          try {
            const { updateTaskInMd } = await import('@/server/task-file-service');
            const { join } = await import('path');
            const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
            const existing = taskRepo.getById(input.task_id);
            const convId = existing?.conversation_id || conversationId || 'default';
            const projectDir = join(wsRoot, convId);
            const STATUS_FILE: Record<string, string> = {
              pending: 'todo', in_progress: 'doing', in_review: 'review', done: 'done', blocked: 'blocked', rejected: 'rejected',
            };
            updateTaskInMd(projectDir, input.task_id, { status: STATUS_FILE[input.status] || input.status });
          } catch (e) {
            console.error('[task_update_status] failed to update TASKS.md:', e);
          }

          res.json({ ok: true });
        } else if (toolName === 'task_assign') {
          taskRepo.update(input.task_id, { agent_id: input.agent_id });

          // Update .ath/TASKS.md
          const { updateTaskInMd } = await import('@/server/task-file-service');
          const { join: joinPath } = await import('path');
          const wsRoot = process.env.ATH_WORKSPACES_ROOT || joinPath(process.cwd(), '.ath', 'workspaces');
          const taskProjectDir = joinPath(wsRoot, conversationId || 'default');
          try {
            updateTaskInMd(taskProjectDir, input.task_id, { agent: input.agent_id });
          } catch (e) {
            console.error('[task_assign] failed to update .ath/TASKS.md:', e);
          }

          res.json({ ok: true });

          // Broadcast task.assigned for store to trigger dispatchToAgent
          const io = (res.socket as any)?.server?.io;
          if (io) {
            io.emit('task.assigned', {
              taskId: input.task_id,
              agentId: input.agent_id,
              conversationId,
            });
          }
        } else {
          res.status(400).json({ ok: false, error: `Unknown tool: ${toolName}` });
        }
        break;
      }
      case 'ath.initBreakdown': {
        const { initProjectDir, writeTasksMd } = await import('@/server/task-file-service');
        const { conversationId, projectName, projectGoal, tasks } = payload as any;

        // Scope .ath/ under workspaces/<conversationId>/ so projects don't collide
        const { join } = await import('path');
        const workspacesRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
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
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
}
