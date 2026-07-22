// src/server/agent/acp/agentEventMapper.ts
//
// Base mapper plus a turn-scoped correlator for ACP `SessionUpdate` events.
//
// Spec: specs/acp-runtime-integration/spec.md §5.3 (event mapping).
// `mapAcpUpdate` remains pure. `createTurnScopedAcpEventMapper` owns only the
// toolCallId/name correlation needed during one AcpBackend execution.

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { AgentEvent } from '../types';

/**
 * Every SessionUpdate variant recognized by the installed ACP SDK schema
 * (v1.2.1). Covers BOTH the mapped variants (agent_message_chunk, etc.) AND
 * the known-safe-ignore variants (usage_update, plan, etc. — no AgentEventType
 * slot, spec §5.3). AcpBackend uses this to gate its unmapped-update warning so
 * it fires ONLY for genuinely-UNKNOWN `sessionUpdate` values (future protocol
 * additions), not for the known-safe-ignore ones that real agents emit
 * frequently. This module is the authority on what is handled, so the set
 * lives here.
 */
export const KNOWN_SESSION_UPDATE_TYPES = new Set<string>([
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
]);

/**
 * Best-effort stringify for `unknown` raw tool input/output. ACP declares
 * `rawInput`/`rawOutput` as `unknown`; they may hold non-JSON-serializable
 * values (e.g. circular refs), so we must never let JSON.stringify throw.
 */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function failedExitValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'number') return !Number.isFinite(value) || value !== 0;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value) !== 0;
  return false;
}

/**
 * ACP `completed` means the tool RPC returned, not that a process launched by
 * a shell tool exited successfully. Normalize portable structured results
 * before they reach observability or an evidence gate.
 */
export function inferAcpToolResultStatus(
  rawOutput: unknown,
  explicitStatus?: NonNullable<AgentEvent['tool']>['status'],
): NonNullable<AgentEvent['tool']>['status'] | undefined {
  if (explicitStatus === 'failed') return 'failed';

  const inspect = (value: unknown, depth = 0): boolean => {
    if (depth > 3) return false;
    if (typeof value === 'string') {
      if (
        /user refused permission|permission denied|timed? out/i.test(value)
        || /<shell_metadata>[\s\S]*?(?:terminated|timeout|exceeding timeout)[\s\S]*?<\/shell_metadata>/i.test(value)
      ) return true;
      try {
        const parsed = JSON.parse(value);
        return parsed !== value && inspect(parsed, depth + 1);
      } catch {
        return false;
      }
    }
    const candidate = record(value);
    if (!candidate) return false;
    if (candidate.success === false || candidate.ok === false) return true;
    if (typeof candidate.error === 'string' && candidate.error.trim()) return true;
    for (const key of ['exit', 'exitCode', 'code']) {
      if (key in candidate && failedExitValue(candidate[key])) return true;
    }
    return ['metadata', 'result', 'data', 'output'].some((key) =>
      key in candidate && inspect(candidate[key], depth + 1)
    );
  };

  return inspect(rawOutput) ? 'failed' : explicitStatus;
}

/**
 * Map an ACP `SessionUpdate` to an internal `AgentEvent`.
 *
 * Returns `null` for updates that have no `AgentEvent` slot:
 *  - `user_message_chunk` (user echo, not agent output)
 *  - `available_commands_update` /
 *    `current_mode_update` / `config_option_update` / `session_info_update` /
 *    `usage_update` (no corresponding AgentEventType — safe-ignore per §5.3)
 *  - any unknown/future `sessionUpdate` value (MUST NOT throw)
 *
 * Mapping table (authoritative — aligned with installed SDK v1.2.1):
 *  - `agent_message_chunk` (text)  -> `{ type: 'text', content }`
 *  - `agent_thought_chunk` (text)  -> `{ type: 'thinking', content }`
 *  - `plan` / `plan_update` / `plan_removed` -> `{ type: 'plan', content }`
 *  - `tool_call`                   -> `{ type: 'tool_use', content: '', tool: { name, callId, input? } }`
 *  - `tool_call_update`            -> `{ type: 'tool_result', content, tool: { name, callId } }`
 */
