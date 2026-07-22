import { describe, it, expect } from 'vitest';
import {
  createTurnScopedAcpEventMapper,
  inferAcpToolResultStatus,
  mapAcpUpdate,
  KNOWN_SESSION_UPDATE_TYPES,
} from './agentEventMapper';
import type { AgentEvent } from '../types';

// Test inputs use `as any` because we are constructing raw ACP SessionUpdate
// payloads inline. This file is excluded from tsc (tsconfig exclude **/*.test.ts).

describe('mapAcpUpdate', () => {
  describe('agent_message_chunk', () => {
    it('text content -> text event', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hi' },
      } as any);
      expect(r).toMatchObject({ type: 'text', content: 'hi' });
    });

    it('non-text content -> null', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'x', mimeType: 'image/png' },
      } as any);
      expect(r).toBeNull();
    });
  });

  describe('agent_thought_chunk', () => {
    it('text content -> thinking event', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'hmm' },
      } as any);
      expect(r).toMatchObject({ type: 'thinking', content: 'hmm' });
    });

    it('non-text content -> null', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'resource', resource: {} },
      } as any);
      expect(r).toBeNull();
    });
  });

  describe('user_message_chunk', () => {
    it('text content -> null (user echo, not agent output)', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'user said' },
      } as any);
      expect(r).toBeNull();
    });
  });

  describe('tool_call -> tool_use', () => {
    it('uses title as tool name, carries callId', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'c1',
        title: 'edit file',
        kind: 'edit',
      } as any);
      expect(r).toMatchObject({
        type: 'tool_use',
        content: '',
        tool: { callId: 'c1', name: 'edit file' },
      });
    });

    it('falls back to kind when title missing', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'c2',
        kind: 'bash',
      } as any);
      expect(r).toMatchObject({ type: 'tool_use', tool: { name: 'bash', callId: 'c2' } });
    });

    it('falls back to "tool" when both title and kind missing', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'c3',
      } as any);
      expect(r).toMatchObject({ type: 'tool_use', tool: { name: 'tool', callId: 'c3' } });
    });

    it('stringifies rawInput when present', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'c4',
        title: 'run',
        rawInput: { cmd: 'ls' },
      } as any);
      expect(r).toMatchObject({ type: 'tool_use' });
      expect((r as AgentEvent).tool?.input).toBe(JSON.stringify({ cmd: 'ls' }));
    });

    it('omits input when rawInput absent', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'c5',
        title: 'run',
      } as any);
      expect((r as AgentEvent).tool?.input).toBeUndefined();
    });

    it('safeStringify handles non-JSON-serializable rawInput (circular)', () => {
      const circular: any = { a: 1 };
      circular.self = circular;
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'c6',
        title: 'run',
        rawInput: circular,
      } as any);
      expect(r).toMatchObject({ type: 'tool_use' });
      // Should not throw; falls back to String(v)
      expect(typeof (r as AgentEvent).tool?.input).toBe('string');
    });
  });

  describe('tool_call_update -> tool_result', () => {
    it('carries callId and stringifies rawOutput', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        status: 'completed',
        rawOutput: { ok: true },
      } as any);
      expect(r).toMatchObject({ type: 'tool_result', tool: { callId: 'c1' } });
      expect((r as AgentEvent).content).toBe(JSON.stringify({ ok: true }));
      expect((r as AgentEvent).tool?.output).toBe(JSON.stringify({ ok: true }));
      expect((r as AgentEvent).tool?.status).toBe('completed');
    });

    it('preserves refined rawInput and a failed terminal status', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c-failed',
        status: 'failed',
        rawInput: { file_path: 'plan.md', content: '# Plan' },
        rawOutput: 'permission denied',
      } as any);

      expect(r).toMatchObject({
        type: 'tool_result',
        content: JSON.stringify('permission denied'),
        tool: {
          callId: 'c-failed',
          input: JSON.stringify({ file_path: 'plan.md', content: '# Plan' }),
          output: JSON.stringify('permission denied'),
          status: 'failed',
        },
      });
    });

    it('fails a completed shell RPC when the process timed out in watch mode', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'watch-timeout',
        status: 'completed',
        rawOutput: {
          output: '79 passed\nPASS Waiting for file changes...\n<shell_metadata>\nshell tool terminated command after exceeding timeout 120000 ms.\n</shell_metadata>',
          metadata: { exit: null, description: 'Run unit tests' },
        },
      } as any) as AgentEvent;

      expect(r.tool?.status).toBe('failed');
    });

    it('fails non-zero structured shell exits and preserves exit zero', () => {
      expect(inferAcpToolResultStatus({ metadata: { exit: 1 } }, 'completed')).toBe('failed');
      expect(inferAcpToolResultStatus({ metadata: { exit: 0 } }, 'completed')).toBe('completed');
    });

    it('content empty when rawOutput absent', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c2',
        status: 'failed',
      } as any);
      expect(r).toMatchObject({ type: 'tool_result', content: '', tool: { callId: 'c2' } });
    });

    it('uses title when present', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c3',
        title: 'edit file',
      } as any);
      expect(r).toMatchObject({ type: 'tool_result', tool: { name: 'edit file', callId: 'c3' } });
    });

    it('content empty when rawOutput is undefined', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c4',
        rawOutput: undefined,
      } as any) as any;
      // undefined rawOutput -> content ""
      expect(r.content).toBe('');
    });

    it('safeStringify handles non-JSON-serializable rawOutput (circular)', () => {
      const circular: any = { ok: true };
      circular.self = circular;
      const r = mapAcpUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c5',
        rawOutput: circular,
      } as any) as any;
      expect(r.type).toBe('tool_result');
      // Should not throw; falls back to String(v)
      expect(typeof r.content).toBe('string');
    });
  });

  describe('safe-ignore (spec §5.3: unknown ACP update must not crash)', () => {
    it.each([
      'available_commands_update',
      'current_mode_update',
      'config_option_update',
      'session_info_update',
      'usage_update',
    ])('%s -> null (no AgentEventType slot)', (su) => {
      expect(mapAcpUpdate({ sessionUpdate: su } as any)).toBeNull();
    });

    it('maps ACP plan updates to observable plan events', () => {
      expect(mapAcpUpdate({ sessionUpdate: 'plan', entries: [] } as any)).toEqual({
        type: 'plan',
        content: JSON.stringify({ entries: [] }),
      });
      expect(mapAcpUpdate({ sessionUpdate: 'plan_removed', planId: 'p1' } as any)).toEqual({
        type: 'plan',
        content: JSON.stringify({ planId: 'p1', removed: true }),
      });
    });

    it('unknown future sessionUpdate -> null', () => {
      expect(mapAcpUpdate({ sessionUpdate: 'some_future_thing' } as any)).toBeNull();
    });

    it('does not throw on unknown input', () => {
      expect(() => mapAcpUpdate({ sessionUpdate: 'whatever_new' } as any)).not.toThrow();
    });
  });

  describe('return type', () => {
    it('returns AgentEvent or null (never undefined)', () => {
      const r = mapAcpUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'x' },
      } as any);
      expect(r).not.toBeUndefined();
      expect(r === null || (r as AgentEvent).type !== undefined).toBe(true);
    });
  });

  describe('KNOWN_SESSION_UPDATE_TYPES', () => {
    // Covers all 13 SDK-defined variants (mapped + known-safe-ignore). Used by
    // AcpBackend to gate its unmapped-update warning so known-safe-ignore
    // variants (e.g. usage_update) do not spam logs. See review Important #2.
    it.each([
      'user_message_chunk',
      'agent_message_chunk',
      'agent_thought_chunk',
      'tool_call',
      'tool_call_update',
      'plan',
      'plan_update',
      'plan_removed',
      'available_commands_update',
      'current_mode_update',
      'config_option_update',
      'session_info_update',
      'usage_update',
    ])('includes known variant %s', (su) => {
      expect(KNOWN_SESSION_UPDATE_TYPES.has(su)).toBe(true);
    });

    it('excludes unknown future variants', () => {
      expect(KNOWN_SESSION_UPDATE_TYPES.has('some_future_thing')).toBe(false);
    });
  });
});

