'use client';

import type { Phase } from '@/types/phase';
import type { PhaseProposal } from '@/lib/breakdownParser';
import { DispatchAdvisor } from '@/lib/dispatchAdvisor';
import { AGENT_ROSTER } from './agentStore';
import type { TeamPack } from '@/types/teamPack';

// --- Task types ---

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'rejected'
  | 'blocked';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待处理',
  in_progress: '进行中',
  in_review: '评审中',
  done: '已完成',
  rejected: '已拒绝',
  blocked: '已阻塞',
};

export const STATUS_ORDER: TaskStatus[] = [
  'blocked',
  'rejected',
  'in_progress',
  'in_review',
  'pending',
  'done',
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
}

// --- Module-level counters (shared across app slice loadFromServer) ---

let taskCounter = 1;
let statePhasesSeq = 1;

function newTaskCommandId(scope: string): string {
  const identity = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `webui:${scope}:${identity}`;
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
export function getTaskCounter() { return taskCounter; }

function getInitialTeamRoleId(teamPack: TeamPack): string | null {
  const available = new Set(teamPack.roles.map((role) => role.id));
  const workflow = teamPack.workflow ?? {};
  const firstStepRole = workflow.steps?.[0]?.role;
  if (firstStepRole && available.has(firstStepRole)) return firstStepRole;

  const firstStateRole = workflow.states?.find((state) => !state.terminal)?.role;
  if (firstStateRole && available.has(firstStateRole)) return firstStateRole;

  return teamPack.roles.find((role) => role.required)?.id ?? teamPack.roles[0]?.id ?? null;
}

function getProposalAgentId(state: any, conv: any): string | null {
  if (!conv.teamPackId) return 'mario';
  const teamPack = state.currentTeamPack;
  if (!teamPack || teamPack.id !== conv.teamPackId) return null;
  return getInitialTeamRoleId(teamPack);
}

// --- Task Slice Creator ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- set/get typed as any to avoid circular dependency with TaskHubState
export const createTaskSlice = (set: any, get: () => any) => {
  return {
    tasks: [] as Task[],
    selectedTaskId: null as string | null,
    phases: [] as Phase[],
    isNewTaskDialogOpen: false as boolean,

    setSelectedTaskId: (id: string | null) => set({ selectedTaskId: id }),
    setNewTaskDialogOpen: (open: boolean) => set({ isNewTaskDialogOpen: open }),

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

    addTask: (taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'conversationId' | 'phaseId'> & { phaseId?: string }) => {
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
      const stamp = new Date().toISOString();

      set((s: any) => ({
        tasks: [
          ...s.tasks,
          { ...taskData, id, phaseId: taskData.phaseId || '', createdAt: stamp, updatedAt: stamp, conversationId },
        ],
      }));

      if (taskData.agentId) {
        get().dispatchToAgent({
          agentId: taskData.agentId,
          referencedTaskId: id,
          prompt: `You are assigned ${id}: ${taskData.title}. ${taskData.description}. Reply with your plan and next steps.`,
        });
      }

      fetch('/api/mutations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'task.create', payload: { id, conversation_id: conversationId, title: taskData.title, description: taskData.description, agent_id: taskData.agentId, dependencies: JSON.stringify(taskData.dependencies), artifacts: JSON.stringify(taskData.artifacts), idempotencyKey: newTaskCommandId('task.create') } }),
      }).catch((err: any) => console.error('[mutation] task.create failed:', err));
    },

    removeTask: (taskId: string) =>
      set((state: any) => ({
        tasks: state.tasks.filter((t: Task) => t.id !== taskId),
        selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
      })),

    updateTask: (taskId: string, patch: Partial<Pick<Task, 'title' | 'description' | 'agentId' | 'dependencies' | 'artifacts'>>) => {
      const prev = get().getTaskById(taskId);

      set((state: any) => ({
        tasks: state.tasks.map((task: Task) =>
          task.id === taskId ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task
        ),
      }));

      if (prev && patch.agentId && patch.agentId !== prev.agentId) {
        const title = patch.title ?? prev.title;
        const description = patch.description ?? prev.description;
        get().dispatchToAgent({
          agentId: patch.agentId,
          referencedTaskId: taskId,
          prompt: `You are assigned ${taskId}: ${title}. ${description}. Reply with your plan and next steps.`,
        });
      }

      fetch('/api/mutations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'task.update', payload: { id: taskId, ...patch, idempotencyKey: newTaskCommandId('task.update') } }),
      }).catch((err: any) => console.error('[mutation] task.update failed:', err));
    },

    updateTaskStatus: async (taskId: string, status: TaskStatus, reviewNote?: string, evidence?: Record<string, unknown>) => {
      const prev = get().getTaskById(taskId);
      if (!prev) return;
      const conversationId = prev.conversationId;

      set((state: any) => ({
        tasks: state.tasks.map((task: Task) =>
          task.id === taskId
            ? {
                ...task,
                status,
                reviewNote: reviewNote ?? task.reviewNote,
                updatedAt: new Date().toISOString(),
              }
            : task
        ),
      }));

      const rollbackWithBlocker = (reasonSummary: string) => {
        set((state: any) => ({
          tasks: state.tasks.map((task: Task) =>
            task.id === taskId
              ? {
                  ...task,
                  status: prev.status,
                  reviewNote: prev.reviewNote,
                  updatedAt: prev.updatedAt,
                }
              : task
          ),
        }));
        get().openBlocker?.({
          conversationId,
          taskId,
          type: 'gate_fail',
          gateId: status === 'done' ? 'build' : 'unit',
          reasonSummary,
        });
      };

      try {
        const response = await fetch('/api/mutations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'task.updateStatus', payload: { id: taskId, status, reviewNote, evidence, idempotencyKey: newTaskCommandId('task.updateStatus') } }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const responseError = typeof body?.error === 'string' ? body.error : '';
          const httpError = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
          rollbackWithBlocker(responseError || `状态流转到 ${status} 被服务端拒绝（${httpError}）。`);
          return;
        }
      } catch (error) {
        const networkError = error instanceof Error ? error.message : String(error);
        rollbackWithBlocker(`状态流转到 ${status} 失败：${networkError}`);
        return;
      }

      get().addEvent({
        conversationId,
        type: 'task.status_changed',
        payload: { taskId, status, reviewNote },
      });

      if (status === 'in_progress') {
        get().dispatchToAgent({
          agentId: prev.agentId,
          referencedTaskId: prev.id,
          prompt: `Start ${prev.id}: ${prev.title}. ${prev.description}`,
        });
      }

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
        fetch('/api/mutations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'phase.upsert',
            payload: {
              id: phase.id,
              conversationId: phase.conversationId,
              title: phase.title,
              description: phase.description,
              order: phase.order,
              status: phase.status,
              createdAt: phase.createdAt,
              updatedAt: phase.updatedAt,
            },
          }),
        }).catch((err: any) => console.error('[mutation] phase.upsert failed:', err));
      }

      return id;
    },

    removePhase: (phaseId: string) => {
      set((state: any) => ({ phases: state.phases.filter((p: Phase) => p.id !== phaseId) }));

      fetch('/api/mutations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'phase.delete', payload: { id: phaseId } }),
      }).catch((err: any) => console.error('[mutation] phase.delete failed:', err));
    },

    // Breakdown actions
    setBreakdownStatus: (conversationId: string, status: any) => {
      set((state: any) => ({
        conversations: state.conversations.map((c: any) =>
          c.id === conversationId ? { ...c, breakdownStatus: status } : c
        ),
      }));
    },

    triggerProposal: (conversationId: string) => {
      const state = get();
      const conv = state.conversations.find((c: any) => c.id === conversationId);
      if (!conv) return;

      const proposalAgentId = getProposalAgentId(state, conv);
      if (!proposalAgentId) return;

      const profile = state.getAgentRuntimeProfile(proposalAgentId);
      if (!profile) {
        get().setBreakdownStatus(conversationId, 'no_account');
        return;
      }

      get().setBreakdownStatus(conversationId, 'proposal');
      const prompt = `请先基于以下项目目标输出一份技术架构方案和业务方案草案。

方案需要包含：
- 技术架构：核心技术选型、模块划分、关键依赖
- 业务方案：核心流程、边界条件、优先级建议

和用户讨论确认后，当你判断需求已足够清晰，再使用 PHASE/TASK 格式输出任务拆解。

项目：${conv.title}
目标：${conv.goal}${conv.projectPath ? `\n项目路径：${conv.projectPath}` : ''}`;
      get().dispatchToAgent({
        agentId: proposalAgentId,
        prompt,
        conversationId,
      });
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
        if (t.status === 'in_progress' || t.status === 'pending') {
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
              status: 'pending' as TaskStatus,
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
                status: 'pending',
                dependencies: JSON.stringify([]),
                artifacts: JSON.stringify([]),
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
      }).then(() => {
        // Dispatch Planner to drive task assignment
        const taskCount = enriched.reduce((sum, p) => sum + p.tasks.length, 0);
        get().dispatchToAgent({
          agentId: 'mario',
          prompt: `任务分解已完成，共 ${taskCount} 个任务已写入 .ath/TASKS.md。请：
1. 读取 .ath/TASKS.md 确认任务清单
2. 按优先级和依赖关系，逐个使用 task_assign 工具将任务分配给对应 Agent
3. task_assign 会自动触发目标 Agent 的 dispatch`,
        });
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
        content: `已创建 **${totalTasks} 个任务**，分 **${totalPhases} 个阶段**执行：\n\n${phaseSummary}\n\n你可以随时 @Agent 追加指令或调整计划。`,
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
