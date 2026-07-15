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

/**
 * Map an ACP `SessionUpdate` to an internal `AgentEvent`.
 *
 * Returns `null` for updates that have no `AgentEvent` slot:
 *  - `user_message_chunk` (user echo, not agent output)
 *  - `plan` / `plan_update` / `plan_removed` / `available_commands_update` /
 *    `current_mode_update` / `config_option_update` / `session_info_update` /
 *    `usage_update` (no corresponding AgentEventType — safe-ignore per §5.3)
 *  - any unknown/future `sessionUpdate` value (MUST NOT throw)
 *
 * Mapping table (authoritative — aligned with installed SDK v1.2.1):
 *  - `agent_message_chunk` (text)  -> `{ type: 'text', content }`
 *  - `agent_thought_chunk` (text)  -> `{ type: 'thinking', content }`
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
        tool: { name, callId: update.toolCallId, ...(input !== undefined && { input }) },
      };
    }

    case 'tool_call_update': {
      const name = update.title || '';
      const content =
        update.rawOutput != null ? safeStringify(update.rawOutput) : '';
      return {
        type: 'tool_result',
        content,
        tool: { name, callId: update.toolCallId },
      };
    }

    // No AgentEventType slot for these — safe-ignore per spec §5.3.
    case 'user_message_chunk':
    case 'plan':
    case 'plan_update':
    case 'plan_removed':
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
  const toolNames = new Map<string, string>();

  return (update: SessionUpdate): AgentEvent | null => {
    const event = mapAcpUpdate(update);
    const callId = event?.tool?.callId;
    if (!event || !callId) return event;

    if (event.type === 'tool_use') {
      toolNames.set(callId, event.tool?.name || 'tool');
    } else if (event.type === 'tool_result' && event.tool) {
      event.tool.name = toolNames.get(callId) || event.tool.name || 'tool';
    }
    return event;
  };
}
