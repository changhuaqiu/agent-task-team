// src/__tests__/server/a2a/integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import { resetDb, setTestDb } from '@/server/db';
import { AgentMessenger } from '@/server/a2a';
import { createRuntimeSnapshotProvider } from '@/server/a2a/runtime-snapshot-provider';
import { resolveTeamRuntime } from '@/lib/team-runtime';
import type { AgentMentionConfig } from '@/server/a2a/types-v2';
import type { KanbanSnapshotProvider } from '@/server/a2a';
import type { CommunicationPolicy } from '@/lib/team-runtime';
import type { TeamPack } from '@/types/teamPack';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

function mockIO() {
  const emitted: any[] = [];
  return {
    emit: (...args: any[]) => emitted.push(args),
    emitted: () => emitted,
  };
}

const AGENTS: AgentMentionConfig[] = [
  { id: 'mario', mentionPatterns: ['@mario'] },
  { id: 'luigi', mentionPatterns: ['@luigi'] },
  { id: 'peach', mentionPatterns: ['@peach'] },
  { id: 'toad', mentionPatterns: ['@toad'] },
];

const TEAM_AGENTS: AgentMentionConfig[] = [
  { id: 'planner', mentionPatterns: ['@planner'] },
  { id: 'reviewer', mentionPatterns: ['@reviewer'] },
];

function teamPackWithPlannerReviewer(canPlannerSendToReviewer: boolean): TeamPack {
  return {
    id: 'pack-a2a',
    specVersion: 'team-pack/0.1',
    name: 'a2a-pack',
    displayName: 'A2A Pack',
    description: 'A2A policy test pack',
    version: '1.0.0',
    tags: [],
    category: 'test',
    roles: [
      { id: 'planner', displayName: 'Planner', soul: '', required: true },
      { id: 'reviewer', displayName: 'Reviewer', soul: '', required: true },
    ],
    teamMode: 'pipeline',
    workflow: { type: 'linear' },
    communicationMatrix: {
      planner: { canSendTo: canPlannerSendToReviewer ? ['reviewer'] : [], canReceiveFrom: [] },
      reviewer: { canSendTo: [], canReceiveFrom: canPlannerSendToReviewer ? ['planner'] : [] },
    },
    isPreset: false,
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

function createPersistedTeamPack(canPlannerSendToReviewer: boolean, reviewer = { id: 'reviewer', displayName: 'Reviewer' }): TeamPack {
  return teamPackRepo.create({
    name: `a2a-pack-${canPlannerSendToReviewer ? 'allow' : 'block'}-${reviewer.id}`,
    displayName: 'A2A Pack',
    description: 'A2A policy test pack',
    version: '1.0.0',
    tags: [],
    category: 'test',
    roles: [
      { id: 'planner', displayName: 'Planner', soul: '', required: true },
      { id: reviewer.id, displayName: reviewer.displayName, soul: '', required: true },
    ],
    teamMode: 'pipeline',
    workflow: { type: 'linear' },
    communicationMatrix: {
      planner: { canSendTo: canPlannerSendToReviewer ? [reviewer.id] : [], canReceiveFrom: [] },
      [reviewer.id]: { canSendTo: [], canReceiveFrom: canPlannerSendToReviewer ? ['planner'] : [] },
    },
  });
}

function communicationPolicyFromTeamPack(teamPack: TeamPack): CommunicationPolicy {
  return resolveTeamRuntime({
    conversationId: 'conv-1',
    teamPack,
    presetAgents: [],
    activeAgentIds: ['planner', 'reviewer'],
    roleCards: [],
    skillsMap: {},
    agentSkillIds: {},
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
  }).communicationPolicy;
}

function createMessengerWithPolicy(policy: CommunicationPolicy): AgentMessenger {
  const snapshotProvider: KanbanSnapshotProvider = {
    getTasks: () => testTasks,
    getCommunicationPolicy: () => policy,
  };

  const policyMessenger = new AgentMessenger(db, io as any, TEAM_AGENTS, snapshotProvider);
  policyMessenger.orchestrator.reset();
  return policyMessenger;
}

let db: Database.Database;
let io: ReturnType<typeof mockIO>;
let messenger: AgentMessenger;
let testTasks: { id: string; title: string; status: string; agent_id: string }[];

beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);
  setTestDb(db);
  db.prepare(`INSERT INTO conversation (id, created_at, updated_at) VALUES (?, ?, ?)`)
    .run('conv-1', new Date().toISOString(), new Date().toISOString());
  io = mockIO();
  testTasks = [];

  const snapshotProvider: KanbanSnapshotProvider = {
    getTasks: () => testTasks,
  };

  messenger = new AgentMessenger(db, io as any, AGENTS, snapshotProvider);
  messenger.orchestrator.reset();
});

