// src/__tests__/server/a2a/integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import { AgentMessenger } from '@/server/a2a';
import type { AgentMentionConfig } from '@/server/a2a/types-v2';
import type { KanbanSnapshotProvider } from '@/server/a2a';

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

let db: Database.Database;
let io: ReturnType<typeof mockIO>;
let messenger: AgentMessenger;
let testTasks: { id: string; title: string; status: string; agent_id: string }[];

beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);
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
