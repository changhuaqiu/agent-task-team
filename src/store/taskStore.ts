'use client';

import type { Phase } from '@/types/phase';
import type { PhaseProposal } from '@/lib/breakdownParser';
import { DispatchAdvisor } from '@/lib/dispatchAdvisor';
import { AGENT_ROSTER } from './agentStore';
import type { TaskStatus } from '@/shared/task-status';
import {
  createWorkspaceCommandIdempotencyKey,
  workspaceCommandGateway,
} from '@/lib/workspace-command';

export type { TaskStatus } from '@/shared/task-status';

// --- Task types ---

export const STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: '待确认',
  ready: '待处理',
  in_progress: '进行中',
  blocked: '已阻塞',
  in_review: '评审中',
  done: '已完成',
  cancelled: '已取消',
};

export const STATUS_ORDER: TaskStatus[] = [
  'blocked',
  'in_progress',
  'in_review',
  'proposed',
  'ready',
  'done',
  'cancelled',
];

export interface TaskArtifact {
  type: 'file' | 'pr' | 'log' | 'link';
  label: string;
  url?: string;
}

export interface Task {
  id: string;
  conversationId: string;
  phaseId: string;
  title: string;
  category?: 'issue' | 'change_request' | 'improvement';
  description: string;
  status: TaskStatus;
  agentId: string;
  dependencies: string[];
  artifacts: TaskArtifact[];
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface TaskIdentity {
  conversationId: string;
  taskId: string;
}

function taskIdentityKey(identity: TaskIdentity): string {
  return `${identity.conversationId}\u0000${identity.taskId}`;
}

// --- Module-level counters (shared across app slice loadFromServer) ---

let taskCounter = 1;
let statePhasesSeq = 1;
const taskMutationEpoch = new Map<string, number>();
const pendingWorkspaceIntents = new Map<string, {
  idempotencyKey: string;
  issuedAt: string;
  objectId?: string;
}>();

function newTaskCommandId(scope: string): string {
  const identity = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `webui:${scope}:${identity}`;
}

function retainedWorkspaceIntent(
  signature: string,
  scope: string,
  objectId?: () => string,
) {
  const existing = pendingWorkspaceIntents.get(signature);
  if (existing) return existing;
  const intent = {
    idempotencyKey: newTaskCommandId(scope),
    issuedAt: new Date().toISOString(),
    ...(objectId ? { objectId: objectId() } : {}),
  };
  pendingWorkspaceIntents.set(signature, intent);
  return intent;
}

function nextTaskMutationEpoch(identity: TaskIdentity): number {
  const key = taskIdentityKey(identity);
  const next = (taskMutationEpoch.get(key) ?? 0) + 1;
  taskMutationEpoch.set(key, next);
  return next;
}

export function observeAuthoritativeTaskProjection(identity: TaskIdentity): void {
  nextTaskMutationEpoch(identity);
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function authoritativeTask(value: unknown): Task | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || typeof row.conversation_id !== 'string'
    || typeof row.title !== 'string'
    || typeof row.status !== 'string'
    || typeof row.agent_id !== 'string'
    || !Number.isSafeInteger(row.revision)
    || Number(row.revision) < 0
  ) return undefined;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    phaseId: typeof row.phase_id === 'string' ? row.phase_id : '',
    title: row.title,
    category: row.category === 'change_request' || row.category === 'improvement' ? row.category : 'issue',
    description: typeof row.description === 'string' ? row.description : '',
    status: row.status as TaskStatus,
    agentId: row.agent_id,
    dependencies: parseJsonArray<string>(row.dependencies),
    artifacts: parseJsonArray<TaskArtifact>(row.artifacts),
    ...(typeof row.review_note === 'string' ? { reviewNote: row.review_note } : {}),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
    revision: Number(row.revision),
  };
}

