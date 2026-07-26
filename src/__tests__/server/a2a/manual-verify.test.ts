/**
 * A2A v2 完整链路验证
 * 模拟完整流程: 用户消息 → chain 创建 → agent 输出 → @mention 扫描 → orchestrator 决策 → dispatch
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import { AgentMessenger } from '@/server/a2a';
import type { AgentMentionConfig } from '@/server/a2a/types-v2';

function mockIO() {
  const emitted: any[] = [];
  return {
    emit: (...args: any[]) => emitted.push(args),
    to: () => ({
      emit: (...args: any[]) => emitted.push(args),
    }),
    emitted: () => emitted,
    lastEvent: () => emitted[emitted.length - 1],
    dispatchEvents: () => emitted.filter(([e]) => e === 'a2a:dispatch'),
    blockedEvents: () => emitted.filter(([e]) => e === 'a2a:pass-blocked'),
    systemEvents: () => emitted.filter(([e]) => e === 'a2a:notice'),
  };
}

const AGENTS: AgentMentionConfig[] = [
  { id: 'mario', mentionPatterns: ['@mario', '@Mario', '@马里奥'] },
  { id: 'luigi', mentionPatterns: ['@luigi', '@Luigi', '@路易吉'] },
  { id: 'toad', mentionPatterns: ['@toad', '@Toad'] },
  { id: 'peach', mentionPatterns: ['@peach', '@Peach'] },
];

let db: Database.Database;
let io: ReturnType<typeof mockIO>;
let messenger: AgentMessenger;

beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);
  db.prepare(`INSERT INTO conversation (id, created_at, updated_at) VALUES (?, ?, ?)`)
    .run('conv-1', new Date().toISOString(), new Date().toISOString());
  io = mockIO();
  messenger = new AgentMessenger(db, io as any, AGENTS);
  messenger.orchestrator.reset();
});

describe('A2A v2 完整链路验证', () => {
  it('场景1: 用户消息 → chain 创建 → agent dispatch', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始设计');

    const dispatches = io.dispatchEvents();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0][1].agentId).toBe('mario');
    expect(dispatches[0][1].chainId).toBeDefined();

    // Chain persisted in DB
    const chains = db.prepare("SELECT * FROM invocation_chain WHERE conversation_id = 'conv-1'").all();
    expect(chains).toHaveLength(1);
  });

  it('场景2: Mario @luigi → worklist entry + dispatch', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    const marioResponse = `
架构设计已完成，以下是关键决策：

1. 使用 JWT + session 双模式认证
2. 前端使用 React Query 管理状态
3. API 遵循 RESTful 规范

@luigi 请根据以上架构设计开始实现前端组件
`.trim();

    await messenger.onAgentResponse('mario', marioResponse, {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.dispatchEvents().filter(([, p]) => p.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(1);
    expect(luigiDispatches[0][1].prompt).toContain('请根据以上架构设计开始实现前端组件');

    // Worklist entry in DB
    const worklist = db.prepare("SELECT * FROM chain_worklist WHERE agent_id = 'luigi'").all() as any[];
    expect(worklist).toHaveLength(1);
  });

  it('场景3: 代码块中的 @mention 不触发', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    const response = `
看这段代码：
\`\`\`typescript
// @luigi 这不应该触发 A2A
const x = 1;
\`\`\`
以上是参考代码示例。
`.trim();

    await messenger.onAgentResponse('mario', response, {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.dispatchEvents().filter(([, p]) => p.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(0);
  });

  it('场景4: CJK 名字也能触发', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    await messenger.onAgentResponse('mario', '设计完成了\n@路易吉 开始实现吧，这是一个需要多个组件协作完成的前端任务', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.dispatchEvents().filter(([, p]) => p.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(1);
  });

  it('场景5: 短回复 ("收到，待命") 不触发 @mention 扫描', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    // Short ack-like response — should NOT scan for @mentions
    await messenger.onAgentResponse('mario', '收到。@luigi 待命中。', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const luigiDispatches = io.dispatchEvents().filter(([, p]) => p.agentId === 'luigi');
    expect(luigiDispatches).toHaveLength(0);
  });

  it('场景6: 新用户消息自动终止旧 chain', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '第一个任务');
    const chain1 = messenger.orchestrator.getActiveChain('conv-1')!;

    messenger.onUserMessage('conv-1', 'msg-2', 'luigi', '新任务');
    const chain2 = messenger.orchestrator.getActiveChain('conv-1')!;

    expect(chain2.id).not.toBe(chain1.id);

    const oldChain = db.prepare('SELECT status FROM invocation_chain WHERE id = ?').get(chain1.id) as any;
    expect(oldChain.status).toBe('aborted');
  });

  it('场景7: direct ping-pong 零容忍 — B 回复 A 时再 @A → 立即拦截', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    // Mario @mentions Luigi
    await messenger.onAgentResponse('mario', '@luigi 请实现前端登录组件，需要包含完整的表单验证和错误处理逻辑代码', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    // Mark Luigi's entry as executing
    const chain = messenger.orchestrator.getActiveChain('conv-1');
    if (chain) {
      db.prepare("UPDATE chain_worklist SET status = 'executing' WHERE chain_id = ? AND agent_id = 'luigi'")
        .run(chain.id);
    }

    // Luigi tries to @mention Mario back — should be blocked immediately
    await messenger.onAgentResponse('luigi', '@mario 我有个关于登录组件的设计规范和交互细节需要和你确认一下才能开始实现', {
      conversationId: 'conv-1',
      chainDepth: 1,
    });

    const blockedLogs = db.prepare("SELECT * FROM a2a_audit_log WHERE event_type = 'dispatch_blocked'").all() as any[];
    expect(blockedLogs.length).toBeGreaterThan(0);
  });

  it('场景8: chain budget — 超过 8 次 dispatch 后拦截', async () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');
    const chain = messenger.orchestrator.getActiveChain('conv-1')!;

    // Fill up the worklist to near budget (insert directly to DB)
    for (let i = 0; i < 8; i++) {
      db.prepare(`
        INSERT INTO chain_worklist (id, chain_id, agent_id, requested_by, prompt, content_hash, depth, status, queued_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'done', ?)
      `).run(`wl-fill-${i}`, chain.id, `agent-${i}`, 'mario', 'filler', `hash-${i}`, new Date().toISOString());
    }

    // Now try to dispatch another — should be blocked by chain budget
    await messenger.onAgentResponse('mario', '@luigi 请再做一个非常重要的前端组件，包含完整的交互设计和动画效果', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const blockedLogs = db.prepare("SELECT * FROM a2a_audit_log WHERE event_type = 'dispatch_blocked'").all() as any[];
    expect(blockedLogs.length).toBeGreaterThan(0);
  });

  it('场景9: dispatch prompt 包含 response guidance', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '请修复 bug');

    const dispatches = io.dispatchEvents();
    const prompt = dispatches[0][1].prompt;
    expect(prompt).toContain('真实 dispatch receipt');
    expect(prompt).toContain('不要确认收到');
  });

  it('场景10: audit log 记录链生命周期', () => {
    messenger.onUserMessage('conv-1', 'msg-1', 'mario', '开始');

    const logs = db.prepare("SELECT * FROM a2a_audit_log WHERE conversation_id = 'conv-1'").all() as any[];
    expect(logs.some((l: any) => l.event_type === 'chain_created')).toBe(true);
  });

  it('场景11: stale chain cleanup', () => {
    // Insert an old chain directly
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    db.prepare(`
      INSERT INTO invocation_chain (id, conversation_id, root_trigger_type, root_trigger_id, status, config, created_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run('chain-old', 'conv-1', 'user_message', 'msg-old', '{"maxDepth":5,"maxBreadth":4,"maxDurationMs":120000}', oldTime);

    const expired = messenger.expireStale();
    expect(expired).toBe(1);

    const row = db.prepare("SELECT status FROM invocation_chain WHERE id = 'chain-old'").get() as any;
    expect(row.status).toBe('timeout');
  });
});
