// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_HYDRATION_TIMEOUT_MS,
  useTaskHubStore,
  type Account,
} from '@/store/taskHubStore';
import { socket } from '@/store/daemonStore';
import type { TeamPack } from '@/types/teamPack';

const CONVERSATION_ID = 'conv-cold-team';
const TEAM_PACK_ID = 'pack-cold-team';
const ACCOUNT_ID = 'account-cold-team';

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function account(): Account {
  return {
    id: ACCOUNT_ID,
    name: 'Cold start account',
    authMode: 'api_key',
    provider: 'openai',
    models: ['gpt-5.4'],
    enabled: true,
    status: 'valid',
    hasApiKey: true,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  };
}

function teamPack(): TeamPack {
  return {
    id: TEAM_PACK_ID,
    specVersion: 'team-pack/0.1',
    name: 'cold-start-team',
    displayName: 'Cold Start Team',
    description: 'Hydration fixture',
    version: '1.0.0',
    tags: [],
    category: 'test',
    teamMode: 'pipeline',
    workflow: { type: 'linear' },
    communicationMatrix: {},
    rules: { requireEvidence: true },
    isPreset: false,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    roles: [{
      id: 'mario',
      displayName: 'Planner',
      soul: '# Planner',
      required: true,
      accountIds: [ACCOUNT_ID],
    }],
  };
}