export function mapAcpUpdate(update: SessionUpdate): AgentEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content;
      if (content.type === 'text') {
        return { type: 'text', content: content.text };
      }
      return null;
    }

    case 'agent_thought_chunk': {
      const content = update.content;
      if (content.type === 'text') {
        return { type: 'thinking', content: content.text };
      }
      return null;
    }

    case 'tool_call': {
      const name = update.title || update.kind || 'tool';
      const input =
        update.rawInput != null ? safeStringify(update.rawInput) : undefined;
      return {
        type: 'tool_use',
        content: '',
        tool: {
          name,
          callId: update.toolCallId,
          ...(input !== undefined && { input }),
          ...(update.status != null && { status: update.status }),
        },
      };
    }

    case 'tool_call_update': {
      const name = update.title || '';
      const input =
        update.rawInput != null ? safeStringify(update.rawInput) : undefined;
      const output =
        update.rawOutput != null ? safeStringify(update.rawOutput) : '';
      const status = inferAcpToolResultStatus(update.rawOutput, update.status ?? undefined);
      return {
        type: 'tool_result',
        content: output,
        tool: {
          name,
          callId: update.toolCallId,
          ...(input !== undefined && { input }),
          ...(update.rawOutput != null && { output }),
          ...(status != null && { status }),
        },
      };
    }

    case 'plan':
      return { type: 'plan', content: safeStringify({ entries: update.entries }) };
    case 'plan_update':
      return { type: 'plan', content: safeStringify(update.plan) };
    case 'plan_removed':
      return { type: 'plan', content: safeStringify({ planId: update.planId, removed: true }) };

    // No AgentEventType slot for these — safe-ignore per spec §5.3.
    case 'user_message_chunk':
    case 'available_commands_update':
    case 'current_mode_update':
    case 'config_option_update':
    case 'session_info_update':
    case 'usage_update':
      return null;

    // Unknown/future sessionUpdate — safe-ignore, MUST NOT throw.
    default:
      return null;
  }
}

/**
 * Build a mapper for one ACP prompt turn.
 *
 * Claude-style adapters commonly omit `title` from `tool_call_update` and
 * refer back to the original `tool_call` only by `toolCallId`. Keep that
 * protocol correlation inside the backend boundary so every downstream
 * consumer receives a stable tool name without carrying ACP state itself.
 */
export function createTurnScopedAcpEventMapper(): (update: SessionUpdate) => AgentEvent | null {
  const toolCalls = new Map<string, {
    name: string;
    input?: string;
    output?: string;
    status?: NonNullable<AgentEvent['tool']>['status'];
  }>();

  return (update: SessionUpdate): AgentEvent | null => {
    const event = mapAcpUpdate(update);
    const callId = event?.tool?.callId;
    if (!event || !callId) return event;

    if (event.type === 'tool_use') {
      toolCalls.set(callId, {
        name: event.tool?.name || 'tool',
        ...(event.tool?.input !== undefined && { input: event.tool.input }),
        ...(event.tool?.output !== undefined && { output: event.tool.output }),
        ...(event.tool?.status !== undefined && { status: event.tool.status }),
      });
    } else if (event.type === 'tool_result' && event.tool) {
      const previous = toolCalls.get(callId);
      const name = previous?.name || event.tool.name || 'tool';
      const input = event.tool.input ?? previous?.input;
      const output = event.tool.output ?? previous?.output;
      const status = event.tool.status ?? previous?.status;
      toolCalls.set(callId, {
        name,
        ...(input !== undefined && { input }),
        ...(output !== undefined && { output }),
        ...(status !== undefined && { status }),
      });
      event.tool.name = name;
      if (input !== undefined) event.tool.input = input;
      if (output !== undefined) {
        event.tool.output = output;
        event.content = output;
      }
      if (status !== undefined) event.tool.status = status;

      // Claude can refine a permission-surfaced tool_call with the real input
      // or partial output before execution finishes. Any explicitly
      // non-terminal cumulative status remains progress even when rawOutput is
      // present. Only status-less adapters may use rawOutput as the terminal
      // compatibility signal.
      if (status === 'pending' || status === 'in_progress') {
        return null;
      }
      if (status !== 'completed' && status !== 'failed' && output === undefined) {
        return null;
      }
      toolCalls.delete(callId);
    }
    return event;
  };
}
