// src/__tests__/server/a2a/integration.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  const roomEmitted: any[] = [];
  return {
    emit: (...args: any[]) => emitted.push(args),
    to: (room: string) => ({
      emit: (...args: any[]) => {
        roomEmitted.push([room, ...args]);
        emitted.push(args);
      },
    }),
    emitted: () => emitted,
    roomEmitted: () => roomEmitted,
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

  it('emits A2A dispatch events only to the conversation room', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'luigi', '请开始实现前端');

    const roomDispatches = io.roomEmitted().filter(([, event]) => event === 'a2a:dispatch');
    expect(roomDispatches).toHaveLength(1);
    expect(roomDispatches[0][0]).toBe('conv-1');
    expect(roomDispatches[0][2].conversationId).toBe('conv-1');
  });

  it('agent @mention creates worklist entry and dispatches', async () => {
    // Create a chain first (simulates user message trigger)
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始设计');

    // Mario completes and @mentions Luigi (response must be > 50 chars to trigger scan)
    await messenger.onAgentResponse('mario', '架构设计已完成，使用 JWT 认证方案，并补充了错误处理、登录态持久化和接口边界。\n@luigi 请实现前端登录组件，包含表单验证和错误处理', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const dispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    // First dispatch to mario, second to luigi
    const luigiDispatch = dispatches.find(([, p]) => p.agentId === 'luigi');
    expect(luigiDispatch).toBeDefined();
    expect(luigiDispatch![1].prompt).toContain('请实现前端登录组件');
  });

  it('does not dispatch non-actionable mentions from the current holder', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始设计');

    await messenger.onAgentResponse('mario', '方案上下文记录：这和 @luigi 上次说的一样，但现在还不需要转交。', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(0);

    const passes = db.prepare(`
      SELECT * FROM a2a_pass WHERE to_agent_id = 'luigi'
    `).all() as any[];
    expect(passes).toHaveLength(0);
  });

  it('renders notification-style mentions as group-chat awareness without waking the mentioned agent', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'peach', '请完成 TASK-006 代码评审');

    await messenger.onAgentResponse(
      'peach',
      'TASK-006 评审已完成，结论 PASS-WITH-NOTES。通知 @mario 查看 TASK-006 结果，状态和评审说明已写入 TASKS.md，后续任务可以从看板继续推进。',
      {
        conversationId: 'conv-1',
        chainDepth: 0,
      },
    );

    const marioDispatches = io.emitted().filter(([event, payload]) => event === 'a2a:dispatch' && payload.agentId === 'mario');
    expect(marioDispatches).toHaveLength(0);

    const notices = io.roomEmitted()
      .filter(([room, event, payload]) => room === 'conv-1' && event === 'agent:event' && payload.type === 'system')
      .map(([, , payload]) => payload.content);
    expect(notices.some((content) => (
      content.includes('群聊知会')
      && content.includes('@mario')
      && content.includes('不会启动新的 A2A 执行')
      && content.includes('@agent 请评审/实现/验证')
    ))).toBe(true);
  });

  it('records possession and handoff packet for an explicit pass', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始设计');

    await messenger.onAgentResponse('mario', '设计已完成。\n@luigi 请实现前端登录组件，包含表单验证和错误处理', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const pass = db.prepare(`
      SELECT * FROM a2a_pass WHERE from_holder_id = 'mario' AND to_agent_id = 'luigi'
    `).get() as any;
    expect(pass).toBeDefined();
    expect(pass.status).toBe('offered');
    expect(pass.intent).toBe('implement');

    const packet = db.prepare(`
      SELECT * FROM a2a_handoff_packet WHERE pass_id = ?
    `).get(pass.id) as any;
    expect(packet.requested_action).toContain('请实现前端登录组件');
    expect(packet.forbidden_behaviors).toContain('不要只回复确认收到');
  });

  it('routes dispatch summary table mentions as handoffs', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '请派发任务');

    await messenger.onAgentResponse('mario', [
      '两个 agent 重新派发完毕：',
      '任务 Agent Task ID 状态',
      'TASK-001+002 @luigi bg_59d463d0 运行中',
      'TASK-004+005 @toad bg_b806e569 运行中',
    ].join('\n'), {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'luigi');
    const toadDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'toad');

    expect(luigiDispatches).toHaveLength(1);
    expect(toadDispatches).toHaveLength(1);
    expect(luigiDispatches[0][1].prompt).toContain('重新派发完毕');
    expect(toadDispatches[0][1].prompt).toContain('重新派发完毕');
  });

  it('allows fan-out branch holders to complete independently', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '请派发并行审查');

    await messenger.onAgentResponse('mario', [
      '并行审查开始：',
      '@peach 请审查 UI 风险、验收标准和边界条件',
      '@toad 请审查后端 API、状态流转和失败恢复',
    ].join('\n'), {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const peachDispatch = io.emitted().find(([event, payload]) => event === 'a2a:dispatch' && payload.agentId === 'peach');
    const toadDispatch = io.emitted().find(([event, payload]) => event === 'a2a:dispatch' && payload.agentId === 'toad');
    expect(peachDispatch).toBeDefined();
    expect(toadDispatch).toBeDefined();

    messenger.orchestrator.markDispatchStarted(peachDispatch![1].chainId, peachDispatch![1].entryId, 'conv-1', 'peach', peachDispatch![1].passId);
    messenger.orchestrator.markDispatchStarted(toadDispatch![1].chainId, toadDispatch![1].entryId, 'conv-1', 'toad', toadDispatch![1].passId);

    await messenger.onAgentResponse('peach', 'UI 审查完成：建议保留可见的交接历史和阻塞原因，不需要继续转交。', {
      conversationId: 'conv-1',
      chainDepth: 1,
    });

    const nonHolderBlocks = db.prepare(`
      SELECT * FROM a2a_audit_log
      WHERE conversation_id = ? AND reason LIKE 'non-holder response ignored%'
    `).all('conv-1') as any[];
    expect(nonHolderBlocks).toHaveLength(0);

    const peachEntry = db.prepare(`
      SELECT status, outcome FROM chain_worklist WHERE agent_id = 'peach'
    `).get() as any;
    expect(peachEntry).toMatchObject({ status: 'done', outcome: 'success' });
  });

  it('defers busy A2A deliveries and retries when the target becomes idle', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'luigi', '请实现服务端投递队列和 busy 重试');
    const chain = messenger.orchestrator.getActiveChain('conv-1')!;

    const firstDispatches = io.emitted().filter(([event, payload]) => event === 'a2a:dispatch' && payload.agentId === 'luigi');
    expect(firstDispatches).toHaveLength(1);

    messenger.orchestrator.markDispatchDeferred(
      chain.id,
      firstDispatches[0][1].entryId,
      'conv-1',
      'luigi',
      'target agent is busy',
      firstDispatches[0][1].passId,
    );

    const deferredEntry = db.prepare('SELECT status FROM chain_worklist WHERE id = ?').get(firstDispatches[0][1].entryId) as any;
    expect(deferredEntry.status).toBe('queued');

    messenger.orchestrator.onAgentDone('luigi', 'conv-1');

    const allDispatches = io.emitted().filter(([event, payload]) => event === 'a2a:dispatch' && payload.agentId === 'luigi');
    expect(allDispatches).toHaveLength(2);

    const delivery = db.prepare(`
      SELECT status, attempts, last_error FROM a2a_delivery
      WHERE entry_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(firstDispatches[0][1].entryId) as any;
    expect(delivery).toMatchObject({ status: 'sent', last_error: null });
    expect(delivery.attempts).toBeGreaterThanOrEqual(2);
  });

  it('registers client-driven user fan-out as independent holders', async () => {
    messenger.registerExternalUserDispatch('conv-1', 'msg-1', ['mario', 'luigi'], '@mario @luigi 并行分析协作链路');

    expect(messenger.orchestrator.getAgentState('mario').status).toBe('executing');
    expect(messenger.orchestrator.getAgentState('luigi').status).toBe('executing');

    const openHolders = db.prepare(`
      SELECT holder_id FROM a2a_possession
      WHERE chain_id = ? AND status = 'open'
      ORDER BY holder_id ASC
    `).all(messenger.orchestrator.getActiveChain('conv-1')!.id) as Array<{ holder_id: string }>;
    expect(openHolders.map((holder) => holder.holder_id)).toEqual(['luigi', 'mario']);

    await messenger.onAgentResponse('mario', '我已经完成链路分析，需要后端继续落地。\n@toad 请实现分支持球的服务端状态恢复和验证测试', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const toadDispatches = io.emitted().filter(([event, payload]) => event === 'a2a:dispatch' && payload.agentId === 'toad');
    expect(toadDispatches).toHaveLength(1);

    const nonHolderBlocks = db.prepare(`
      SELECT * FROM a2a_audit_log
      WHERE conversation_id = ? AND reason LIKE 'non-holder response ignored%'
    `).all('conv-1') as any[];
    expect(nonHolderBlocks).toHaveLength(0);
  });

  it('routes agent @mention after client-driven direct dispatch is registered as executing', async () => {
    messenger.registerExternalUserDispatch('conv-1', 'msg-1', ['mario'], '@mario 开始设计');

    const initialDispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    expect(initialDispatches).toHaveLength(0);

    await messenger.onAgentResponse('mario', '编码实现已经完成，关键路径、异常路径和测试说明都已经补齐，下一步需要审查。\n@luigi 请审查这次改动的边界条件和测试覆盖', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(1);
    expect(luigiDispatches[0][1].fromAgentId).toBe('mario');
    expect(luigiDispatches[0][1].prompt).toContain('请审查这次改动');

    const marioEntry = db.prepare(`
      SELECT status, outcome FROM chain_worklist WHERE agent_id = 'mario'
    `).get() as any;
    expect(marioEntry.status).toBe('done');
    expect(marioEntry.outcome).toBe('success');
  });

  it('rebuilds active A2A state from the database after restart', async () => {
    messenger.registerExternalUserDispatch('conv-1', 'msg-1', ['mario'], '@mario 开始设计登录流程');

    const restartedIO = mockIO();
    const restartedMessenger = new AgentMessenger(db, restartedIO as any, AGENTS, {
      getTasks: () => testTasks,
    });

    expect(restartedMessenger.orchestrator.getAgentState('mario').status).toBe('executing');

    await restartedMessenger.onAgentResponse('mario', '登录流程设计完成，采用表单校验和错误提示。\n@luigi 请实现登录表单组件，包含校验、提交和错误展示', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = restartedIO.emitted().filter(([event, payload]) => event === 'a2a:dispatch' && payload.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(1);
  });

  it('links A2A handoffs to task graph ownership and dispatch payloads', async () => {
    db.prepare(`
      INSERT INTO task (id, conversation_id, title, description, status, agent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('task-1', 'conv-1', '登录任务', '', 'in_progress', 'mario', new Date().toISOString(), new Date().toISOString());

    messenger.registerExternalUserDispatch('conv-1', 'msg-1', ['mario'], '@mario 开始登录任务', 'task-1');

    await messenger.onAgentResponse('mario', '我已经完成登录任务的方案设计，需要继续实现。\n@luigi 请接手实现登录表单、校验和错误处理', {
      conversationId: 'conv-1',
      taskId: 'task-1',
      chainDepth: 0,
    });

    const luigiDispatch = io.emitted().find(([event, payload]) => event === 'a2a:dispatch' && payload.agentId === 'luigi');
    expect(luigiDispatch?.[1].referencedTaskId).toBe('task-1');

    messenger.orchestrator.markDispatchStarted(
      luigiDispatch![1].chainId,
      luigiDispatch![1].entryId,
      'conv-1',
      'luigi',
      luigiDispatch![1].passId,
    );

    const task = db.prepare('SELECT agent_id FROM task WHERE id = ?').get('task-1') as any;
    expect(task.agent_id).toBe('luigi');

    const actions = db.prepare(`
      SELECT type, actor_id, task_ids, pass_id FROM task_action WHERE conversation_id = ? ORDER BY created_at ASC, id ASC
    `).all('conv-1') as any[];
    expect(actions.some((action) => action.type === 'task.handoff_requested' && action.actor_id === 'mario')).toBe(true);
    expect(actions.some((action) => action.type === 'task.handoff_accepted' && action.actor_id === 'luigi')).toBe(true);
    expect(actions.every((action) => JSON.parse(action.task_ids).includes('task-1'))).toBe(true);
  });

  it('can abort an active user chain when a new non-mention user message arrives', () => {
    messenger.beginUserChain('conv-1', 'msg-1');

    const active = messenger.orchestrator.getActiveChain('conv-1');
    expect(active).not.toBeNull();

    const aborted = messenger.abortConversationChains('conv-1', 'new_user_message_without_a2a_target');

    expect(aborted).toBe(1);
    const row = db.prepare('SELECT status FROM invocation_chain WHERE id = ?').get(active!.id) as any;
    expect(row.status).toBe('aborted');
    const logs = db.prepare(`
      SELECT * FROM a2a_audit_log
      WHERE event_type = 'chain_aborted' AND reason = 'new_user_message_without_a2a_target'
    `).all() as any[];
    expect(logs).toHaveLength(1);
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

  it('surfaces unresolved mentions that are outside the current runtime roster', async () => {
    const pack = createPersistedTeamPack(true);
    db.prepare('UPDATE conversation SET team_pack_id = ? WHERE id = ?').run(pack.id, 'conv-1');
    messenger = new AgentMessenger(db, io as any, AGENTS, createRuntimeSnapshotProvider());
    messenger.orchestrator.reset();

    messenger.onUserMessage('conv-1', 'msg-1', 'planner', '请规划功能');

    await messenger.onAgentResponse('planner', '方案已经确认，核心拆解、依赖顺序和执行风险都已经整理，需要默认团队里的架构角色协助。\n@dk 请审查计划中的架构边界和风险项', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const dkDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'dk');
    expect(dkDispatches).toHaveLength(0);

    const systemEvents = io.emitted().filter(([e, p]) => e === 'agent:event' && p.type === 'system');
    expect(systemEvents.some(([, p]) => p.content.includes('当前团队没有可接收 @dk 的角色'))).toBe(true);

    const blockedLogs = db.prepare(`
      SELECT * FROM a2a_audit_log
      WHERE event_type = 'dispatch_blocked' AND json_extract(metadata, '$.blockedBy') = 'unknown_mention_target'
    `).all() as any[];
    expect(blockedLogs).toHaveLength(1);
    expect(blockedLogs[0].reason).toBe('当前团队没有可接收 @dk 的角色');
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

  it('emits phase-specific offer timeout messages', async () => {
    vi.useFakeTimers();
    try {
      const chain = messenger.orchestrator.createChain({
        conversationId: 'conv-1',
        type: 'user_message',
        messageId: 'msg-offer-timeout',
        config: {
          maxDurationMs: 1_000,
          offerTimeoutMs: 5,
          holderIdleTimeoutMs: 1_000,
        },
      });

      const decision = messenger.orchestrator.requestDispatch({
        chainId: chain.id,
        fromAgentId: 'user',
        toAgentId: 'luigi',
        content: '请实现 offer timeout 回归验证',
        depth: 0,
      });
      expect(decision.allow).toBe(true);

      await vi.advanceTimersByTimeAsync(6);

      const systemEvents = io.emitted().filter(([event, payload]) => event === 'agent:event' && payload.type === 'system');
      expect(systemEvents.some(([, payload]) => payload.content.includes('offer 阶段超时'))).toBe(true);

      const pass = db.prepare('SELECT status, phase, reason FROM a2a_pass WHERE chain_id = ?').get(chain.id) as any;
      expect(pass).toMatchObject({
        status: 'timeout',
        phase: 'offer',
        reason: 'A2A 转交未被执行端确认',
      });
    } finally {
      vi.useRealTimers();
    }
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

  it('coordinator re-entry: Peach can pass back to Mario in the same chain', async () => {
    vi.useFakeTimers();
    try {
      // Insert mario into the agents table so resolveTaskNotificationAudience finds it
      // isCoordinator checks agentId === 'mario' among other conditions
      db.prepare(`
        INSERT INTO agents (id, name, role_card_id, theme, emoji, is_preset, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('mario', 'Mario', '', 'default', '🔴', 1, new Date().toISOString(), new Date().toISOString());

      // Mario starts a chain via user message
      messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始设计方案');

      // Advance past the rate limit window (5s) before Mario responds
      await vi.advanceTimersByTimeAsync(6_000);

      // Mario completes and hands off to Peach with a review request
      await messenger.onAgentResponse('mario', '设计方案已完成，涵盖认证、错误处理和状态管理。\n@peach 请审查设计方案的测试覆盖、风险项和验收标准', {
        conversationId: 'conv-1',
        chainDepth: 0,
      });

      // Verify Peach was dispatched
      const peachDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'peach');
      expect(peachDispatches).toHaveLength(1);

      // Mark Peach's entry as executing (simulating dispatch acceptance)
      const chain = messenger.orchestrator.getActiveChain('conv-1');
      const peachWorklist = db.prepare('SELECT * FROM chain_worklist WHERE chain_id = ? AND agent_id = ?').all(chain!.id, 'peach') as any[];
      const peachEntry = peachWorklist[0];
      expect(peachEntry).toBeDefined();
      messenger.orchestrator.markDispatchStarted(chain!.id, peachEntry.id, 'conv-1', 'peach', peachDispatches[0][1].passId);

      // Advance past the rate limit window again so mario's re-entry is not rate-limited
      await vi.advanceTimersByTimeAsync(6_000);

      // Peach completes review and passes back to Mario with actionable intent
      await messenger.onAgentResponse('peach', '设计评审已通过，建议已在 TASKS.md 中更新，请确认最终结论并推进下一步实现。\n@mario 请确认评审结论，安排后续实现任务', {
        conversationId: 'conv-1',
        chainDepth: 1,
      });

      // Mario should be dispatched despite already being in the chain (coordinator exemption)
      // The first mario dispatch is from user (onUserMessage); the second one is from peach
      const marioDispatches = io.emitted().filter(([e, p]) => e === 'a2a:dispatch' && p.agentId === 'mario');
      expect(marioDispatches).toHaveLength(2);
      expect(marioDispatches[0][1].fromAgentId).toBe('user');   // initial user dispatch
      expect(marioDispatches[1][1].fromAgentId).toBe('peach');   // coordinator re-entry
      expect(marioDispatches[1][1].prompt).toContain('请确认评审结论');

      // Verify audit log shows dispatch_allowed (not dispatch_blocked) for mario
      const blockedLogs = db.prepare(`
        SELECT * FROM a2a_audit_log
        WHERE event_type = 'dispatch_blocked' AND to_agent_id = 'mario'
      `).all() as any[];
      expect(blockedLogs).toHaveLength(0);

      const allowedLogs = db.prepare(`
        SELECT * FROM a2a_audit_log
        WHERE event_type = 'dispatch_allowed' AND to_agent_id = 'mario'
      `).all() as any[];
      expect(allowedLogs.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
