// Targeted test: verify the orchestrator handles the race between
// harness completion (markDispatchStarted → executing) and the ACP done
// event (onAgentDone → idle) when handleTerminalStart is fire-and-forget.

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import { setTestDb } from '@/server/db';
import { AgentMessenger } from '@/server/a2a';
import type { AgentMentionConfig } from '@/server/a2a/types-v2';

function mockIO() {
  const emitted: any[] = [];
  return {
    emit: (...args: any[]) => emitted.push(args),
    to: () => ({ emit: (...args: any[]) => emitted.push(args) }),
    emitted: () => emitted,
  } as any;
}

const AGENTS: AgentMentionConfig[] = [
  { id: 'mario', mentionPatterns: ['@mario'] },
  { id: 'luigi', mentionPatterns: ['@luigi'] },
];

describe('A2A handoff race: harness completion vs ACP done event', () => {
  let db: Database.Database;
  let io: ReturnType<typeof mockIO>;
  let messenger: AgentMessenger;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    setTestDb(db);
    db.prepare(`INSERT INTO conversation (id, created_at, updated_at) VALUES (?, ?, ?)`)
      .run('conv-race', new Date().toISOString(), new Date().toISOString());
    io = mockIO();
    messenger = new AgentMessenger(db, io as any, AGENTS, { getTasks: () => [] } as any);
    messenger.orchestrator.reset();
  });

  it('agent B reaches idle after completion + done, not stuck in executing', async () => {
    const convId = 'conv-race';

    // Simulate harness completion that resolves near-instantly (as
    // handleTerminalStart does in the real daemon — fire-and-forget).
    const completionPromise = Promise.resolve({ status: 'accepted' as const });

    const submitDispatch = () => ({
      handled: true,
      completion: completionPromise,
    });

    // Create messenger WITH submitDispatch (5th constructor arg)
    messenger = new AgentMessenger(
      db, io as any, AGENTS,
      { getTasks: () => [] } as any,
      submitDispatch as any,
    );
    messenger.orchestrator.reset();

    // Both agents start idle
    messenger.orchestrator.setAgentState('mario', 'idle', undefined as any);
    messenger.orchestrator.setAgentState('luigi', 'idle', undefined as any);

    // A (mario) finishes and mentions @luigi → triggers dispatch to luigi
    const submitCalls: any[] = [];
    const submitDispatchTracked = (input: any) => {
      submitCalls.push(input);
      return { handled: true, completion: completionPromise };
    };
    // Re-create with tracked submitDispatch
    messenger = new AgentMessenger(
      db, io as any, AGENTS,
      { getTasks: () => [] } as any,
      submitDispatchTracked as any,
    );
    messenger.orchestrator.reset();
    messenger.orchestrator.setAgentState('mario', 'idle', undefined as any);
    messenger.orchestrator.setAgentState('luigi', 'idle', undefined as any);

    await messenger.onAgentResponse('mario', '架构设计已完成，使用 JWT 认证方案。\n@luigi 请实现前端登录组件，包含表单验证和错误处理', {
      conversationId: convId,
      taskId: '',
      triggerMessageId: undefined,
      chainDepth: 0,
      epochId: undefined,
    });

    console.log('[race] submitDispatch calls:', submitCalls.length, submitCalls.map(s => s.agentId));
    console.log('[race] io emits:', io.emitted().map((e: any[]) => e[0]).filter((e: string) => e.startsWith('a2a')));

    // Let the completion promise microtasks settle
    await new Promise((r) => setTimeout(r, 100));

    const luigiAfterCompletion = messenger.orchestrator.getAgentState('luigi');
    console.log('[race] luigi after completion:', luigiAfterCompletion?.status);

    // Simulate ACP done event for luigi (completeAgentA2A → onAgentDone)
    messenger.orchestrator.onAgentDone('luigi', convId);
    await new Promise((r) => setTimeout(r, 50));

    const luigiFinal = messenger.orchestrator.getAgentState('luigi');
    console.log('[race] luigi final:', luigiFinal?.status);

    // Luigi should be idle — not stuck in executing
    expect(luigiFinal?.status).toBe('idle');
  });

  it('agent B is NOT stuck when done arrives BEFORE completion .then (true fire-and-forget race)', async () => {
    const convId = 'conv-race';

    // Completion resolves SLOWLY — simulating handleTerminalStart that returns
    // accepted only after a delay, while the ACP done event fires first.
    let resolveCompletion!: (v: any) => void;
    const slowCompletion = new Promise<any>((r) => { resolveCompletion = r; });

    const submitDispatch = () => ({
      handled: true,
      completion: slowCompletion,
    });

    messenger = new AgentMessenger(
      db, io as any, AGENTS,
      { getTasks: () => [] } as any,
      submitDispatch as any,
    );
    messenger.orchestrator.reset();
    messenger.orchestrator.setAgentState('mario', 'idle', undefined as any);
    messenger.orchestrator.setAgentState('luigi', 'idle', undefined as any);

    await messenger.onAgentResponse('mario', '架构设计已完成。\n@luigi 请实现前端登录组件，包含表单验证和错误处理', {
      conversationId: convId,
      taskId: '',
      triggerMessageId: undefined,
      chainDepth: 0,
      epochId: undefined,
    });

    // At this point luigi is 'queued' (setAgentState at dispatchNext L713).
    // completion hasn't resolved yet. Now simulate ACP done arriving FIRST.
    // In real daemon: done event → completeAgentA2A → onAgentResponse (markDone)
    //   → onAgentDone (setAgentState idle).
    const luigiBeforeDone = messenger.orchestrator.getAgentState('luigi');
    console.log('[race2] luigi before done (should be queued):', luigiBeforeDone?.status);

    // Simulate completeAgentA2A: first onAgentResponse (marks entry done),
    // then onAgentDone (sets idle). This is the real daemon order.
    await messenger.onAgentResponse('luigi', 'Done implementing login form.', {
      conversationId: convId,
      taskId: '',
      triggerMessageId: undefined,
      chainDepth: 0,
      epochId: undefined,
    });
    messenger.orchestrator.onAgentDone('luigi', convId);
    await new Promise((r) => setTimeout(r, 20));

    const luigiAfterDone = messenger.orchestrator.getAgentState('luigi');
    console.log('[race2] luigi after done (before completion):', luigiAfterDone?.status);

    // NOW completion resolves — markDispatchStarted will set luigi to 'executing'
    resolveCompletion({ status: 'accepted' });
    await new Promise((r) => setTimeout(r, 50));

    const luigiFinal = messenger.orchestrator.getAgentState('luigi');
    console.log('[race2] luigi final (after completion):', luigiFinal?.status);

    // If the race bug exists, luigi is STUCK in 'executing' because
    // markDispatchStarted ran AFTER onAgentDone set it to idle.
    // This is the bug: agent never returns to idle → blocks all future handoffs.
    expect(luigiFinal?.status).toBe('idle');
  });
});
