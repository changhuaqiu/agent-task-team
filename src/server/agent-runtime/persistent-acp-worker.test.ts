import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, AgentRun } from '../agent/types';
import { buildAcpSubprocessEnv, PersistentAcpWorker } from './persistent-acp-worker';

const currentDir = dirname(fileURLToPath(import.meta.url));
const mockPath = join(currentDir, '../../test-helpers/acp/mockAcpAgent.ts');

async function finish(run: AgentRun) {
  const events: AgentEvent[] = [];
  const eventTypes: string[] = [];
  for await (const event of run.events) {
    events.push(event);
    eventTypes.push(event.type);
  }
  return { result: await run.result, events, eventTypes };
}

describe('PersistentAcpWorker', () => {
  it('passes only safe host variables plus explicit runtime environment', () => {
    expect(buildAcpSubprocessEnv(
      { RUNTIME_TOKEN: 'runtime-owned' },
      { PATH: 'C:\\bin', TEMP: 'C:\\temp', ATH_DESKTOP_BOOTSTRAP_SECRET: 'never-pass', SERVICE_API_KEY: 'never-pass' },
    )).toEqual({ NODE_ENV: 'production', PATH: 'C:\\bin', TEMP: 'C:\\temp', RUNTIME_TOKEN: 'runtime-owned' });
  });
  it('reuses one initialized ACP transport across sequential invocations', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-1', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(), env: { MOCK_ACP_SCENARIO: 'prompt_echo' }, engine: 'codex',
    });
    try {
      await worker.start();
      const first = await finish(worker.execute('first', {}, {}));
      expect(first.result).toMatchObject({ status: 'completed', sessionId: 'mock-1', output: 'first' });
      expect(first.eventTypes.at(-1)).toBe('done');
      expect(first.events).not.toHaveLength(0);
      expect(first.events.every((event) => event.sessionId === 'mock-1')).toBe(true);
      expect(worker.ready()).toBe(true);

      const second = await finish(worker.execute('second', {}, {}));
      expect(second.result).toMatchObject({ status: 'completed', sessionId: 'mock-2', output: 'second' });
      expect(second.eventTypes.at(-1)).toBe('done');
      expect(worker.ready()).toBe(true);
    } finally {
      await worker.shutdown();
    }
  }, 30_000);

  it('keeps invocation-scoped MCP grants out of the next session', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-1', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(), env: { MOCK_ACP_SCENARIO: 'mcp_echo' }, engine: 'opencode',
    });
    try {
      await worker.start();
      const first = await finish(worker.execute('first', {}, {
        mcpServers: [{ name: 'first-grant', type: 'http', url: 'http://127.0.0.1/first', headers: [] }],
      }));
      expect(JSON.parse(first.result.output)).toEqual([expect.objectContaining({ name: 'first-grant' })]);

      const second = await finish(worker.execute('second', {}, { mcpServers: [] }));
      expect(JSON.parse(second.result.output)).toEqual([]);
    } finally {
      await worker.shutdown();
    }
  }, 30_000);

  it('forces the requested session mode before the vendor receives the prompt', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-session-mode', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(), env: { MOCK_ACP_SCENARIO: 'session_mode_echo' }, engine: 'claude',
    });
    try {
      await worker.start();
      const planning = await finish(worker.execute('plan only', {}, { sessionMode: 'plan' }));
      expect(planning.result).toMatchObject({ status: 'completed', output: 'plan' });
      const execution = await finish(worker.execute('execute', {}, { sessionMode: 'default' }));
      expect(execution.result).toMatchObject({ status: 'completed', output: 'default' });
    } finally {
      await worker.shutdown();
    }
  }, 30_000);

  it('fails closed before prompting when the vendor rejects the session mode', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-session-mode-failure', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'session_mode_echo', MOCK_ACP_SET_MODE_FAIL: 'true' },
      engine: 'claude',
    });
    try {
      await worker.start();
      const run = worker.execute('must-not-reach-prompt', {}, { sessionMode: 'plan' });
      await expect(run.started).resolves.toMatchObject({
        ok: false,
        reasonCode: 'acp_session_mode_failed',
      });
      const turn = await finish(run);
      expect(turn.result).toMatchObject({
        status: 'failed',
        reasonCode: 'acp_session_mode_failed',
        output: '',
      });
    } finally {
      await worker.shutdown();
    }
  }, 30_000);

  it('keeps WorkContract work recoverable when ACP exits without an accepted lifecycle command', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-outcome-guard', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(), env: { MOCK_ACP_SCENARIO: 'prompt_echo' }, engine: 'codex',
    });
    try {
      await worker.start();
      const turn = await finish(worker.execute('claim complete in prose', {}, {
        requireAcceptedTerminalCommand: true,
      }));
      expect(turn.result).toMatchObject({
        status: 'failed',
        reasonCode: 'ended_without_outcome',
        output: 'claim complete in prose',
      });
      expect(worker.ready()).toBe(true);
    } finally {
      await worker.shutdown();
    }
  }, 30_000);

  it('reports an empty completion as a Runtime error without synthesizing answer text', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-empty-completion', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(), env: { MOCK_ACP_SCENARIO: 'tool_silent' }, engine: 'opencode',
    });
    try {
      await worker.start();
      const run = worker.execute('use a tool and answer', {}, {});
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
    } finally {
      await worker.shutdown();
    }
  }, 30_000);

  it('accepts a WorkContract turn after the structured terminal receipt is observed', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-terminal-receipt', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(), env: { MOCK_ACP_SCENARIO: 'terminal_command_only' }, engine: 'claude',
    });
    try {
      await worker.start();
      const turn = await finish(worker.execute('submit the result', {}, {
        permissionPolicy: 'allow_once',
        terminalMcpToolNames: ['task_submit_result'],
        requireAcceptedTerminalCommand: true,
      }));
      expect(turn.result).toMatchObject({ status: 'completed' });
      expect(worker.ready()).toBe(true);
    } finally {
      await worker.shutdown();
    }
  }, 30_000);

  it('accepts an OpenCode-namespaced lifecycle tool after its structured receipt is observed', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-namespaced-terminal-receipt', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(), env: { MOCK_ACP_SCENARIO: 'namespaced_terminal_command_only' }, engine: 'opencode',
    });
    try {
      await worker.start();
      const turn = await finish(worker.execute('submit the result', {}, {
        permissionPolicy: 'allow_once',
        terminalMcpToolNames: [
          'task_submit_result',
          'agent-task-team-7e82e6def26bf415_task_submit_result',
        ],
        requireAcceptedTerminalCommand: true,
      }));
      expect(turn.result).toMatchObject({ status: 'completed' });
      expect(worker.ready()).toBe(true);
    } finally {
      await worker.shutdown();
    }
  }, 30_000);

  it('rejects a receipt-shaped result from an unregistered MCP namespace', async () => {
    const worker = new PersistentAcpWorker({
      id: 'worker-untrusted-terminal-receipt', command: 'npx', args: ['tsx', mockPath],
      cwd: process.cwd(), env: { MOCK_ACP_SCENARIO: 'untrusted_namespaced_terminal_command_only' }, engine: 'opencode',
    });
    try {
      await worker.start();
      const turn = await finish(worker.execute('submit the result', {}, {
        permissionPolicy: 'allow_once',
        terminalMcpToolNames: [
          'task_submit_result',
          'agent-task-team-7e82e6def26bf415_task_submit_result',
        ],
        requireAcceptedTerminalCommand: true,
      }));
      expect(turn.result).toMatchObject({
        status: 'failed',
        reasonCode: 'ended_without_outcome',
      });
    } finally {
      await worker.shutdown();
    }
  }, 30_000);
});