describe('server hydration runtime gate', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.clear();
    useTaskHubStore.setState({
      hasHydrated: false,
      runtimeRefreshInProgress: false,
      runtimeHydrationError: null,
      conversations: [],
      selectedConversationId: null,
      selectedProjectId: 'default',
      tasks: [],
      phases: [],
      chatMessagesByConversation: {},
      accounts: [],
      activeAgentIds: [],
      currentTeamPack: null,
    });
  });

  it('removes retired integration routing objects from persisted v6 state', async () => {
    localStorage.setItem('agent-task-hub-store-clean', JSON.stringify({
      version: 6,
      state: {
        providerProfiles: [{ id: 'retired-provider' }],
        channelConfigs: [{ id: 'retired-channel' }],
        routingPolicies: [{ id: 'retired-route' }],
      },
    }));

    await useTaskHubStore.persist.rehydrate();

    const state = useTaskHubStore.getState() as unknown as Record<string, unknown>;
    expect(state).not.toHaveProperty('providerProfiles');
    expect(state).not.toHaveProperty('channelConfigs');
    expect(state).not.toHaveProperty('routingPolicies');

    const persisted = JSON.parse(localStorage.getItem('agent-task-hub-store-clean') ?? '{}') as {
      version?: number;
      state?: Record<string, unknown>;
    };
    expect(persisted.version).toBe(9);
    expect(persisted.state).not.toHaveProperty('providerProfiles');
    expect(persisted.state).not.toHaveProperty('channelConfigs');
    expect(persisted.state).not.toHaveProperty('routingPolicies');
  });

  it('removes the retired Mock Runner switch from persisted v7 state', async () => {
    localStorage.setItem('agent-task-hub-store-clean', JSON.stringify({
      version: 7,
      state: { enableMockRunner: true },
    }));

    await useTaskHubStore.persist.rehydrate();

    const state = useTaskHubStore.getState() as unknown as Record<string, unknown>;
    expect(state).not.toHaveProperty('enableMockRunner');

    const persisted = JSON.parse(localStorage.getItem('agent-task-hub-store-clean') ?? '{}') as {
      version?: number;
      state?: Record<string, unknown>;
    };
    expect(persisted.version).toBe(9);
    expect(persisted.state).not.toHaveProperty('enableMockRunner');
  });

  it('migrates legacy browser task statuses and drops unknown persisted tasks', async () => {
    const baseTask = {
      conversationId: CONVERSATION_ID,
      phaseId: '',
      title: 'Legacy task',
      description: '',
      agentId: 'mario',
      dependencies: [],
      artifacts: [],
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
    };
    localStorage.setItem('agent-task-hub-store-clean', JSON.stringify({
      version: 8,
      state: {
        tasks: [
          { ...baseTask, id: 'legacy-pending', status: 'pending' },
          { ...baseTask, id: 'legacy-rejected', status: 'rejected' },
          { ...baseTask, id: 'legacy-unknown', status: 'future_status' },
        ],
      },
    }));

    await useTaskHubStore.persist.rehydrate();

    expect(useTaskHubStore.getState().tasks.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'legacy-pending', status: 'ready' },
      { id: 'legacy-rejected', status: 'in_progress' },
    ]);
    const persisted = JSON.parse(localStorage.getItem('agent-task-hub-store-clean') ?? '{}');
    expect(persisted.version).toBe(9);
  });

  it('keeps the UI gated until accounts and the selected Team Pack are hydrated', async () => {
    let resolveTeamPack!: (response: Response) => void;
    let markTeamPackRequested!: () => void;
    const teamPackResponse = new Promise<Response>((resolve) => {
      resolveTeamPack = resolve;
    });
    const teamPackRequested = new Promise<void>((resolve) => {
      markTeamPackRequested = resolve;
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/state') {
        return json({
          conversations: [{
            id: CONVERSATION_ID,
            title: 'Cold start project',
            goal: 'Verify first-turn dispatch',
            status: 'active',
            priority: 'p1',
            project_path: 'C:/fixture',
            team_pack_id: TEAM_PACK_ID,
            autonomous: true,
            created_at: '2026-07-21T00:00:00.000Z',
            updated_at: '2026-07-21T00:00:00.000Z',
          }],
          tasks: [],
          phases: [{
            id: 'phase-cold',
            conversation_id: CONVERSATION_ID,
            title: 'Cold start',
            order: 0,
            status: 'planned',
            created_at: '2026-07-21T00:00:00.000Z',
            updated_at: '2026-07-21T00:00:00.000Z',
          }],
          recentMessages: {},
          activeSessions: [],
        });
      }
      if (url === '/api/accounts') return json({ accounts: [account()] });
      if (url === '/api/agents') return json({ agents: [] });
      if (url === `/api/team-packs/${TEAM_PACK_ID}`) {
        markTeamPackRequested();
        return teamPackResponse;
      }
      if (url === '/api/skills' || url.includes('/skills')) return json([]);
      return json({});
    }));

    const loading = useTaskHubStore.getState().loadFromServer();
    await teamPackRequested;

    expect(useTaskHubStore.getState().accounts.map((item) => item.id)).toEqual([ACCOUNT_ID]);
    expect(useTaskHubStore.getState().hasHydrated).toBe(false);

    resolveTeamPack(json(teamPack()));
    await loading;

    const state = useTaskHubStore.getState();
    expect(state.hasHydrated).toBe(true);
    expect(state.selectedConversationId).toBe(CONVERSATION_ID);
    expect(state.conversations[0]?.autonomous).toBe(true);
    expect(state.currentTeamPack?.id).toBe(TEAM_PACK_ID);
    expect(state.activeAgentIds).toEqual(['mario']);
    expect(state.getAgentRuntimeProfile('mario')?.execution).toMatchObject({
      engine: 'codex',
      accountId: ACCOUNT_ID,
    });
  });

  it('reuses one hydration run when Strict Mode overlaps state and Team Pack loading', async () => {
    let resolveState!: (response: Response) => void;
    let markStateRequested!: () => void;
    const stateResponse = new Promise<Response>((resolve) => {
      resolveState = resolve;
    });
    const stateRequested = new Promise<void>((resolve) => {
      markStateRequested = resolve;
    });

    let resolveTeamPack!: (response: Response) => void;
    let markTeamPackRequested!: () => void;
    const teamPackResponse = new Promise<Response>((resolve) => {
      resolveTeamPack = resolve;
    });
    const teamPackRequested = new Promise<void>((resolve) => {
      markTeamPackRequested = resolve;
    });

    let stateRequestCount = 0;
    let teamPackRequestCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/state') {
        stateRequestCount += 1;
        markStateRequested();
        return stateResponse;
      }
      if (url === '/api/accounts') return json({ accounts: [account()] });
      if (url === '/api/agents') return json({ agents: [] });
      if (url === `/api/team-packs/${TEAM_PACK_ID}`) {
        teamPackRequestCount += 1;
        markTeamPackRequested();
        return teamPackResponse;
      }
      if (url === '/api/skills' || url.includes('/skills')) return json([]);
      return json({});
    }));

    const first = useTaskHubStore.getState().loadFromServer();
    const second = useTaskHubStore.getState().loadFromServer();
    expect(second).toBe(first);

    await stateRequested;
    expect(stateRequestCount).toBe(1);
    resolveState(json({
      conversations: [{
        id: CONVERSATION_ID,
        title: 'Overlapping cold start',
        goal: 'Verify single-flight hydration',
        status: 'active',
        priority: 'p1',
        project_path: 'C:/fixture',
        team_pack_id: TEAM_PACK_ID,
        created_at: '2026-07-21T00:00:00.000Z',
        updated_at: '2026-07-21T00:00:00.000Z',
      }],
      tasks: [],
      phases: [],
      recentMessages: {},
      activeSessions: [],
    }));

    await teamPackRequested;
    const third = useTaskHubStore.getState().loadFromServer();
    expect(third).toBe(first);
    expect(stateRequestCount).toBe(1);
    expect(teamPackRequestCount).toBe(1);
    expect(useTaskHubStore.getState().hasHydrated).toBe(false);

    resolveTeamPack(json(teamPack()));
    await Promise.all([first, second, third]);

    const hydrated = useTaskHubStore.getState();
    expect(hydrated.hasHydrated).toBe(true);
    expect(hydrated.runtimeHydrationError).toBeNull();
    expect(hydrated.currentTeamPack?.id).toBe(TEAM_PACK_ID);
    expect(hydrated.activeAgentIds).toEqual(['mario']);
    expect(hydrated.getAgentRuntimeProfile('mario')?.execution.accountId).toBe(ACCOUNT_ID);
  });

  it('keeps an interactive workspace mounted while runtime state refreshes', async () => {
    useTaskHubStore.setState({ hasHydrated: true });

    let resolveState!: (response: Response) => void;
    let markStateRequested!: () => void;
    const stateResponse = new Promise<Response>((resolve) => {
      resolveState = resolve;
    });
    const stateRequested = new Promise<void>((resolve) => {
      markStateRequested = resolve;
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/state') {
        markStateRequested();
        return stateResponse;
      }
      if (url === '/api/accounts') return json({ accounts: [] });
      if (url === '/api/agents') return json({ agents: [] });
      if (url === '/api/skills' || url.includes('/skills')) return json([]);
      return json({});
    }));

    const refresh = useTaskHubStore.getState().loadFromServer();
    await stateRequested;

    // ClientHome swaps the entire workspace for LoadingSkeleton whenever this
    // flag is false, which destroys the chat textarea's local draft and focus.
    expect(useTaskHubStore.getState().hasHydrated).toBe(true);

    resolveState(json({
      conversations: [],
      tasks: [],
      phases: [],
      recentMessages: {},
      activeSessions: [],
    }));
    await refresh;

    expect(useTaskHubStore.getState().hasHydrated).toBe(true);
  });

  it('does not let a delayed state snapshot overwrite a newer Task socket revision', async () => {
    useTaskHubStore.setState({
      hasHydrated: true,
      selectedConversationId: CONVERSATION_ID,
      selectedProjectId: CONVERSATION_ID,
    });
    let resolveState!: (response: Response) => void;
    let markStateRequested!: () => void;
    const stateResponse = new Promise<Response>((resolve) => { resolveState = resolve; });
    const stateRequested = new Promise<void>((resolve) => { markStateRequested = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/state') {
        markStateRequested();
        return stateResponse;
      }
      if (url === '/api/accounts') return json({ accounts: [] });
      if (url === '/api/agents') return json({ agents: [] });
      if (url === '/api/skills' || url.includes('/skills')) return json([]);
      return json([]);
    }));

    const refresh = useTaskHubStore.getState().loadFromServer();
    await stateRequested;
    emitServerEvent('task.state', {
      projectId: CONVERSATION_ID,
      task: {
        id: 'TASK-STATE-RACE',
        conversation_id: CONVERSATION_ID,
        title: 'New socket fact',
        description: '',
        status: 'blocked',
        agent_id: 'mario',
        dependencies: '[]',
        artifacts: '[]',
        revision: 2,
        created_at: '2026-08-16T00:00:00.000Z',
        updated_at: '2026-08-16T00:02:00.000Z',
      },
    });
    resolveState(json({
      conversations: [{
        id: CONVERSATION_ID,
        title: 'Hydration race',
        goal: '',
        status: 'active',
        priority: 'p1',
        project_path: 'C:/fixture',
        created_at: '2026-08-16T00:00:00.000Z',
        updated_at: '2026-08-16T00:00:00.000Z',
      }],
      tasks: [{
        id: 'TASK-STATE-RACE',
        conversation_id: CONVERSATION_ID,
        title: 'Old HTTP snapshot',
        description: '',
        status: 'in_progress',
        agent_id: 'mario',
        dependencies: '[]',
        artifacts: '[]',
        revision: 1,
        created_at: '2026-08-16T00:00:00.000Z',
        updated_at: '2026-08-16T00:01:00.000Z',
      }],
      phases: [],
      recentMessages: {},
      activeSessions: [],
    }));
    await refresh;

    expect(useTaskHubStore.getState().getTaskById('TASK-STATE-RACE')).toMatchObject({
      title: 'New socket fact',
      status: 'blocked',
      revision: 2,
    });
  });

  it('does not let a delayed state snapshot erase a Task created by Socket after hydration began', async () => {
    useTaskHubStore.setState({
      hasHydrated: true,
      selectedConversationId: CONVERSATION_ID,
      selectedProjectId: CONVERSATION_ID,
      tasks: [],
    });
    let resolveState!: (response: Response) => void;
    let markStateRequested!: () => void;
    const stateResponse = new Promise<Response>((resolve) => { resolveState = resolve; });
    const stateRequested = new Promise<void>((resolve) => { markStateRequested = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/state') {
        markStateRequested();
        return stateResponse;
      }
      if (url === '/api/accounts') return json({ accounts: [] });
      if (url === '/api/agents') return json({ agents: [] });
      if (url === '/api/skills' || url.includes('/skills')) return json([]);
      return json([]);
    }));

    const refresh = useTaskHubStore.getState().loadFromServer();
    await stateRequested;
    emitServerEvent('task.state', {
      projectId: CONVERSATION_ID,
      task: {
        id: 'TASK-SOCKET-CREATED',
        conversation_id: CONVERSATION_ID,
        title: 'Socket-created task',
        description: '',
        status: 'ready',
        agent_id: 'mario',
        dependencies: '[]',
        artifacts: '[]',
        revision: 0,
        created_at: '2026-08-16T00:03:00.000Z',
        updated_at: '2026-08-16T00:03:00.000Z',
      },
    });
    resolveState(json({
      conversations: [{
        id: CONVERSATION_ID,
        title: 'Hydration race',
        goal: '',
        status: 'active',
        priority: 'p1',
        project_path: 'C:/fixture',
        created_at: '2026-08-16T00:00:00.000Z',
        updated_at: '2026-08-16T00:00:00.000Z',
      }],
      tasks: [],
      phases: [],
      recentMessages: {},
      activeSessions: [],
    }));
    await refresh;

    expect(useTaskHubStore.getState().getTaskById('TASK-SOCKET-CREATED')).toMatchObject({
      title: 'Socket-created task',
      revision: 0,
    });
  });

  it('fails closed when an authoritative Task hydration row has no revision', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/state') {
        return json({
          conversations: [],
          tasks: [{
            id: 'TASK-NO-REVISION',
            conversation_id: CONVERSATION_ID,
            title: 'Malformed task',
            status: 'ready',
            agent_id: 'mario',
          }],
          phases: [],
          recentMessages: {},
          activeSessions: [],
        });
      }
      return json({});
    }));

    await useTaskHubStore.getState().loadFromServer();

    expect(useTaskHubStore.getState().runtimeHydrationError)
      .toContain('task_revision_invalid:TASK-NO-REVISION');
    expect(useTaskHubStore.getState().tasks).toEqual([]);
  });

  it('exits the loading skeleton with a retryable error when accounts time out', async () => {
    vi.useFakeTimers();
    let markAccountsRequested!: () => void;
    const accountsRequested = new Promise<void>((resolve) => {
      markAccountsRequested = resolve;
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/state') {
        return json({
          conversations: [{
            id: CONVERSATION_ID,
            title: 'Cold start project',
            goal: 'Verify timeout fallback',
            status: 'active',
            priority: 'p1',
            project_path: 'C:/fixture',
            team_pack_id: TEAM_PACK_ID,
            created_at: '2026-07-21T00:00:00.000Z',
            updated_at: '2026-07-21T00:00:00.000Z',
          }],
          tasks: [],
          phases: [{
            id: 'phase-cold',
            conversation_id: CONVERSATION_ID,
            title: 'Cold start',
            order: 0,
            status: 'planned',
            created_at: '2026-07-21T00:00:00.000Z',
            updated_at: '2026-07-21T00:00:00.000Z',
          }],
          recentMessages: {},
          activeSessions: [],
        });
      }
      if (url === '/api/accounts') {
        markAccountsRequested();
        return new Promise<Response>(() => {});
      }
      return json({});
    }));

    const loading = useTaskHubStore.getState().loadFromServer();
    await accountsRequested;
    expect(useTaskHubStore.getState().hasHydrated).toBe(false);

    await vi.advanceTimersByTimeAsync(RUNTIME_HYDRATION_TIMEOUT_MS + 1);
    await loading;

    expect(useTaskHubStore.getState()).toMatchObject({
      hasHydrated: true,
      runtimeHydrationError: '账号配置加载超时，请重试。',
    });
  });

  it('times out when headers arrive but the state response body never settles', async () => {
    vi.useFakeTimers();
    let markBodyParsingStarted!: () => void;
    const bodyParsingStarted = new Promise<void>((resolve) => {
      markBodyParsingStarted = resolve;
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/state') {
        return {
          ok: true,
          status: 200,
          json: () => {
            markBodyParsingStarted();
            return new Promise<unknown>(() => {});
          },
        } as Response;
      }
      return json({});
    }));

    const loading = useTaskHubStore.getState().loadFromServer();
    await bodyParsingStarted;
    expect(useTaskHubStore.getState().hasHydrated).toBe(false);

    await vi.advanceTimersByTimeAsync(RUNTIME_HYDRATION_TIMEOUT_MS + 1);
    await loading;

    expect(useTaskHubStore.getState()).toMatchObject({
      hasHydrated: true,
      runtimeHydrationError: '项目状态加载超时，请重试。',
    });
  });

  it('exits the loading skeleton with a retryable error when the Agent roster times out', async () => {
    vi.useFakeTimers();
    let markAgentsRequested!: () => void;
    const agentsRequested = new Promise<void>((resolve) => {
      markAgentsRequested = resolve;
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/state') {
        return json({
          conversations: [{
            id: CONVERSATION_ID,
            title: 'Cold start project',
            goal: 'Verify Agent roster timeout fallback',
            status: 'active',
            priority: 'p1',
            project_path: 'C:/fixture',
            team_pack_id: TEAM_PACK_ID,
            created_at: '2026-07-21T00:00:00.000Z',
            updated_at: '2026-07-21T00:00:00.000Z',
          }],
          tasks: [],
          phases: [{
            id: 'phase-cold',
            conversation_id: CONVERSATION_ID,
            title: 'Cold start',
            order: 0,
            status: 'planned',
            created_at: '2026-07-21T00:00:00.000Z',
            updated_at: '2026-07-21T00:00:00.000Z',
          }],
          recentMessages: {},
          activeSessions: [],
        });
      }
      if (url === '/api/accounts') return json({ accounts: [account()] });
      if (url === '/api/agents') {
        markAgentsRequested();
        return new Promise<Response>(() => {});
      }
      return json({});
    }));

    const loading = useTaskHubStore.getState().loadFromServer();
    await agentsRequested;
    expect(useTaskHubStore.getState().hasHydrated).toBe(false);

    await vi.advanceTimersByTimeAsync(RUNTIME_HYDRATION_TIMEOUT_MS + 1);
    await loading;

    expect(useTaskHubStore.getState()).toMatchObject({
      hasHydrated: true,
      runtimeHydrationError: '智能体配置加载超时，请重试。',
    });
  });

  it('surfaces a Team Pack failure and clears it after a successful retry', async () => {
    let rejectTeamPack = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/state') {
        return json({
          conversations: [{
            id: CONVERSATION_ID,
            title: 'Cold start project',
            goal: 'Verify retry',
            status: 'active',
            priority: 'p1',
            project_path: 'C:/fixture',
            team_pack_id: TEAM_PACK_ID,
            created_at: '2026-07-21T00:00:00.000Z',
            updated_at: '2026-07-21T00:00:00.000Z',
          }],
          tasks: [],
          phases: [{
            id: 'phase-cold',
            conversation_id: CONVERSATION_ID,
            title: 'Cold start',
            order: 0,
            status: 'planned',
            created_at: '2026-07-21T00:00:00.000Z',
            updated_at: '2026-07-21T00:00:00.000Z',
          }],
          recentMessages: {},
          activeSessions: [],
        });
      }
      if (url === '/api/accounts') return json({ accounts: [account()] });
      if (url === '/api/agents') return json({ agents: [] });
      if (url === `/api/team-packs/${TEAM_PACK_ID}`) {
        if (rejectTeamPack) throw new Error('offline');
        return json(teamPack());
      }
      if (url === '/api/skills' || url.includes('/skills')) return json([]);
      return json({});
    }));

    await useTaskHubStore.getState().loadFromServer();
    expect(useTaskHubStore.getState()).toMatchObject({
      hasHydrated: true,
      runtimeHydrationError: '团队运行配置加载失败，请重试。',
      currentTeamPack: null,
    });

    rejectTeamPack = false;
    await useTaskHubStore.getState().loadFromServer();
    const retried = useTaskHubStore.getState();
    expect(retried.runtimeHydrationError).toBeNull();
    expect(retried.currentTeamPack?.id).toBe(TEAM_PACK_ID);
    expect(retried.getAgentRuntimeProfile('mario')?.execution.accountId).toBe(ACCOUNT_ID);
  });
});
