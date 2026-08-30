// src/server/agent/acp/acpBackend.test.ts
//
// Integration test for AcpBackend. Spawns the mock ACP agent as a subprocess
// (via `npx tsx mockAcpAgent.ts`), drives one prompt turn over stdio JSON-RPC,
// and asserts the mapped event sequence + final AgentResult.
//
// Exercises the full path: cross-spawn → ndJsonStream → client().connectWith →
// buildSession → session.prompt → session/update* (mapped by the turn-scoped mapper) →
// session/request_permission (explicit allow-once policy) → PromptResponse(end_turn).
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AcpBackend } from './acpBackend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const mockPath = join(__dirname, '../../../test-helpers/acp/mockAcpAgent.ts');

describe('AcpBackend (subprocess integration with mockAcpAgent)', () => {
  it('joins the backend system prompt and user prompt at the ACP prompt boundary', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'codex',
      cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'prompt_echo' },
    });
    const run = backend.execute('user request', { systemPrompt: 'system context' });
    await expect(run.started).resolves.toMatchObject({ ok: true, sessionId: 'mock-1' });
    for await (const event of run.events) { void event; }
    const result = await run.result;

    expect(result.status).toBe('completed');
    expect(result.output).toBe('system context\n\nuser request');
  // This is the suite's cold npx/tsx subprocess start. Full parallel runs can
  // legitimately spend more than 15s waiting on Windows process and module IO.
  }, 30_000);

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

  it.each([
    ['new', undefined],
    ['load', 'stable-session'],
  ])('passes Claude native-subagent metadata into session/%s', async (_mode, resumeSessionId) => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'claude',
      cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'session_meta_echo' },
      forwardNativeSubagentText: true,
    });
    const run = backend.execute('echo session metadata', { resumeSessionId });
    for await (const event of run.events) { void event; }
    const result = await run.result;

    expect(result.status).toBe('completed');
    expect(JSON.parse(result.output)).toEqual({
      claudeCode: { options: { forwardSubagentText: true } },
    });
  }, 15_000);

  it('allows a correlated platform MCP call without widening the deny policy', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'platform_mcp_permission' },
      permissionPolicy: 'deny',
      autoApproveMcpToolNames: [
        'mcp.agent-task-team.task_create',
        'mcp__agent-task-team__task_create',
      ],
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
    // "完成" → end_turn. The turn-scoped mapper converts to text/tool_use/tool_result/
    // text; AcpBackend appends one terminal done at its boundary.
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

  it('reports the effective permission request and decision', async () => {
    const requested: string[] = [];
    const resolved: string[] = [];
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
      onPermissionRequested: (permission) => {
        requested.push(permission.toolCall.toolCallId);
      },
      onPermissionResolved: (permission, response) => {
        resolved.push(`${permission.toolCall.toolCallId}:${
          response.outcome.outcome === 'selected' ? response.outcome.optionId : 'cancelled'
        }`);
      },
    });

    const run = backend.execute('hi', {});
    for await (const event of run.events) void event;
    expect(await run.result).toMatchObject({ status: 'completed' });
    expect(requested).toEqual(['t1']);
    expect(resolved).toEqual(['t1:allow']);
  }, 30000);

  it('fails permission closed when audit publication fails', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
      onPermissionRequested: () => {
        throw new Error('audit unavailable');
      },
    });

    const run = backend.execute('hi', {});
    const toolStatuses: string[] = [];
    for await (const event of run.events) {
      if (event.type === 'tool_result' && event.tool?.status) {
        toolStatuses.push(event.tool.status);
      }
    }
    expect(await run.result).toMatchObject({
      status: 'failed',
      reasonCode: 'acp_permission_audit_failed',
    });
    expect(toolStatuses).toEqual(['failed']);
  }, 30000);

  it('does not return a late allow when termination starts during policy evaluation', async () => {
    const resolvedOptions: string[] = [];
    const ordering: string[] = [];
    let killRun = () => {};
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: () => new Promise((resolveDecision) => {
        setTimeout(() => resolveDecision('allow_once'), 50);
      }),
      onPermissionRequested: () => killRun(),
      onPermissionResolved: (_permission, response) => {
        ordering.push('permission-resolved');
        resolvedOptions.push(
          response.outcome.outcome === 'selected' ? response.outcome.optionId : 'cancelled',
        );
      },
    });

    const run = backend.execute('hi', {});
    killRun = run.kill;
    for await (const event of run.events) void event;
    expect(await run.result).toMatchObject({ status: 'cancelled' });
    ordering.push('invocation-terminal');
    expect(resolvedOptions).not.toContain('allow');
    expect(ordering).toEqual(['permission-resolved', 'invocation-terminal']);
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

    // Drain the event stream to completion. AcpBackend must still emit one
    // terminal `done` after kill from the resolved result.
    const types: string[] = [];
    for await (const event of run.events) {
      types.push(event.type);
    }
    expect(types.filter((type) => type === 'done')).toHaveLength(1);

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
    const text: string[] = [];
    const errors: string[] = [];
    for await (const event of run.events) {
      if (event.type === 'text') text.push(event.content);
      if (event.type === 'error') errors.push(event.content);
    }

    expect(await run.result).toMatchObject({
      status: 'failed',
      reasonCode: 'acp_tool_completion_missing',
    });
    expect(text).toEqual([]);
    expect(errors.join('')).toContain('检查所选账号和模型');
  }, 30000);

  it('treats an accepted terminal command receipt as the turn result without requiring prose', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
      autoApproveMcpToolNames: ['task_submit_result'],
      terminalMcpToolNames: ['task_submit_result'],
      env: { MOCK_ACP_SCENARIO: 'terminal_command_only' },
    });

    const run = backend.execute('submit the structured result and end', {});
    const types: string[] = [];
    for await (const event of run.events) types.push(event.type);

    expect(await run.result).toMatchObject({ status: 'completed', output: '' });
    expect(types).toEqual(['tool_use', 'tool_result', 'done']);
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

  it('reports a missing resumed session through the backend result and visible event', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['tsx', mockPath],
      engine: 'opencode',
      cwd: process.cwd(),
      env: { MOCK_ACP_LOAD_MISSING: 'true' },
    });

    const run = backend.execute('continue', { resumeSessionId: 'missing-session' });
    const events = [];
    for await (const event of run.events) events.push(event);

    expect(await run.result).toMatchObject({
      status: 'failed',
      sessionId: 'missing-session',
      reasonCode: 'acp_session_not_found',
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      content: '之前的 Agent 会话已失效，系统已重置会话。请重新发送本条消息。',
    }));
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