function shouldApplyCommandResult(
  current: Task | undefined,
  incoming: Task,
  commandEpoch: number,
  identity: TaskIdentity,
): boolean {
  if (incoming.id !== identity.taskId || incoming.conversationId !== identity.conversationId) return false;
  const currentRevision = typeof current?.revision === 'number'
    ? current.revision
    : -1;
  const incomingRevision = incoming.revision;
  if (incomingRevision < currentRevision) return false;
  if (
    taskMutationEpoch.get(taskIdentityKey(identity)) !== commandEpoch
    && incomingRevision <= currentRevision
  ) return false;
  return true;
}

// --- Task lookup index (O(1) by reference equality) ---

let _taskLookup: Record<string, Task> = {};
let _taskLookupRef: Task[] | null = null;

function getTaskLookup(tasks: Task[]): Record<string, Task> {
  if (tasks !== _taskLookupRef) {
    _taskLookupRef = tasks;
    _taskLookup = {};
    for (const t of tasks) {
      _taskLookup[taskIdentityKey({ conversationId: t.conversationId, taskId: t.id })] = t;
    }
  }
  return _taskLookup;
}

export function setTaskCounter(val: number) { taskCounter = val; }

// --- Task Slice Creator ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- set/get typed as any to avoid circular dependency with TaskHubState
export const createTaskSlice = (set: any, get: () => any) => {
  return {
    tasks: [] as Task[],
    selectedTaskId: null as string | null,
    phases: [] as Phase[],

    setSelectedTaskId: (id: string | null) => set({ selectedTaskId: id }),

    getTasksByAgent: (agentId: string): Task[] => {
      const state = get();
      const conversationId = state.selectedConversationId;
      return state.tasks.filter((t: Task) => t.agentId === agentId && t.conversationId === conversationId);
    },

    getTaskById: (taskId: string): Task | undefined => {
      return get().tasks.find((task: Task) => task.id === taskId);
    },

    getTaskByIdentity: (identity: TaskIdentity): Task | undefined => {
      return getTaskLookup(get().tasks)[taskIdentityKey(identity)];
    },

    getAgentCurrentTask: (agentId: string): Task | undefined => {
      return get().tasks.find((t: Task) => t.agentId === agentId && t.status === 'in_progress');
    },

    requestTaskProgress: async (
      identity: TaskIdentity,
      request: string,
      options: { idempotencyKey?: string; issuedAt?: string } = {},
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const task = get().getTaskByIdentity(identity);
      const conversation = task
        ? get().conversations.find((candidate: any) => candidate.id === task.conversationId)
        : undefined;
      if (!task || !conversation) return { ok: false, error: '当前任务不存在或已被删除' };
      try {
        const receipt = await workspaceCommandGateway.submit({
          type: 'task.progress.request',
          idempotencyKey: options.idempotencyKey
            ?? createWorkspaceCommandIdempotencyKey(task.conversationId),
          projectPath: conversation.projectPath,
          deliveryId: task.conversationId,
          taskId: identity.taskId,
          actor: { type: 'user', id: 'human' },
          request,
          issuedAt: options.issuedAt ?? new Date().toISOString(),
        });
        if (receipt.status === 'rejected') {
          return { ok: false, error: receipt.userMessage ?? '团队未能接收进度请求' };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '进度请求提交失败，请稍后重试',
        };
      }
    },

    addTask: async (taskData: Omit<Task, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'conversationId' | 'phaseId'> & { phaseId?: string }) => {
      const state = get();
      const conversationId = state.selectedConversationId;
      if (!conversationId) return false;
      const conversation = state.conversations.find((item: any) => item.id === conversationId);
      if (!conversation) return false;
      const existing = state.tasks.find(
        (t: Task) =>
          t.conversationId === conversationId &&
          t.title === taskData.title &&
          t.agentId === taskData.agentId
      );
      if (existing) return true;

      const intentSignature = JSON.stringify({ type: 'task.create', conversationId, taskData });
      const intent = retainedWorkspaceIntent(
        intentSignature,
        'task.create',
        () => `TASK-${String(taskCounter++).padStart(3, '0')}`,
      );
      const id = intent.objectId!;
      try {
        const receipt = await workspaceCommandGateway.submit({
          type: 'task.create',
          idempotencyKey: intent.idempotencyKey,
          deliveryId: conversationId,
          projectPath: conversation.projectPath,
          actor: { type: 'user', id: 'webui:local-user' },
          issuedAt: intent.issuedAt,
          task: {
            id,
            title: taskData.title,
            category: taskData.category,
            description: taskData.description,
            agentId: taskData.agentId,
            dependencies: taskData.dependencies,
            artifacts: taskData.artifacts,
          },
          requestExecution: Boolean(taskData.agentId?.trim()),
        });
        pendingWorkspaceIntents.delete(intentSignature);
        const created = authoritativeTask((receipt.result as { task?: unknown } | undefined)?.task);
        if (receipt.status !== 'accepted' || !created) throw new Error(receipt.userMessage ?? '任务创建失败');
        set((state: any) => ({
          tasks: state.tasks.some((task: Task) => task.id === created.id && task.conversationId === created.conversationId)
            ? state.tasks.map((task: Task) => task.id === created.id && task.conversationId === created.conversationId ? created : task)
            : [...state.tasks, created],
        }));
        return true;
      } catch (error) {
        console.error('[mutation] task.create failed:', error);
        return false;
      }
    },

    removeTask: (identity: TaskIdentity) =>
      set((state: any) => ({
        tasks: state.tasks.filter((task: Task) => (
          task.id !== identity.taskId || task.conversationId !== identity.conversationId
        )),
        selectedTaskId: state.selectedConversationId === identity.conversationId
          && state.selectedTaskId === identity.taskId
          ? null
          : state.selectedTaskId,
      })),

    updateTask: async (identity: TaskIdentity, patch: Partial<Pick<Task, 'title' | 'description' | 'agentId' | 'dependencies' | 'artifacts'>>) => {
      const prev = get().getTaskByIdentity(identity);
      if (!prev) return;
      if (!Number.isSafeInteger(prev.revision) || Number(prev.revision) < 0) {
        console.error('[mutation] task.update requires an authoritative task revision');
        return;
      }
      const epoch = nextTaskMutationEpoch(identity);
      const conversation = get().conversations.find((item: any) => item.id === prev.conversationId);
      if (!conversation) return;
      const intentSignature = JSON.stringify({ type: 'task.update', ...identity, revision: prev.revision, patch });
      const intent = retainedWorkspaceIntent(intentSignature, 'task.update');
      try {
        const receipt = await workspaceCommandGateway.submit({
          type: 'task.update',
          idempotencyKey: intent.idempotencyKey,
          deliveryId: prev.conversationId,
          projectPath: conversation.projectPath,
          taskId: identity.taskId,
          expectedTaskRevision: Number(prev.revision),
          actor: { type: 'user', id: 'webui:local-user' },
          issuedAt: intent.issuedAt,
          updates: patch,
        });
        pendingWorkspaceIntents.delete(intentSignature);
        const updated = authoritativeTask((receipt.result as { task?: unknown } | undefined)?.task);
        if (receipt.status !== 'accepted' || !updated) throw new Error(receipt.userMessage ?? '任务更新失败');
        set((state: any) => {
          const current = state.tasks.find((task: Task) => task.id === identity.taskId && task.conversationId === identity.conversationId);
          if (!shouldApplyCommandResult(current, updated, epoch, identity)) return {};
          return {
            tasks: state.tasks.map((task: Task) => task.id === identity.taskId && task.conversationId === identity.conversationId ? updated : task),
          };
        });
      } catch (error) {
        console.error('[mutation] task.update failed:', error);
      }
    },

    updateTaskStatus: async (identity: TaskIdentity, status: TaskStatus, reviewNote?: string, evidence?: Record<string, unknown>) => {
      const prev = get().getTaskByIdentity(identity);
      if (!prev) return false;
      const conversationId = prev.conversationId;
      const conversation = get().conversations.find((item: any) => item.id === conversationId);
      if (!conversation) return false;
      const epoch = nextTaskMutationEpoch(identity);

      const reportFailure = (reasonSummary: string) => {
        if (taskMutationEpoch.get(taskIdentityKey(identity)) !== epoch) return;
        get().openBlocker?.({
          conversationId,
          taskId: identity.taskId,
          type: 'gate_fail',
          gateId: status === 'done' ? 'build' : 'unit',
          reasonSummary,
        });
      };

      if (!Number.isSafeInteger(prev.revision) || Number(prev.revision) < 0) {
        reportFailure('任务版本尚未完成同步，请刷新后重试。');
        return false;
      }

      const intentSignature = JSON.stringify({
        type: 'task.transition', ...identity, revision: prev.revision, status, reviewNote, evidence,
      });
      const intent = retainedWorkspaceIntent(intentSignature, 'task.updateStatus');
      try {
        const receipt = await workspaceCommandGateway.submit({
          type: 'task.transition',
          idempotencyKey: intent.idempotencyKey,
          deliveryId: conversationId,
          projectPath: conversation.projectPath,
          taskId: identity.taskId,
          expectedTaskRevision: Number(prev.revision),
          actor: { type: 'user', id: 'webui:local-user' },
          issuedAt: intent.issuedAt,
          status,
          reviewNote,
          evidence,
        });
        pendingWorkspaceIntents.delete(intentSignature);
        if (receipt.status !== 'accepted') {
          reportFailure(receipt.userMessage ?? `状态流转到 ${status} 被服务端拒绝。`);
          return false;
        }
        const authoritative = authoritativeTask((receipt.result as { task?: unknown } | undefined)?.task);
        if (!authoritative) {
          reportFailure('服务端没有返回权威任务状态，请刷新后重试。');
          return false;
        }
        let applied = false;
        set((state: any) => {
          const current = state.tasks.find((task: Task) => task.id === identity.taskId && task.conversationId === identity.conversationId);
          if (!shouldApplyCommandResult(current, authoritative, epoch, identity)) return {};
          applied = true;
          return {
            tasks: state.tasks.map((task: Task) => task.id === identity.taskId && task.conversationId === identity.conversationId ? authoritative : task),
          };
        });
        if (!applied) return false;
      } catch (error) {
        const networkError = error instanceof Error ? error.message : String(error);
        reportFailure(`状态流转到 ${status} 失败：${networkError}`);
        return false;
      }

      get().addEvent({
        conversationId,
        type: 'task.status_changed',
        payload: { taskId: identity.taskId, status, reviewNote },
      });

      const updated = get().getTaskByIdentity(identity);
      if (!updated) return false;
      const convId = updated.conversationId;
      const msg = {
        id: `msg-${Date.now()}-ts-${identity.conversationId}-${identity.taskId}`,
        agentId: updated.agentId || 'system',
        content: `${identity.taskId} status → ${status}`,
        timestamp: new Date().toISOString(),
        intent: 'task_status' as const,
        conversationId: convId,
        metadata: { taskId: identity.taskId, title: updated.title, status, agentId: updated.agentId },
      };
      set((s: any) => ({
        chatMessagesByConversation: {
          ...s.chatMessagesByConversation,
          [convId]: [...(s.chatMessagesByConversation[convId] || []), msg],
        },
      }));
      return true;
    },

    upsertPhase: async (phaseData: Omit<Phase, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<string> => {
      const existing = get().phases.find((p: Phase) => p.id === phaseData.id);
      const id = phaseData.id
        || `${phaseData.conversationId}-PHASE-${String(statePhasesSeq++).padStart(3, '0')}`;
      const conversation = get().conversations.find((item: any) => item.id === phaseData.conversationId);
      if (!conversation) throw new Error('当前交付不存在');
      const receipt = await workspaceCommandGateway.submit({
        type: 'work.phase.upsert',
        idempotencyKey: newTaskCommandId('work.phase.upsert'),
        deliveryId: phaseData.conversationId,
        projectPath: conversation.projectPath,
        actor: { type: 'user', id: 'webui:local-user' },
        issuedAt: new Date().toISOString(),
        phase: {
          id,
          title: phaseData.title,
          description: phaseData.description,
          order: phaseData.order,
          status: phaseData.status,
        },
      });
      const phase = (receipt.result as { phase?: Phase } | undefined)?.phase;
      if (receipt.status !== 'accepted' || !phase) {
        throw new Error(receipt.userMessage ?? '阶段保存失败');
      }
      set((state: any) => ({
        phases: existing
          ? state.phases.map((item: Phase) => item.id === id ? phase : item)
          : [...state.phases, phase],
      }));
      return id;
    },

    removePhase: async (phaseId: string): Promise<void> => {
      const phase = get().phases.find((item: Phase) => item.id === phaseId);
      const conversation = phase
        ? get().conversations.find((item: any) => item.id === phase.conversationId)
        : undefined;
      if (!phase || !conversation) return;
      const receipt = await workspaceCommandGateway.submit({
        type: 'work.phase.delete',
        idempotencyKey: newTaskCommandId('work.phase.delete'),
        deliveryId: phase.conversationId,
        projectPath: conversation.projectPath,
        actor: { type: 'user', id: 'webui:local-user' },
        issuedAt: new Date().toISOString(),
        phaseId,
      });
      if (receipt.status !== 'accepted') {
        throw new Error(receipt.userMessage ?? '阶段删除失败');
      }
      set((state: any) => ({ phases: state.phases.filter((item: Phase) => item.id !== phaseId) }));
    },

    // Breakdown actions
    setBreakdownStatus: (conversationId: string, status: any) => {
      set((state: any) => ({
        conversations: state.conversations.map((c: any) =>
          c.id === conversationId ? { ...c, breakdownStatus: status } : c
        ),
      }));
    },

    triggerProposal: async (
      conversationId: string,
      options: { idempotencyKey?: string; issuedAt?: string } = {},
    ) => {
      const state = get();
      const conv = state.conversations.find((c: any) => c.id === conversationId);
      if (!conv || conv.autonomous) return;

      try {
        const receipt = await workspaceCommandGateway.submit({
          type: 'delivery.plan.request',
          idempotencyKey: options.idempotencyKey
            ?? createWorkspaceCommandIdempotencyKey(conversationId),
          projectPath: conv.projectPath,
          deliveryId: conversationId,
          actor: { type: 'user', id: 'human' },
          issuedAt: options.issuedAt ?? new Date().toISOString(),
        });
        if (receipt.status === 'accepted') {
          get().setBreakdownStatus(conversationId, 'proposal');
          return;
        }
        get().setBreakdownStatus(conversationId, 'no_account');
      } catch (error) {
        console.error('[human-command] delivery.plan.request failed:', error);
        get().setBreakdownStatus(conversationId, 'no_account');
      }
    },

    confirmBreakdown: async (
      conversationId: string,
      proposals: PhaseProposal[],
      options?: { idempotencyKey: string; issuedAt: string },
    ) => {
      const state = get();
      const agentProfiles = AGENT_ROSTER.map((agent) => {
        return {
          id: agent.id,
          forbiddenActions: agent.canModifyCode ? [] : ['modify code', '修改代码'],
          capabilities: {
            domains: [],
            skills: agent.skillIds,
            seniority: 'mid' as const,
            maxConcurrentTasks: agent.parallelism ?? 1,
          },
        };
      });

      const currentTasks = state.tasks;
      const currentLoad: Record<string, number> = {};
      for (const t of currentTasks) {
        if (t.status === 'in_progress' || t.status === 'ready') {
          currentLoad[t.agentId] = (currentLoad[t.agentId] ?? 0) + 1;
        }
      }

      const advisor = new DispatchAdvisor(agentProfiles);
      const enriched = advisor.suggest(proposals, currentLoad);
      const conversation = state.conversations.find((item: any) => item.id === conversationId);
      if (!conversation) throw new Error('当前交付不存在');
      const idempotencyKey = options?.idempotencyKey ?? newTaskCommandId('delivery.breakdown.confirm');
      const issuedAt = options?.issuedAt ?? new Date().toISOString();
      const intentSuffix = idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-12);
      const roleMap: Record<string, string> = { mario: 'planner', toad: 'testing', peach: 'frontend', dk: 'security', yoshi: 'devops' };
      let taskSequence = 0;
      const phases = enriched.map((phase, phaseIndex) => ({
        id: `${conversationId}-PHASE-${intentSuffix}-${phaseIndex + 1}`,
        title: phase.title,
        description: phase.description,
        order: phaseIndex,
        status: 'planned' as const,
        tasks: phase.tasks.map((task) => {
          taskSequence += 1;
          const agentId = task.agentId || 'mario';
          return {
            id: `${conversationId}-TASK-${intentSuffix}-${taskSequence}`,
            title: task.title,
            description: task.description,
            agentId,
            dependencies: [],
            role: roleMap[agentId] || 'backend',
            deliverable: '',
          };
        }),
      }));
      const receipt = await workspaceCommandGateway.submit({
        type: 'delivery.breakdown.confirm',
        idempotencyKey,
        deliveryId: conversationId,
        projectPath: conversation.projectPath,
        actor: { type: 'user', id: 'webui:local-user' },
        issuedAt,
        projectName: conversation.title || 'Project',
        projectGoal: conversation.goal || '',
        phases,
      });
      const result = receipt.result as {
        phases?: Phase[];
        tasks?: Array<{ task: unknown; phaseId: string }>;
      } | undefined;
      const authoritativePhases = result?.phases;
      const authoritativeTasks = result?.tasks?.map(({ task, phaseId }) => {
        const parsed = authoritativeTask(task);
        return parsed ? { ...parsed, phaseId } : undefined;
      }).filter((task): task is Task => Boolean(task));
      if (
        receipt.status !== 'accepted'
        || authoritativePhases?.length !== phases.length
        || authoritativeTasks?.length !== taskSequence
      ) {
        throw new Error(receipt.userMessage ?? '工作拆解确认失败');
      }
      set((current: any) => ({
        phases: [
          ...current.phases.filter((phase: Phase) => phase.conversationId !== conversationId),
          ...authoritativePhases,
        ],
        tasks: [
          ...current.tasks.filter((task: Task) => !authoritativeTasks.some((created) => created.id === task.id)),
          ...authoritativeTasks,
        ],
      }));
      get().setBreakdownStatus(conversationId, 'confirmed');

      const totalTasks = enriched.reduce((sum, p) => sum + p.tasks.length, 0);
      const totalPhases = enriched.length;
      const phaseSummary = enriched.map((p, i) => {
        const taskLines = p.tasks.map((t) => {
          const agentName = t.agentId ? `→ @${t.agentId}` : '→ 未分配';
          return `  - ${t.title} ${agentName}`;
        }).join('\n');
        return `阶段 ${i + 1}:\n${taskLines}`;
      }).join('\n\n');

      const systemMsg = {
        id: `msg-${Date.now()}-sys`,
        agentId: 'system' as const,
        content: `已创建 **${totalTasks} 个任务**，分 **${totalPhases} 个阶段**执行：\n\n${phaseSummary}\n\n你可以随时向团队追加要求或调整计划。`,
        timestamp: new Date().toISOString(),
        intent: 'general' as const,
        conversationId,
      };

      set((s: any) => ({
        chatMessagesByConversation: {
          ...s.chatMessagesByConversation,
          [conversationId]: [...(s.chatMessagesByConversation[conversationId] || []), systemMsg],
        },
      }));
    },
  };
};
