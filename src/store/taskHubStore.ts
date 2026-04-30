'use client';

import { create } from 'zustand';
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

// --- Store ---
interface TaskHubState {
  selectedProjectId: ProjectId;
  agentSessions: Record<ProjectId, Record<string, string | undefined>>;
  activeAgentIds: string[];
  tasks: Task[];
  chatMessages: ChatMessage[];

  // We remove getActiveAgents and getAvailableRoster from the state interface
  // because derived data should be computed in the components or via selectors,
  // not returned via functions that create new array references every time they are called.
  getTasksByAgent: (agentId: string) => Task[];
  getTaskById:     (taskId: string) => Task | undefined;

  // Mutations
  inviteAgent:      (agentId: string) => void;
  dismissAgent:     (agentId: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus, reviewNote?: string) => void;
  addTask:          (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void;
  removeTask:       (taskId: string) => void;
  updateTask:       (taskId: string, patch: Partial<Pick<Task, 'title' | 'description' | 'agentId' | 'dependencies' | 'artifacts'>>) => void;
  addChatMessage:   (msg: Omit<ChatMessage, 'id' | 'timestamp' | 'mentions' | 'intent'>) => void;
  updateChatMessageStatus: (msgId: string, status: 'approved' | 'rejected') => void;

  // --- Terminal Store ---
  terminalLogs: Record<string, string[]>;
  agentStatus: Record<string, 'idle' | 'busy'>;

  // Actions
  connectDaemon: () => void;
  upsertAgentSession: (projectId: ProjectId, agentId: string, sessionId: string) => void;
  dispatchToAgent: (input: DispatchToAgentInput) => void;
  appendTerminalLog: (agentId: string, log: string) => void;
  simulateCliExecution: (taskId: string, prompt: string, sessionId?: string) => void;
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

const initialTasks: Task[] = [
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

export const useTaskHubStore = create<TaskHubState>((set, get) => ({
  selectedProjectId: 'default',
  agentSessions: { default: {} },
  activeAgentIds: ['jean', 'keqing'], // Start with two active agents
  tasks: initialTasks,
  chatMessages: initialChatMessages,

  terminalLogs: {},
  agentStatus: {},

  connectDaemon: () => {
    if (socket.connected) return;
    fetch('/api/socketio')
      .catch(() => undefined)
      .finally(() => socket.connect());
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
    return get().tasks.filter((t) => t.agentId === agentId);
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

    set((state) => ({
      agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
      terminalLogs: { ...state.terminalLogs, [agentId]: [] },
    }));

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
    const task = get().tasks.find(t => t.id === taskId);
    const agentId = task ? task.agentId : 'system';
    const resolvedSessionId = sessionId || get().agentSessions[projectId]?.[agentId];

    set((state) => ({
      agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
      terminalLogs: { ...state.terminalLogs, [agentId]: [] }
    }));

    socket.emit('terminal:start', { projectId, taskId, agentId, prompt, sessionId: resolvedSessionId });
  },

  updateTaskStatus: (taskId, status, reviewNote) =>
    (() => {
      const prev = get().getTaskById(taskId);

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

      if (prev && status === 'in_progress') {
        get().dispatchToAgent({
          agentId: prev.agentId,
          referencedTaskId: prev.id,
          prompt: `Start ${prev.id}: ${prev.title}. ${prev.description}`,
        });
      }
    })(),

  addTask: (taskData) => {
    const id = `TASK-${String(taskCounter++).padStart(3, '0')}`;
    const stamp = new Date().toISOString();

    set((state) => ({
      tasks: [
        ...state.tasks,
        { ...taskData, id, createdAt: stamp, updatedAt: stamp },
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
      selectedTaskId:
        state.selectedTaskId === taskId ? null : state.selectedTaskId,
    })),

  updateTask: (taskId, patch) => {
    const prev = get().getTaskById(taskId);

    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, ...patch, updatedAt: new Date().toISOString() }
          : task
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
      for (const mentionedAgentId of mentions) {
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
      chatMessages: state.chatMessages.map((m) =>
        m.id === msgId ? { ...m, approvalStatus: status } : m
      ),
    })),
}));

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
  useTaskHubStore.getState().appendTerminalLog(agentId, `\r\n\x1b[36m[process exited with code ${code}]\x1b[0m\r\n`);
  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
  }));
});