afterEach(() => {
  resetDb();
  db.close();
});

describe('A2A v2 integration', () => {
  it('creates chain on user message and dispatches to target agent', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'luigi', '请开始实现前端');

    const dispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0][1].agentId).toBe('luigi');
    expect(dispatches[0][1].prompt).toContain('请开始实现前端');
    expect(dispatches[0][1].chainId).toBeDefined();
  });

  it('agent @mention creates worklist entry and dispatches', async () => {
    // Create a chain first (simulates user message trigger)
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始设计');

    // Mario completes and @mentions Luigi (response must be > 30 chars to trigger scan)
    await messenger.onAgentResponse('mario', '架构设计已完成，使用 JWT 认证方案。\n@luigi 请实现前端登录组件，包含表单验证和错误处理', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const dispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    // First dispatch to mario, second to luigi
    const luigiDispatch = dispatches.find(([, p]) => p.agentId === 'luigi');
    expect(luigiDispatch).toBeDefined();
    expect(luigiDispatch![1].prompt).toContain('请实现前端登录组件');
  });

  it('allows agent-originated A2A dispatch when CommunicationPolicy permits the target', async () => {
    messenger = createMessengerWithPolicy(communicationPolicyFromTeamPack(teamPackWithPlannerReviewer(true)));

    messenger.onUserMessage('conv-1', 'msg-1', 'planner', '请规划功能');

    await messenger.onAgentResponse('planner', '方案已经确认，下一步需要审查边界条件。\n@reviewer 请审查计划中的测试覆盖、风险项和验收标准', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const reviewerDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'reviewer');
    expect(reviewerDispatches).toHaveLength(1);
    expect(reviewerDispatches[0][1].fromAgentId).toBe('planner');
    expect(reviewerDispatches[0][1].prompt).toContain('请审查计划中的测试覆盖');

    const logs = db.prepare(`
      SELECT * FROM a2a_audit_log
      WHERE event_type = 'dispatch_allowed' AND from_agent_id = 'planner' AND to_agent_id = 'reviewer'
    `).all() as any[];
    expect(logs).toHaveLength(1);
  });

  it('blocks agent-originated A2A dispatch when CommunicationPolicy disallows the target', async () => {
    messenger = createMessengerWithPolicy(communicationPolicyFromTeamPack(teamPackWithPlannerReviewer(false)));

    messenger.onUserMessage('conv-1', 'msg-1', 'planner', '请规划功能');

    await messenger.onAgentResponse('planner', '方案已经确认，但这次协作规则不允许直接交给审查角色。\n@reviewer 请审查计划中的测试覆盖、风险项和验收标准', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const reviewerDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'reviewer');
    expect(reviewerDispatches).toHaveLength(0);

    const systemEvents = io.emitted().filter(([e, p]) => e === 'agent:event' && p.type === 'system');
    expect(systemEvents.some(([, p]) => p.content.includes('团队协作规则阻止了这次转交'))).toBe(true);

    const blockedLogs = db.prepare(`
      SELECT * FROM a2a_audit_log
      WHERE event_type = 'dispatch_blocked' AND from_agent_id = 'planner' AND to_agent_id = 'reviewer'
    `).all() as any[];
    expect(blockedLogs).toHaveLength(1);
    expect(blockedLogs[0].reason).toBe('团队协作规则阻止了这次转交');
  });

  it('uses persisted TeamPack runtime provider to block disallowed production-like A2A', async () => {
    const pack = createPersistedTeamPack(false);
    db.prepare('UPDATE conversation SET team_pack_id = ? WHERE id = ?').run(pack.id, 'conv-1');
    messenger = new AgentMessenger(db, io as any, AGENTS, createRuntimeSnapshotProvider());
    messenger.orchestrator.reset();

    messenger.onUserMessage('conv-1', 'msg-1', 'planner', '请规划功能');

    await messenger.onAgentResponse('planner', '方案已经确认，但协作规则不允许直接交给审查角色。\n@reviewer 请审查计划中的测试覆盖、风险项和验收标准', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const reviewerDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'reviewer');
    expect(reviewerDispatches).toHaveLength(0);

    const blockedLogs = db.prepare(`
      SELECT * FROM a2a_audit_log
      WHERE event_type = 'dispatch_blocked' AND from_agent_id = 'planner' AND to_agent_id = 'reviewer'
    `).all() as any[];
    expect(blockedLogs).toHaveLength(1);
    expect(blockedLogs[0].reason).toBe('团队协作规则阻止了这次转交');
  });

  it('detects TeamPack role display-name mentions that are absent from static DB agents', async () => {
    const pack = createPersistedTeamPack(true, { id: 'qa-lead', displayName: 'Quality Captain' });
    db.prepare('UPDATE conversation SET team_pack_id = ? WHERE id = ?').run(pack.id, 'conv-1');
    messenger = new AgentMessenger(db, io as any, AGENTS, createRuntimeSnapshotProvider());
    messenger.orchestrator.reset();

    messenger.onUserMessage('conv-1', 'msg-1', 'planner', '请规划功能');

    await messenger.onAgentResponse('planner', '方案已经确认，下一步需要质量负责人审查。\n@Quality Captain 请审查计划中的测试覆盖、风险项和验收标准', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const qaDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'qa-lead');
    expect(qaDispatches).toHaveLength(1);
    expect(qaDispatches[0][1].fromAgentId).toBe('planner');
  });

  it('does not apply CommunicationPolicy to direct user-to-agent dispatch', () => {
    messenger = createMessengerWithPolicy(communicationPolicyFromTeamPack(teamPackWithPlannerReviewer(false)));

    messenger.onUserMessage('conv-1', 'msg-1', 'reviewer', '请直接审查这个需求');

    const reviewerDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'reviewer');
    expect(reviewerDispatches).toHaveLength(1);
    expect(reviewerDispatches[0][1].fromAgentId).toBe('user');
  });

  it('no @mention → no dispatch beyond initial', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    await messenger.onAgentResponse('mario', 'Just a regular message with no mentions', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const dispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    // Only the initial dispatch to mario
    expect(dispatches).toHaveLength(1);
  });

  it('short responses (< 50 chars) do not trigger @mention scan', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    await messenger.onAgentResponse('mario', '收到。@luigi 待命', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const dispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    // Only initial dispatch — ack-like response should NOT trigger new dispatch
    expect(dispatches).toHaveLength(1);
  });

  it('content hash dedup: same content not dispatched twice', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    const longContent = '架构设计完成，前端使用 React Query 管理状态。\n@luigi 请实现前端登录组件，包含完整的表单验证逻辑和用户友好的错误提示信息';
    await messenger.onAgentResponse('mario', longContent, {
      conversationId: 'conv-1',
      chainDepth: 0,
    });
    // Try to dispatch same content again
    await messenger.onAgentResponse('mario', longContent, {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(1);
  });

  it('chain-scoped agent dedup: same agent only dispatched once per chain', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    await messenger.onAgentResponse('mario', '@luigi 请实现前端登录组件，包括表单验证和错误处理逻辑', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });
    await messenger.onAgentResponse('peach', '@luigi 请也帮我实现一下注册页面的样式和布局设计', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'luigi');
    // Only dispatched once due to agent dedup within chain
    expect(luigiDispatches).toHaveLength(1);
  });

  it('new user message aborts old chain', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '第一个任务');

    const chain1 = messenger.orchestrator.getActiveChain('conv-1');
    expect(chain1).not.toBeNull();
    const chain1Id = chain1!.id;

    messenger.onUserMessage('conv-1', 'msg-2', 'luigi', '新任务');

    // Old chain should be aborted
    const oldChain = (db.prepare('SELECT status FROM invocation_chain WHERE id = ?').get(chain1Id) as any);
    expect(oldChain.status).toBe('aborted');

    // New chain should be active
    const chain2 = messenger.orchestrator.getActiveChain('conv-1');
    expect(chain2).not.toBeNull();
    expect(chain2!.id).not.toBe(chain1Id);
  });

  it('does not inject completed work from an old user chain into a new chain prompt', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '旧链路任务：设计认证方案');
    await messenger.onAgentResponse('mario', '旧链路已经完成，没有新的协作转交，只记录最终方案。', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    messenger.onUserMessage('conv-1', 'msg-2', 'luigi', '新链路任务：实现登录页面');

    const luigiDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(1);
    expect(luigiDispatches[0][1].prompt).toContain('新链路任务：实现登录页面');
    expect(luigiDispatches[0][1].prompt).not.toContain('旧链路任务：设计认证方案');
  });

  it('blocks and marks an expired chain as timeout before accepting new dispatch work', () => {
    const chain = messenger.orchestrator.createChain({
      conversationId: 'conv-1',
      type: 'user_message',
      messageId: 'msg-expired',
      config: { maxDurationMs: 1 },
    });
    db.prepare('UPDATE invocation_chain SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 5_000).toISOString(), chain.id);

    const decision = messenger.orchestrator.requestDispatch({
      chainId: chain.id,
      fromAgentId: 'mario',
      toAgentId: 'luigi',
      content: '请继续这条已经过期的链路',
      depth: 1,
    });

    expect(decision.allow).toBe(false);
    const row = db.prepare('SELECT status FROM invocation_chain WHERE id = ?').get(chain.id) as any;
    expect(row.status).toBe('timeout');
  });

  it('dispatch prompt includes task context and response guidance', async () => {
    testTasks = [
      { id: 'task-1', title: 'Fix auth bug', status: 'doing', agent_id: 'luigi' },
    ];

    messenger.onUserMessage('conv-1', 'msg-1', 'luigi', '请修复 auth bug');

    const dispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    expect(dispatches).toHaveLength(1);
    const prompt = dispatches[0][1].prompt;
    expect(prompt).toContain('Fix auth bug');
    expect(prompt).toContain('不要广播状态');
    expect(prompt).toContain('不要确认收到');
    expect(prompt).toContain('删除文件内容后');
  });

  it('dispatch prompt includes file mutex for other executing agents', async () => {
    testTasks = [
      { id: 'task-1', title: 'Implement login page', status: 'doing', agent_id: 'mario' },
      { id: 'task-2', title: 'Write API tests', status: 'doing', agent_id: 'luigi' },
    ];

    messenger.onUserMessage('conv-1', 'msg-1', 'luigi', '请写测试');

    const dispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    expect(dispatches).toHaveLength(1);
    const prompt = dispatches[0][1].prompt;
    // Luigi should see Mario's task in the mutex section
    expect(prompt).toContain('编辑互斥');
    expect(prompt).toContain('Implement login page');
    expect(prompt).toContain('mario');
    // Luigi should NOT see his own task in the mutex section
    expect(prompt).not.toContain('[luigi] Write API tests');
  });

  it('direct ping-pong is immediately blocked', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    // Mario @mentions Luigi with substantive content
    await messenger.onAgentResponse('mario', '@luigi 请实现前端登录组件，需要包含完整的表单验证逻辑和错误处理', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    // Simulate Luigi completing and then trying to @mention Mario back
    // First, mark luigi's entry as executing (simulate dispatch)
    const chain = messenger.orchestrator.getActiveChain('conv-1');
    if (chain) {
      const worklist = db.prepare('SELECT * FROM chain_worklist WHERE chain_id = ?').all(chain.id) as any[];
      const luigiEntry = worklist.find((w: any) => w.agent_id === 'luigi');
      if (luigiEntry) {
        db.prepare("UPDATE chain_worklist SET status = 'executing' WHERE id = ?").run(luigiEntry.id);
      }
    }

    await messenger.onAgentResponse('luigi', '@mario 我有个问题需要确认一下关于登录组件的设计规范和交互细节', {
      conversationId: 'conv-1',
      chainDepth: 1,
    });

    // Should see a system event about blocking
    const systemEvents = io.emitted().filter(([e, p]) => e === 'agent:event' && p.type === 'system');
    const blocked = systemEvents.some(([, p]) => p.content.includes('拦截'));
    expect(blocked).toBe(true);
  });

  it('audit log records chain lifecycle events', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    const logs = db.prepare("SELECT * FROM a2a_audit_log WHERE conversation_id = 'conv-1' ORDER BY created_at").all() as any[];
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l: any) => l.event_type === 'chain_created')).toBe(true);
  });
});
