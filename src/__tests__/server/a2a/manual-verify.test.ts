/**
 * 手动验证 A2A 完整链路的测试
 * 模拟 daemon 端的完整流程: agent 输出 → 扫描 → 路由 → 信箱 → dispatch
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import { AgentMessenger } from '@/server/a2a';
import type { AgentMentionConfig } from '@/server/a2a/types';

function mockIO() {
  const emitted: any[] = [];
  return {
    emit: (...args: any[]) => emitted.push(args),
    emitted: () => emitted,
    lastEvent: () => emitted[emitted.length - 1],
  };
}

const AGENTS: AgentMentionConfig[] = [
  { id: 'mario', mentionPatterns: ['@mario', '@Mario', '@马里奥'] },
  { id: 'luigi', mentionPatterns: ['@luigi', '@Luigi', '@路易吉'] },
  { id: 'toad', mentionPatterns: ['@toad', '@Toad'] },
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
});

describe('A2A 完整链路验证', () => {
  it('场景1: Mario 完成规划后 @luigi 接手', async () => {
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

    // 验证 socket event
    const [event, payload] = io.lastEvent();
    expect(event).toBe('a2a:dispatch');
    expect(payload.agentId).toBe('luigi');
    expect(payload.fromAgentId).toBe('mario');
    expect(payload.prompt).toContain('跨角色协作消息');
    expect(payload.prompt).toContain('JWT');
    expect(payload.conversationId).toBe('conv-1');

    // 验证 mailbox 持久化
    const rows = db.prepare(
      "SELECT * FROM agent_mailbox WHERE to_agent_id = 'luigi'"
    ).all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].from_agent_id).toBe('mario');
    expect(rows[0].status).toBe('delivered');
    expect(rows[0].chain_depth).toBe(1);
  });

  it('场景2: 代码块外的 inline @mention 也触发', async () => {
    const response = '这个前端任务交给 @luigi 处理，完成后告诉我';

    await messenger.onAgentResponse('mario', response, {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const [, payload] = io.lastEvent();
    expect(payload.agentId).toBe('luigi');
    expect(payload.fromAgentId).toBe('mario');
  });

  it('场景3: 代码块中的 @mention 不触发', async () => {
    const response = `
看这段代码：
\`\`\`typescript
// @luigi 这不应该触发 A2A
const x = 1;
\`\`\`
以上是参考。
`.trim();

    await messenger.onAgentResponse('mario', response, {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    expect(io.emitted()).toHaveLength(0);
  });

  it('场景4: CJK 名字也能触发', async () => {
    const response = '设计完成了\n@路易吉 开始实现吧';

    await messenger.onAgentResponse('mario', response, {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    const [, payload] = io.lastEvent();
    expect(payload.agentId).toBe('luigi');
  });

  it('场景5: 多个 @mention 最多触发 2 个', async () => {
    const response = `
@luigi 做前端
@toad 写测试
@mario 自己 review
`.trim();

    await messenger.onAgentResponse('mario', response, {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    // mario 不能 self-mention，所以只有 luigi + toad
    const dispatches = io.emitted().filter(([e]) => e === 'a2a:dispatch');
    expect(dispatches.length).toBeLessThanOrEqual(2);
  });

  it('场景6: ping-pong 防护 — 连续互 @ 4 次被阻止', async () => {
    // 模拟 4 次短回复互 @（<200 chars，无 tool_use → non-substantive）
    for (let i = 0; i < 2; i++) {
      await messenger.onAgentResponse('mario', '@luigi ok', {
        conversationId: 'conv-1',
        chainDepth: i * 2,
      });
      await messenger.onAgentResponse('luigi', '@mario done', {
        conversationId: 'conv-1',
        chainDepth: i * 2 + 1,
      });
    }
    // ping-pong count = 4 (mario:luigi pair)

    // 第 5 次应该被阻止
    await messenger.onAgentResponse('mario', '@luigi 再做一下', {
      conversationId: 'conv-1',
      chainDepth: 4,
    });

    const blocked = io.emitted().filter(
      ([e, p]) => e === 'agent:event' && p.content?.includes('投递被阻止')
    );
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('场景7: 过期清理 — 30 分钟前的 pending 记录被清理', () => {
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO agent_mailbox (id, conversation_id, from_agent_id, to_agent_id,
        content, status, chain_depth, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('mb-old', 'conv-1', 'mario', 'luigi', 'old msg', 'pending', 1, 'a2a', old);

    const expired = messenger.expireStale();
    expect(expired).toBe(1);
  });
});
