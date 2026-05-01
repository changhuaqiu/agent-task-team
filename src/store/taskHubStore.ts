'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { io } from 'socket.io-client';

const socket = io(undefined, { path: '/api/socketio', autoConnect: false });

/* ============================================================
   Task Hub Store
   Aligned with: specs/2026-04-29-decentralized-agent-task-hub-design.md
   ============================================================ */

// --- Status (6-state machine per spec §2.2) ---
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'rejected'
  | 'blocked';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  in_review:   'In Review',
  done:        'Done',
  rejected:    'Rejected',
  blocked:     'Blocked',
};

export const STATUS_ORDER: TaskStatus[] = [
  'blocked',
  'rejected',
  'in_progress',
  'in_review',
  'pending',
  'done',
];

// --- Agent Role ---
export type AgentRole = 'planner' | 'worker' | 'reviewer';

export type AgentTheme = 'jean' | 'keqing' | 'zhongli' | 'nahida' | 'albedo' | 'venti';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  roleLabel: string;
  theme: AgentTheme;
  emoji: string;
  isOnline: boolean;
}

// --- Chat Message Entity ---
export interface ChatMessage {
  id: string;
  agentId: string | 'human';
  content: string;
  timestamp: string;
  isApprovalRequest?: boolean;
  referencedTaskId?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  mentions?: string[]; // Array of agentIds mentioned in the message
  intent?: 'ideate' | 'execute' | 'review' | 'general'; // Captured intent
}

// --- Task Artifact ---
export interface TaskArtifact {
  type: 'file' | 'pr' | 'log' | 'link';
  label: string;
  url?: string;
}

// --- Task Entity (spec §2.2) ---
export interface Task {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string;
  dependencies: string[];     // prerequisite task IDs
  artifacts: TaskArtifact[];
  reviewNote?: string;        // reviewer feedback
  createdAt: string;          // ISO date
  updatedAt: string;
}

export type ProjectId = 'default' | (string & {});

export interface DispatchToAgentInput {
  agentId: string;
  prompt: string;
  referencedTaskId?: string;
}

export type TeamRole = 'dev' | 'ux' | 'qa' | 'arch';

export interface Conversation {
  id: string;
  title: string;
  goal: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  createdAt: string;
  updatedAt: string;
}

export type SupervisorOutputKind =
  | 'decision_brief'
  | 'execution_plan'
  | 'status_report'
  | 'quality_review_pack';

export interface SupervisorHumanAction {
  actionId: string;
  label: string;
  options?: { id: string; label: string }[];
}

export interface SupervisorOutputEnvelope {
  kind: SupervisorOutputKind;
  conversationId: string;
  invocationId: string;
  timestamp: string;
  summary: string;
  needsHuman: boolean;
  humanActions: SupervisorHumanAction[];
  body: unknown;
}

export type InternalEventType =
  | 'conversation.created'
  | 'conversation.updated'
  | 'task.status_changed'
  | 'run.started'
  | 'run.finished'
  | 'gate.result'
  | 'blocker.opened'
  | 'blocker.fixed'
  | 'artifact.added'
  | 'routing.hint_emitted'
  | 'supervisor.output'
  | 'invocation.started'
  | 'invocation.finished'
  | 'invocation.aborted'
  | 'invocation.worklist_pushed'
  | 'invocation.worklist_skipped';

export interface InternalEvent {
  id: string;
  conversationId: string;
  type: InternalEventType;
  timestamp: string;
  payload?: unknown;
}

export interface Blocker {
  id: string;
  conversationId: string;
  taskId: string;
  type: 'gate_fail' | 'execution_failure' | 'timeout' | 'manual';
  gateId?: 'lint' | 'typecheck' | 'unit' | 'build' | 'e2e' | 'security';
  reasonSummary: string;
  evidenceRef?: string;
  status: 'open' | 'fixed';
  createdAt: string;
  resolvedAt?: string;
}

// --- Store ---
interface TaskHubState {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;

  selectedProjectId: ProjectId;
  agentSessions: Record<ProjectId, Record<string, string | undefined>>;
  activeAgentIds: string[];
  conversations: Conversation[];
  selectedConversationId: string | null;
  tasks: Task[];
  chatMessages: ChatMessage[];
  eventsByConversation: Record<string, InternalEvent[]>;
  blockersByConversation: Record<string, Blocker[]>;

