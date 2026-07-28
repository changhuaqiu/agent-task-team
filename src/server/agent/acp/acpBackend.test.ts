// src/server/agent/acp/acpBackend.test.ts
//
// Integration test for AcpBackend. Spawns the mock ACP agent as a subprocess
// (via `npx tsx mockAcpAgent.ts`), drives one prompt turn over stdio JSON-RPC,
// and asserts the mapped event sequence + final AgentResult.
//
// Exercises the full path: spawnCli → ndJsonStream → client().connectWith →
// buildSession → session.prompt → session/update* (mapped via mapAcpUpdate) →
// session/request_permission (explicit allow-once policy) → PromptResponse(end_turn).
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AcpBackend, isAcpResourceNotFound } from './acpBackend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const mockPath = join(__dirname, 'mockAcpAgent.ts');

describe('isAcpResourceNotFound', () => {
  it('recognizes ACP code and message without widening other load failures', () => {
    expect(isAcpResourceNotFound({ code: -32002, message: 'missing' })).toBe(true);
    expect(isAcpResourceNotFound(new Error('Resource not found: session-1'))).toBe(true);
    expect(isAcpResourceNotFound(new Error('authentication failed'))).toBe(false);
  });
});

describe('AcpBackend (subprocess integration with mockAcpAgent)', () => {
  it('passes configured MCP servers into a new ACP session', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'mcp_echo' },
      permissionPolicy: 'allow_once',
      mcpServers: [{
        name: 'agent-task-team',
        type: 'http',
        url: 'http://127.0.0.1:3110/api/acp-tools',
        headers: [{ name: 'Authorization', value: 'Bearer test-token' }],
      }],
    });
    const run = backend.execute('echo MCP config', {});
    for await (const event of run.events) { void event; }
    const result = await run.result;

    expect(result.status).toBe('completed');
    expect(JSON.parse(result.output)).toEqual([expect.objectContaining({
      name: 'agent-task-team',
      type: 'http',
      url: 'http://127.0.0.1:3110/api/acp-tools',
    })]);
  }, 15_000);

  it('allows a correlated platform MCP call without widening the deny policy', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'platform_mcp_permission' },
      permissionPolicy: 'deny',
      autoApproveMcpToolNames: ['mcp.agent-task-team.task_create'],
    });
    const run = backend.execute('call scoped platform MCP', {});
    for await (const event of run.events) { void event; }
    const result = await run.result;

    expect(result.status).toBe('completed');
    expect(result.output).toContain('platform-allowed');
  }, 15_000);
  it('drives a full turn: text → tool_use → tool_result → text → done, result completed', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
    });

    const run = backend.execute('hi', {});

    const types: string[] = [];
    const toolNames: string[] = [];
    for await (const event of run.events) {
      types.push(event.type);
      if (event.tool?.name) toolNames.push(event.tool.name);
    }

    const result = await run.result;

    // Mock emits: agent_message_chunk "开始" → tool_call → (permission
    // explicitly allowed once) → tool_call_update completed → agent_message_chunk
    // "完成" → end_turn. mapAcpUpdate converts to text/tool_use/tool_result/
    // text; withDoneGuarantee appends done.
    expect(types).toEqual(['text', 'tool_use', 'tool_result', 'text', 'done']);
    expect(toolNames).toEqual(['改文件', '改文件']);

    // Auto-approve selects "allow" → mock returns end_turn → completed.
    expect(result.status).toBe('completed');
    expect(result.sessionId).toBe('mock-1');
    expect(result.output).toContain('开始');
    expect(result.output).toContain('完成');
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  }, 30000);

  it('kill() is callable and cancels the run', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
    });

    const run = backend.execute('hi', {});

    // kill() must not throw even if called immediately.
    expect(() => run.kill()).not.toThrow();

    // Drain the event stream to completion. The withDoneGuarantee wrapper
    // must still emit a `done` event after kill (generator terminates + the
    // close handler resolves the result).
    const types: string[] = [];
    for await (const event of run.events) {
      types.push(event.type);
    }
    expect(types).toContain('done');

    // Cause-based close handler: kill() → 'cancelled' (deterministic, not the
    // old loose set).
    const result = await run.result;
    expect(result.status).toBe('cancelled');
  }, 30000);

  it('loads an existing session and suppresses historical replay updates', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
    });

    const run = backend.execute('continue', { resumeSessionId: 'stable-session' });
    const contents: string[] = [];
    for await (const event of run.events) contents.push(event.content);
    const result = await run.result;

    expect(result).toMatchObject({ status: 'completed', sessionId: 'stable-session' });
    expect(contents.join('')).not.toContain('历史回放');
    expect(result.output).toContain('开始');
  }, 30000);

  it('recovers once when a tool turn ends without a final message', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
      env: { MOCK_ACP_SCENARIO: 'tool_only' },
    });

    const run = backend.execute('use a tool and answer', {});
    const contents: string[] = [];
    for await (const event of run.events) {
      if (event.type === 'text') contents.push(event.content);
    }

    expect(await run.result).toMatchObject({ status: 'completed' });
    expect(contents.join('')).toBe('恢复后的最终答复');
  }, 30000);

  it('recovers once when a turn ends without text or tool events', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
      env: { MOCK_ACP_SCENARIO: 'empty_once' },
    });

    const run = backend.execute('answer after an empty turn', {});
    const contents: string[] = [];
    for await (const event of run.events) {
      if (event.type === 'text') contents.push(event.content);
    }

    expect(await run.result).toMatchObject({ status: 'completed' });
    expect(contents.join('')).toBe('recovered empty turn');
  }, 30000);

  it('fails visibly when the bounded recovery is still empty', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
      env: { MOCK_ACP_SCENARIO: 'tool_silent' },
    });

    const run = backend.execute('use a tool and answer', {});
    const contents: string[] = [];
    for await (const event of run.events) {
      if (event.type === 'text') contents.push(event.content);
    }

    expect(await run.result).toMatchObject({
      status: 'failed',
      reasonCode: 'acp_empty_completion',
    });
    expect(contents.join('')).toContain('未返回最终文本');
  }, 30000);

  it('fails closed when resume is unsupported instead of creating a new session', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      env: { MOCK_ACP_LOAD_SESSION: 'false' },
    });

    const run = backend.execute('continue', { resumeSessionId: 'stable-session' });
    for await (const event of run.events) {
      void event;
    }
    expect(await run.result).toMatchObject({
      status: 'failed',
      sessionId: 'stable-session',
      reasonCode: 'acp_resume_unsupported',
    });
  }, 30000);

  it('does not replace a stable session when session/load fails', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      env: { MOCK_ACP_LOAD_FAIL: 'true' },
    });

    const run = backend.execute('continue', { resumeSessionId: 'stable-session' });
    for await (const event of run.events) {
      void event;
    }
    expect(await run.result).toMatchObject({
      status: 'failed',
      sessionId: 'stable-session',
      reasonCode: 'acp_session_load_failed',
    });
  }, 30000);

  it('rejects a session update whose identity differs from the active binding', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'wrong_session' },
    });

    const run = backend.execute('continue', { resumeSessionId: 'stable-session' });
    for await (const event of run.events) {
      void event;
    }
    expect(await run.result).toMatchObject({
      status: 'failed',
      sessionId: 'stable-session',
      reasonCode: 'acp_session_identity_changed',
    });
  }, 30000);
});