describe('createTurnScopedAcpEventMapper', () => {
  it('merges Claude input refinement and emits only the terminal result', () => {
    const mapTurnUpdate = createTurnScopedAcpEventMapper();

    const use = mapTurnUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'claude-call-1',
      title: 'Read File',
      kind: 'read',
      status: 'pending',
      rawInput: {},
    } as any);
    const refinement = mapTurnUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'claude-call-1',
      status: 'in_progress',
      rawInput: { file_path: 'README.md' },
    } as any);
    const completed = mapTurnUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'claude-call-1',
      status: 'completed',
      rawOutput: { ok: true },
    } as any);

    expect(use?.tool?.name).toBe('Read File');
    expect(refinement).toBeNull();
    expect(completed?.tool?.name).toBe('Read File');
    expect(completed?.tool?.input).toBe(JSON.stringify({ file_path: 'README.md' }));
    expect(completed?.tool?.status).toBe('completed');
  });

  it('keeps a failed Claude result failed instead of manufacturing success', () => {
    const mapTurnUpdate = createTurnScopedAcpEventMapper();
    mapTurnUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'claude-denied-1',
      title: 'Write',
      status: 'pending',
      rawInput: {},
    } as any);
    expect(mapTurnUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'claude-denied-1',
      rawInput: { file_path: 'plan.md', content: '# Plan' },
    } as any)).toBeNull();

    const failed = mapTurnUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'claude-denied-1',
      status: 'failed',
      rawOutput: 'permission denied',
    } as any);

    expect(failed).toMatchObject({
      type: 'tool_result',
      tool: {
        name: 'Write',
        input: JSON.stringify({ file_path: 'plan.md', content: '# Plan' }),
        status: 'failed',
      },
    });
  });

  it('preserves adapters that send a final rawOutput without a status', () => {
    const mapTurnUpdate = createTurnScopedAcpEventMapper();
    mapTurnUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'output-only-1',
      title: 'Search',
    } as any);

    const result = mapTurnUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'output-only-1',
      rawOutput: { matches: 2 },
    } as any);

    expect(result).toMatchObject({
      type: 'tool_result',
      tool: { name: 'Search', output: JSON.stringify({ matches: 2 }) },
    });
  });

  it('keeps in-progress rawOutput correlated until an explicit failed terminal update', () => {
    const mapTurnUpdate = createTurnScopedAcpEventMapper();
    mapTurnUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'progress-output-1',
      title: 'Write',
      status: 'pending',
      rawInput: {},
    } as any);

    expect(mapTurnUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'progress-output-1',
      status: 'in_progress',
      rawInput: { file_path: 'README.md' },
      rawOutput: 'partial progress',
    } as any)).toBeNull();

    const failed = mapTurnUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'progress-output-1',
      status: 'failed',
    } as any);

    expect(failed).toMatchObject({
      type: 'tool_result',
      content: JSON.stringify('partial progress'),
      tool: {
        name: 'Write',
        input: JSON.stringify({ file_path: 'README.md' }),
        output: JSON.stringify('partial progress'),
        status: 'failed',
      },
    });
  });

  it('uses a neutral fallback for an unseen call id and does not leak across turns', () => {
    const firstTurn = createTurnScopedAcpEventMapper();
    firstTurn({
      sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'Terminal', status: 'pending',
    } as any);

    const secondTurn = createTurnScopedAcpEventMapper();
    const result = secondTurn({
      sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed',
    } as any);

    expect(result?.tool?.name).toBe('tool');
  });
});