  // We remove getActiveAgents and getAvailableRoster from the state interface
  // because derived data should be computed in the components or via selectors,
  // not returned via functions that create new array references every time they are called.
  getTasksByAgent: (agentId: string) => Task[];
  getTaskById:     (taskId: string) => Task | undefined;
  getConversations: () => Conversation[];
  getSelectedConversation: () => Conversation | undefined;
  getEventsForSelectedConversation: () => InternalEvent[];
  getOpenBlockersForSelectedConversation: () => Blocker[];

  // Mutations
  createConversation: (input: { title: string; goal: string; priority?: Conversation['priority'] }) => void;
  setSelectedConversationId: (conversationId: string | null) => void;
  addSupervisorOutput: (output: SupervisorOutputEnvelope) => void;
  addEvent: (event: Omit<InternalEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => void;
  openBlocker: (input: Omit<Blocker, 'id' | 'status' | 'createdAt'> & { id?: string; status?: Blocker['status']; createdAt?: string }) => string;
  fixBlocker: (conversationId: string, blockerId: string) => void;
  inviteAgent:      (agentId: string) => void;
  dismissAgent:     (agentId: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus, reviewNote?: string) => void;
  addTask:          (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'conversationId'>) => void;
  removeTask:       (taskId: string) => void;
  updateTask:       (taskId: string, patch: Partial<Pick<Task, 'title' | 'description' | 'agentId' | 'dependencies' | 'artifacts'>>) => void;
  addChatMessage:   (msg: Omit<ChatMessage, 'id' | 'timestamp' | 'mentions' | 'intent'>) => void;
  updateChatMessageStatus: (msgId: string, status: 'approved' | 'rejected') => void;

  // --- Terminal Store ---
  terminalLogs: Record<string, string[]>;
  agentStatus: Record<string, 'idle' | 'busy'>;
  activeRunsByAgent: Record<string, { runId: string; taskId?: string; conversationId: string } | undefined>;

  // Actions
  connectDaemon: () => void;
  upsertAgentSession: (projectId: ProjectId, agentId: string, sessionId: string) => void;
  dispatchToAgent: (input: DispatchToAgentInput) => void;
  appendTerminalLog: (agentId: string, log: string) => void;
  simulateCliExecution: (taskId: string, prompt: string, sessionId?: string) => void;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  isNewTaskDialogOpen: boolean;
  setNewTaskDialogOpen: (open: boolean) => void;
  isRosterModalOpen: boolean;
  setRosterModalOpen: (open: boolean) => void;
}

// --- Initial Data (Pixel-art themed) ---
export const AGENT_ROSTER: Agent[] = [
  {
    id: 'jean',
    name: 'Jean',
    role: 'planner',
    roleLabel: 'Acting Grand Master',
    theme: 'jean',
    emoji: '⚔️',
    isOnline: true,
  },
  {
    id: 'keqing',
    name: 'Keqing',
    role: 'worker',
    roleLabel: 'Frontend Yuheng',
    theme: 'keqing',
    emoji: '⚡',
    isOnline: true,
  },
  {
    id: 'zhongli',
    name: 'Zhongli',
    role: 'worker',
    roleLabel: 'Backend Archon',
    theme: 'zhongli',
    emoji: '🔶',
    isOnline: false,
  },
  {
    id: 'nahida',
    name: 'Nahida',
    role: 'reviewer',
    roleLabel: 'Code Reviewer',
    theme: 'nahida',
    emoji: '🌿',
    isOnline: true,
  },
  {
    id: 'albedo',
    name: 'Albedo',
    role: 'worker',
    roleLabel: 'Algorithm Alchemist',
    theme: 'albedo',
    emoji: '✨',
    isOnline: false,
  },
  {
    id: 'venti',
    name: 'Venti',
    role: 'reviewer',
    roleLabel: 'QA Bard',
    theme: 'venti',
    emoji: '💨',
    isOnline: false,
  },
];

const now = '2026-01-01T00:00:00.000Z';

const initialTasks: Array<Omit<Task, 'conversationId'>> = [
  {
    id: 'TASK-001',
    title: 'Analyze Requirements',
    description: 'Break down the user story into actionable task items and write acceptance criteria for each.',
    status: 'done',
    agentId: 'jean',
    dependencies: [],
    artifacts: [
      { type: 'file', label: 'requirements.md', url: '/docs/requirements.md' },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'TASK-002',
    title: 'Design DB Schema',
    description: 'Create the SQLite database schema for the Task Hub entity model.',
    status: 'in_progress',
    agentId: 'jean',
    dependencies: ['TASK-001'],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'TASK-003',
    title: 'Implement MCP Tool CRUD',
    description: 'Build hub_create_task, hub_update_status, hub_get_my_tasks MCP tools.',
    status: 'pending',
    agentId: 'zhongli',
    dependencies: ['TASK-002'],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'TASK-004',
    title: 'Setup UI Skeleton',
    description: 'Create the base React components for the Task Hub board layout.',
    status: 'blocked',
    agentId: 'keqing',
    dependencies: ['TASK-002'],
    artifacts: [],
    reviewNote: 'Waiting for DB schema to be finalized.',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'TASK-005',
    title: 'Review DB Schema PR',
    description: 'Review the initial pull request for the database schema design.',
    status: 'in_review',
    agentId: 'nahida',
    dependencies: ['TASK-002'],
    artifacts: [
      { type: 'pr', label: 'PR #12', url: 'https://github.com/example/pr/12' },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'TASK-006',
    title: 'A2A Router Implementation',
    description: 'Implement the Agent-to-Agent text routing system with @ mention parsing.',
    status: 'rejected',
    agentId: 'zhongli',
    dependencies: ['TASK-003'],
    artifacts: [
      { type: 'log', label: 'test-failure.log' },
    ],
    reviewNote: 'Missing input validation for @ mentions. Need regex guard.',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'TASK-007',
    title: 'Write Integration Tests',
    description: 'Create end-to-end tests for task lifecycle: create → assign → review → done.',
    status: 'pending',
    agentId: 'nahida',
    dependencies: ['TASK-003'],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  },
];

const initialChatMessages: ChatMessage[] = [
  {
    id: 'msg-1',
    agentId: 'jean',
    content: 'I have broken down the main epic into 7 tasks. @zhongli @keqing please review your assigned tasks.',
    timestamp: '2026-01-01T00:10:00.000Z',
    mentions: ['zhongli', 'keqing'],
    intent: 'ideate',
  },
  {
    id: 'msg-2',
    agentId: 'zhongli',
    content: 'The DB schema design for TASK-002 looks solid. However, I need approval to execute the migration script on the staging database. @human',
    timestamp: '2026-01-01T00:20:00.000Z',
    isApprovalRequest: true,
    referencedTaskId: 'TASK-002',
    approvalStatus: 'approved',
    mentions: ['human'],
    intent: 'execute',
  },
  {
    id: 'msg-3',
    agentId: 'human',
    content: 'Migration approved. Proceed when ready.',
    timestamp: '2026-01-01T00:21:00.000Z',
  },
  {
    id: 'msg-4',
    agentId: 'nahida',
    content: 'I found an issue in TASK-006 during review. The regex for @ mentions is missing a boundary check. I have rejected the task, @zhongli please fix.',
    timestamp: '2026-01-01T00:30:00.000Z',
    referencedTaskId: 'TASK-006',
    mentions: ['zhongli'],
    intent: 'review',
  },
  {
    id: 'msg-5',
    agentId: 'keqing',
    content: 'I am currently blocked on TASK-004. Waiting for the final API contract from TASK-002 before I can bind the UI components. Can we expedite? @jean',
    timestamp: '2026-01-01T00:31:00.000Z',
    referencedTaskId: 'TASK-004',
    mentions: ['jean'],
    intent: 'general',
  },
];

// --- Helper Selectors ---
// Note: We use useShallow in components to avoid infinite loops when returning arrays
export const selectActiveAgents = (state: TaskHubState) => 
  AGENT_ROSTER.filter((a) => state.activeAgentIds.includes(a.id));

export const selectAvailableRoster = (state: TaskHubState) => 
  AGENT_ROSTER.filter((a) => !state.activeAgentIds.includes(a.id));
let taskCounter = 8;

const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const defaultConversationId = 'conv-default';

const defaultConversation: Conversation = {
  id: defaultConversationId,
  title: 'Main Battleplan',
  goal: 'Coordinate multi-role execution with strict quality gates.',
  status: 'active',
  priority: 'p1',
  createdAt: now,
  updatedAt: now,
};

const EMPTY_EVENTS: InternalEvent[] = [];
const EMPTY_BLOCKERS: Blocker[] = [];

export const useTaskHubStore = create<TaskHubState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),

      selectedProjectId: 'default',
      agentSessions: { default: {} },
      activeAgentIds: ['jean', 'keqing'],
      conversations: [defaultConversation],
      selectedConversationId: defaultConversationId,
      tasks: initialTasks.map((t) => ({ ...t, conversationId: defaultConversationId })),
      chatMessages: initialChatMessages,
      eventsByConversation: {
        [defaultConversationId]: [
          {
            id: makeId('evt'),
            conversationId: defaultConversationId,
            type: 'conversation.created',
            timestamp: now,
            payload: { conversationId: defaultConversationId },
          },
        ],
      },
      blockersByConversation: { [defaultConversationId]: [] },

      terminalLogs: {},
      agentStatus: {},
      activeRunsByAgent: {},

      connectDaemon: () => {
        if (socket.connected) return;
        fetch('/api/socketio')
          .catch(() => undefined)
          .finally(() => socket.connect());
      },

      getConversations: () => get().conversations,
      getSelectedConversation: () =>
        get().conversations.find((c) => c.id === get().selectedConversationId),
      getEventsForSelectedConversation: () =>
        get().eventsByConversation[get().selectedConversationId] ?? EMPTY_EVENTS,
      getOpenBlockersForSelectedConversation: () =>
        get().blockersByConversation[get().selectedConversationId] ?? EMPTY_BLOCKERS,

      createConversation: ({ title, goal, priority }) => {
        const id = makeId('conv');
        const stamp = new Date().toISOString();
        const conversation: Conversation = {
          id,
          title,
          goal,
          status: 'active',
          priority: priority ?? 'p1',
          createdAt: stamp,
          updatedAt: stamp,
        };

        set((state) => ({
          conversations: [conversation, ...state.conversations],
          selectedConversationId: id,
          eventsByConversation: {
            ...state.eventsByConversation,
            [id]: [
              {
                id: makeId('evt'),
                conversationId: id,
                type: 'conversation.created',
                timestamp: stamp,
                payload: { conversationId: id },
              },
            ],
          },
          blockersByConversation: {
            ...state.blockersByConversation,
            [id]: [],
          },
        }));

        get().addSupervisorOutput({
          kind: 'status_report',
          conversationId: id,
          invocationId: makeId('inv'),
          timestamp: stamp,
          summary: 'Conversation created. Ready for planning.',
          needsHuman: false,
          humanActions: [],
          body: {
            phase: 'discovery',
            progress: { done: [], inProgress: [], blocked: [] },
            risksTop3: [],
            nextStepsTop3: [],
            evidenceLinks: [],
          },
        });
      },

      setSelectedConversationId: (conversationId) => set({ selectedConversationId: conversationId }),

      addEvent: ({ id, timestamp, ...event }) => {
        const resolvedId = id ?? makeId('evt');
        const resolvedTimestamp = timestamp ?? new Date().toISOString();
        const record: InternalEvent = { ...event, id: resolvedId, timestamp: resolvedTimestamp };
        set((state) => ({
          eventsByConversation: {
            ...state.eventsByConversation,
            [record.conversationId]: [...(state.eventsByConversation[record.conversationId] || []), record],
          },
        }));
      },

      addSupervisorOutput: (output) => {
        const tail = (get().eventsByConversation[output.conversationId] || []).slice(-1)[0];
        if (tail?.type === 'supervisor.output') {
          const prev = tail.payload as SupervisorOutputEnvelope | undefined;
          if (prev?.kind === output.kind) return;
        }
        get().addEvent({
          conversationId: output.conversationId,
          type: 'supervisor.output',
          payload: output,
        });
      },

      openBlocker: ({ id, status, createdAt, ...input }) => {
        const resolvedId = id ?? makeId('blk');
        const stamp = createdAt ?? new Date().toISOString();
        const blocker: Blocker = {
          ...input,
          id: resolvedId,
          status: status ?? 'open',
          createdAt: stamp,
        };

        set((state) => ({
          blockersByConversation: {
            ...state.blockersByConversation,
            [blocker.conversationId]: [...(state.blockersByConversation[blocker.conversationId] || []), blocker],
          },
        }));

        get().addEvent({
          conversationId: blocker.conversationId,
          type: 'blocker.opened',
          payload: blocker,
        });

        return resolvedId;
      },

      fixBlocker: (conversationId, blockerId) => {
        const stamp = new Date().toISOString();
        set((state) => ({
          blockersByConversation: {
            ...state.blockersByConversation,
            [conversationId]: (state.blockersByConversation[conversationId] || []).map((b) =>
              b.id === blockerId ? { ...b, status: 'fixed', resolvedAt: stamp } : b
            ),
          },
        }));
        get().addEvent({ conversationId, type: 'blocker.fixed', payload: { blockerId } });
      },

      selectedTaskId: null,
      setSelectedTaskId: (id) => set({ selectedTaskId: id }),

      isNewTaskDialogOpen: false,
      setNewTaskDialogOpen: (open) => set({ isNewTaskDialogOpen: open }),

      isRosterModalOpen: false,
      setRosterModalOpen: (open) => set({ isRosterModalOpen: open }),

      inviteAgent: (agentId) =>
        set((state) => {
          if (state.activeAgentIds.includes(agentId)) return state;
          return { activeAgentIds: [...state.activeAgentIds, agentId] };
        }),

      dismissAgent: (agentId) =>
        set((state) => ({
          activeAgentIds: state.activeAgentIds.filter((id) => id !== agentId),
        })),

      getTasksByAgent: (agentId) => {
        const conversationId = get().selectedConversationId;
        return get().tasks.filter((t) => t.agentId === agentId && t.conversationId === conversationId);
      },

      getTaskById: (taskId) => {
        return get().tasks.find((t) => t.id === taskId);
      },

      upsertAgentSession: (projectId, agentId, sessionId) =>
        set((state) => ({
          agentSessions: {
            ...state.agentSessions,
            [projectId]: {
              ...(state.agentSessions[projectId] || {}),
              [agentId]: sessionId,
            },
          },
        })),

      dispatchToAgent: ({ agentId, prompt, referencedTaskId }) => {
        const projectId = get().selectedProjectId;
        const sessionId = get().agentSessions[projectId]?.[agentId];
        const conversationId =
          (referencedTaskId ? get().getTaskById(referencedTaskId)?.conversationId : undefined) ??
          get().selectedConversationId;
        const runId = makeId('run');

        set((state) => ({
          agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
          terminalLogs: { ...state.terminalLogs, [agentId]: [] },
          activeRunsByAgent: {
            ...state.activeRunsByAgent,
            [agentId]: { runId, taskId: referencedTaskId, conversationId },
          },
        }));

        get().addEvent({
          conversationId,
          type: 'run.started',
          payload: { runId, agentId, taskId: referencedTaskId },
        });

        socket.emit('terminal:start', {
          projectId,
          taskId: referencedTaskId,
          agentId,
          prompt,
          sessionId,
        });
      },

      appendTerminalLog: (agentId, log) =>
        set((state) => ({
          terminalLogs: {
            ...state.terminalLogs,
            [agentId]: [...(state.terminalLogs[agentId] || []), log],
          },
        })),

      simulateCliExecution: (taskId, prompt, sessionId) => {
        const projectId = get().selectedProjectId;
        const task = get().tasks.find((t) => t.id === taskId);
        const agentId = task ? task.agentId : 'system';
        const resolvedSessionId = sessionId || get().agentSessions[projectId]?.[agentId];
        const conversationId = task?.conversationId ?? get().selectedConversationId;
        const runId = makeId('run');

        set((state) => ({
          agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
          terminalLogs: { ...state.terminalLogs, [agentId]: [] },
          activeRunsByAgent: {
            ...state.activeRunsByAgent,
            [agentId]: { runId, taskId, conversationId },
          },
        }));

        get().addEvent({
          conversationId,
          type: 'run.started',
          payload: { runId, agentId, taskId },
        });

        socket.emit('terminal:start', { projectId, taskId, agentId, prompt, sessionId: resolvedSessionId });
      },

      updateTaskStatus: (taskId, status, reviewNote) =>
        (() => {
          const prev = get().getTaskById(taskId);
          const conversationId = prev?.conversationId ?? get().selectedConversationId;

          set((state) => ({
            tasks: state.tasks.map((task) =>
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

          get().addEvent({
            conversationId,
            type: 'task.status_changed',
            payload: { taskId, status, reviewNote },
          });

          if (prev && status === 'in_progress') {
            get().dispatchToAgent({
              agentId: prev.agentId,
              referencedTaskId: prev.id,
              prompt: `Start ${prev.id}: ${prev.title}. ${prev.description}`,
            });
          }
        })(),

      addTask: (taskData) => {
        const conversationId = get().selectedConversationId;
        const existing = get().tasks.find(
          (t) =>
            t.conversationId === conversationId &&
            t.title === taskData.title &&
            t.agentId === taskData.agentId
        );
        if (existing) return;

        const id = `TASK-${String(taskCounter++).padStart(3, '0')}`;
        const stamp = new Date().toISOString();

        set((state) => ({
          tasks: [
            ...state.tasks,
            { ...taskData, id, createdAt: stamp, updatedAt: stamp, conversationId },
          ],
        }));

        if (taskData.agentId) {
          get().dispatchToAgent({
            agentId: taskData.agentId,
            referencedTaskId: id,
            prompt: `You are assigned ${id}: ${taskData.title}. ${taskData.description}. Reply with your plan and next steps.`,
          });
        }
      },

      removeTask: (taskId) =>
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== taskId),
          selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
        })),

      updateTask: (taskId, patch) => {
        const prev = get().getTaskById(taskId);

        set((state) => ({
          tasks: state.tasks.map((task) =>
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
      },

      addChatMessage: (msg) => {
        const mentionsMatch = msg.content.match(/@(\w+)/g);
        const mentions = mentionsMatch ? mentionsMatch.map((m) => m.substring(1)) : [];

        let intent: ChatMessage['intent'] = 'general';
        const contentLower = msg.content.toLowerCase();
        if (contentLower.includes('brainstorm') || contentLower.includes('design') || contentLower.includes('plan')) {
          intent = 'ideate';
        } else if (contentLower.includes('implement') || contentLower.includes('execute') || contentLower.includes('build')) {
          intent = 'execute';
        } else if (contentLower.includes('review') || contentLower.includes('check') || contentLower.includes('audit')) {
          intent = 'review';
        }

        set((state) => ({
          chatMessages: [
            ...state.chatMessages,
            {
              ...msg,
              id: `msg-${Date.now()}`,
              timestamp: new Date().toISOString(),
              mentions,
              intent,
            },
          ],
        }));

        if (msg.agentId === 'human') {
          for (const mentionedAgentId of mentions.slice(0, 2)) {
            get().dispatchToAgent({
              agentId: mentionedAgentId,
              referencedTaskId: msg.referencedTaskId,
              prompt: msg.content,
            });
          }
        }
      },

      updateChatMessageStatus: (msgId, status) =>
        set((state) => ({
          chatMessages: state.chatMessages.map((m) => (m.id === msgId ? { ...m, approvalStatus: status } : m)),
        })),
    }),
    {
      name: 'agent-task-hub-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedProjectId: state.selectedProjectId,
        agentSessions: state.agentSessions,
        activeAgentIds: state.activeAgentIds,
        conversations: state.conversations,
        selectedConversationId: state.selectedConversationId,
        tasks: state.tasks,
        chatMessages: state.chatMessages,
        eventsByConversation: state.eventsByConversation,
        blockersByConversation: state.blockersByConversation,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// --- Socket.io Event Listeners ---
socket.on('terminal:data', ({ agentId, data }) => {
  useTaskHubStore.getState().appendTerminalLog(agentId, data);
});

socket.on('agent:session', ({ projectId, agentId, sessionId }) => {
  useTaskHubStore.getState().upsertAgentSession(projectId || 'default', agentId, sessionId);
  useTaskHubStore.getState().addChatMessage({
    agentId,
    content: `[${projectId || 'default'}] session activated: ${sessionId}`,
  });
  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
  }));
});

socket.on('agent:event', (event) => {
  const { taskId, agentId, type, message } = event;
  
  if (type === 'step_start' || type === 'message') {
    useTaskHubStore.getState().addChatMessage({
      agentId: agentId || 'system',
      content: message || JSON.stringify(event),
      referencedTaskId: taskId,
    });
  }
});

socket.on('terminal:exit', ({ agentId, code }) => {
  const store = useTaskHubStore.getState();
  const active = store.activeRunsByAgent[agentId];
  const conversationId = active?.conversationId ?? store.selectedConversationId;
  const runId = active?.runId;
  const taskId = active?.taskId;

  store.appendTerminalLog(agentId, `\r\n\x1b[36m[process exited with code ${code}]\x1b[0m\r\n`);

  if (runId) {
    store.addEvent({
      conversationId,
      type: 'run.finished',
      payload: { runId, agentId, taskId, code },
    });
  }

  if (typeof code === 'number' && code !== 0 && taskId) {
    store.updateTaskStatus(taskId, 'blocked', `Execution failed (exit ${code}).`);
    store.openBlocker({
      conversationId,
      taskId,
      type: 'execution_failure',
      reasonSummary: `Run failed (exit ${code}).`,
      evidenceRef: runId ? `run:${runId}` : undefined,
    });
  }

  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
    activeRunsByAgent: { ...state.activeRunsByAgent, [agentId]: undefined },
  }));
});
