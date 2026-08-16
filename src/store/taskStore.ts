'use client';

import type { Phase } from '@/types/phase';
import type { PhaseProposal } from '@/lib/breakdownParser';
import { DispatchAdvisor } from '@/lib/dispatchAdvisor';
import { AGENT_ROSTER } from './agentStore';
import type { TaskStatus } from '@/shared/task-status';
import {
  createHumanCommandIdempotencyKey,
  humanCommandGateway,
} from '@/lib/human-command';

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

// --- Module-level counters (shared across app slice loadFromServer) ---

let taskCounter = 1;
let statePhasesSeq = 1;
const taskMutationEpoch = new Map<string, number>();

function newTaskCommandId(scope: string): string {
  const identity = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `webui:${scope}:${identity}`;
}

function nextTaskMutationEpoch(taskId: string): number {
  const next = (taskMutationEpoch.get(taskId) ?? 0) + 1;
  taskMutationEpoch.set(taskId, next);
  return next;
}

export function observeAuthoritativeTaskProjection(taskId: string): void {
  nextTaskMutationEpoch(taskId);
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
): boolean {
  const currentRevision = typeof current?.revision === 'number'
    ? current.revision
    : -1;
  const incomingRevision = incoming.revision;
  if (incomingRevision < currentRevision) return false;
  if (
    taskMutationEpoch.get(incoming.id) !== commandEpoch
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
    for (const t of tasks) _taskLookup[t.id] = t;
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
      return getTaskLookup(get().tasks)[taskId];
    },

    getAgentCurrentTask: (agentId: string): Task | undefined => {
      return get().tasks.find((t: Task) => t.agentId === agentId && t.status === 'in_progress');
    },

    requestTaskProgress: async (
      taskId: string,
      request: string,
      options: { idempotencyKey?: string; issuedAt?: string } = {},
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const task = get().getTaskById(taskId);
      const conversation = task
        ? get().conversations.find((candidate: any) => candidate.id === task.conversationId)
        : undefined;
      if (!task || !conversation) return { ok: false, error: '当前任务不存在或已被删除' };
      try {
        const receipt = await humanCommandGateway.submit({
          type: 'task.progress.request',
          idempotencyKey: options.idempotencyKey
            ?? createHumanCommandIdempotencyKey(task.conversationId),
          projectPath: conversation.projectPath,
          deliveryId: task.conversationId,
          taskId,
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
      if (!conversationId) return;
      const existing = state.tasks.find(
        (t: Task) =>
          t.conversationId === conversationId &&
          t.title === taskData.title &&
          t.agentId === taskData.agentId
      );
      if (existing) return;

      const id = `TASK-${String(taskCounter++).padStart(3, '0')}`;
      try {
        const response = await fetch('/api/mutations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'task.create', payload: { id, conversation_id: conversationId, title: taskData.title, description: taskData.description, agent_id: taskData.agentId, dependencies: taskData.dependencies, artifacts: taskData.artifacts, requestExecution: true, idempotencyKey: newTaskCommandId('task.create') } }),
        });
        const body = await response.json().catch(() => ({}));
        const created = authoritativeTask(body?.result);
        if (!response.ok || !created) {
          throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`);
        }
        set((state: any) => ({
          tasks: state.tasks.some((task: Task) => task.id === created.id)
            ? state.tasks.map((task: Task) => task.id === created.id ? created : task)
            : [...state.tasks, created],
        }));
      } catch (error) {
        console.error('[mutation] task.create failed:', error);
      }
    },

    removeTask: (taskId: string) =>
      set((state: any) => ({
        tasks: state.tasks.filter((t: Task) => t.id !== taskId),
        selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
      })),

    updateTask: async (taskId: string, patch: Partial<Pick<Task, 'title' | 'description' | 'agentId' | 'dependencies' | 'artifacts'>>) => {
      const prev = get().getTaskById(taskId);
      if (!prev) return;
      if (!Number.isSafeInteger(prev.revision) || Number(prev.revision) < 0) {
        console.error('[mutation] task.update requires an authoritative task revision');
        return;
      }
      const epoch = nextTaskMutationEpoch(taskId);
      try {
        const response = await fetch('/api/mutations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'task.update', payload: { id: taskId, ...patch, expectedTaskRevision: prev.revision, idempotencyKey: newTaskCommandId('task.update') } }),
        });
        const body = await response.json().catch(() => ({}));
        const updated = authoritativeTask(body?.result);
        if (!response.ok || !updated) {
          throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`);
        }
        set((state: any) => {
          const current = state.tasks.find((task: Task) => task.id === taskId);
          if (!shouldApplyCommandResult(current, updated, epoch)) return {};
          return {
            tasks: state.tasks.map((task: Task) => task.id === taskId ? updated : task),
          };
        });
      } catch (error) {
        console.error('[mutation] task.update failed:', error);
      }
    },

    updateTaskStatus: async (taskId: string, status: TaskStatus, reviewNote?: string, evidence?: Record<string, unknown>) => {
      const prev = get().getTaskById(taskId);
      if (!prev) return;
      const conversationId = prev.conversationId;
      const epoch = nextTaskMutationEpoch(taskId);

      const reportFailure = (reasonSummary: string) => {
        if (taskMutationEpoch.get(taskId) !== epoch) return;
        get().openBlocker?.({
          conversationId,
          taskId,
          type: 'gate_fail',
          gateId: status === 'done' ? 'build' : 'unit',
          reasonSummary,
        });
      };

      if (!Number.isSafeInteger(prev.revision) || Number(prev.revision) < 0) {
        reportFailure('任务版本尚未完成同步，请刷新后重试。');
        return;
      }

      try {
        const response = await fetch('/api/mutations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'task.updateStatus', payload: { id: taskId, status, reviewNote, evidence, expectedTaskRevision: prev.revision, idempotencyKey: newTaskCommandId('task.updateStatus') } }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const responseError = typeof body?.error === 'string' ? body.error : '';
          const httpError = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
          reportFailure(responseError || `状态流转到 ${status} 被服务端拒绝（${httpError}）。`);
          return;
        }
        const authoritative = authoritativeTask(body?.result);
        if (!authoritative) {
          reportFailure('服务端没有返回权威任务状态，请刷新后重试。');
          return;
        }
        let applied = false;
        set((state: any) => {
          const current = state.tasks.find((task: Task) => task.id === taskId);
          if (!shouldApplyCommandResult(current, authoritative, epoch)) return {};
          applied = true;
          return {
            tasks: state.tasks.map((task: Task) => task.id === taskId ? authoritative : task),
          };
        });
        if (!applied) return;
      } catch (error) {
        const networkError = error instanceof Error ? error.message : String(error);
        reportFailure(`状态流转到 ${status} 失败：${networkError}`);
        return;
      }

      get().addEvent({
        conversationId,
        type: 'task.status_changed',
        payload: { taskId, status, reviewNote },
      });

      const updated = get().getTaskById(taskId);
      if (!updated) return;
      const convId = updated.conversationId;
      const msg = {
        id: `msg-${Date.now()}-ts-${taskId}`,
        agentId: updated.agentId || 'system',
        content: `${taskId} status → ${status}`,
        timestamp: new Date().toISOString(),
        intent: 'task_status' as const,
        conversationId: convId,
        metadata: { taskId, title: updated.title, status, agentId: updated.agentId },
      };
      set((s: any) => ({
        chatMessagesByConversation: {
          ...s.chatMessagesByConversation,
          [convId]: [...(s.chatMessagesByConversation[convId] || []), msg],
        },
      }));
    },

    upsertPhase: (phaseData: Omit<Phase, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): string => {
      const stamp = new Date().toISOString();
      const existing = get().phases.find((p: Phase) => p.id === phaseData.id);
      let id: string;

      if (existing) {
        id = phaseData.id!;
        set((state: any) => ({
          phases: state.phases.map((p: Phase) =>
            p.id === id ? { ...p, ...phaseData, updatedAt: stamp } : p
          ),
        }));
      } else {
        id = phaseData.id || `${get().selectedConversationId}-PHASE-${String(statePhasesSeq++).padStart(3, '0')}`;
        set((state: any) => ({
          phases: [...state.phases, {
            id,
            conversationId: phaseData.conversationId,
            title: phaseData.title,
            description: phaseData.description,
            order: phaseData.order,
            status: phaseData.status,
            createdAt: stamp,
            updatedAt: stamp,
          }],
        }));
      }

      const phase = get().phases.find((p: Phase) => p.id === id);
      if (phase) {
        fetch('/api/phases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: phase.id,
            conversationId: phase.conversationId,
            title: phase.title,
            description: phase.description,
            order: phase.order,
            status: phase.status,
            createdAt: phase.createdAt,
            updatedAt: phase.updatedAt,
          }),
        }).catch((err: any) => console.error('[phases] upsert failed:', err));
      }

      return id;
    },

    removePhase: (phaseId: string) => {
      set((state: any) => ({ phases: state.phases.filter((p: Phase) => p.id !== phaseId) }));

      fetch(`/api/phases?id=${encodeURIComponent(phaseId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      }).catch((err: any) => console.error('[phases] delete failed:', err));
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
        const receipt = await humanCommandGateway.submit({
          type: 'delivery.plan.request',
          idempotencyKey: options.idempotencyKey
            ?? createHumanCommandIdempotencyKey(conversationId),
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

    confirmBreakdown: (conversationId: string, proposals: PhaseProposal[]) => {
      const state = get();
      const allRoleCards = state.roleCards;
      const agentProfiles = AGENT_ROSTER.map((agent) => {
        const rc = allRoleCards.find((c: any) => c.id === agent.roleCardId);
        return {
          id: agent.id,
          forbiddenActions: rc?.forbiddenActions ?? [],
          capabilities: rc?.capabilities,
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

      let taskSeq = state.tasks.length;
      for (let pi = 0; pi < enriched.length; pi++) {
        const prop = enriched[pi];
        const phaseId = get().upsertPhase({
          conversationId,
          title: prop.title,
          description: prop.description,
          order: pi,
          status: 'planned',
        });
        for (const taskProp of prop.tasks) {
          taskSeq++;
          const taskId = `TASK-${String(taskSeq).padStart(3, '0')}`;
          const stamp = new Date().toISOString();
          set((s: any) => ({
            tasks: [...s.tasks, {
              id: taskId,
              conversationId,
              phaseId,
              title: taskProp.title,
              description: taskProp.description,
              status: 'ready' as TaskStatus,
              agentId: taskProp.agentId || 'mario',
              dependencies: [],
              artifacts: [],
              createdAt: stamp,
              updatedAt: stamp,
            }],
          }));
          fetch('/api/mutations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'task.create',
              payload: {
                id: taskId,
                conversation_id: conversationId,
                title: taskProp.title,
                description: taskProp.description,
                agent_id: taskProp.agentId || 'mario',
                dependencies: JSON.stringify([]),
                artifacts: JSON.stringify([]),
                requestExecution: true,
                idempotencyKey: newTaskCommandId('task.create'),
              },
            }),
          }).catch((err) => console.error('[mutation] task.create failed:', err));
        }
      }
      get().setBreakdownStatus(conversationId, 'confirmed');

      // Write .ath/ files via API (server-side file ops can't run in client bundle)
      // Uses conversationId to scope .ath/ under workspaces/<conversationId>/.ath/
      const allNewTasks = get().tasks.filter((t: any) => t.conversationId === conversationId);
      const roleMap: Record<string, string> = { mario: 'planner', toad: 'testing', peach: 'frontend', dk: 'security', yoshi: 'devops' };
      const mdTasks = allNewTasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        phase: t.phaseId || '',
        role: roleMap[t.agentId] || 'backend',
        agent: t.agentId || '',
        status: t.status,
        depends: t.dependencies || [],
        deliverable: '',
      }));

      const conv = get().conversations.find((c: any) => c.id === conversationId);

      fetch('/api/mutations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'ath.initBreakdown',
          payload: {
            conversationId,
            projectName: conv?.title || 'Project',
            projectGoal: conv?.goal || '',
            tasks: mdTasks,
          },
        }),
      }).catch((e) => console.error('[confirmBreakdown] .ath/ write failed:', e));

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
