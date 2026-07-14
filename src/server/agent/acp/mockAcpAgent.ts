// src/server/agent/acp/mockAcpAgent.ts
//
// Mock ACP agent (agent-side test double). Emits a fixed, scripted sequence of
// `session/update` notifications on each `session/prompt` and requests
// permission mid-turn. Used to exercise `AcpBackend` (Task 5) and the event
// mapper (Task 2) without spawning a real coding agent.
//
// Dual-mode:
//  (a) Importable: `createMockAgentApp()` returns an `AgentApp` that a test can
//      connect to in-process via `clientApp.connectWith(agentApp, ...)`.
//  (b) Spawnable: when run directly (`npx tsx src/server/agent/acp/mockAcpAgent.ts`),
//      it connects to `process.stdin`/`process.stdout` over NDJSON stdio.
//
// Uses the MODERN `agent()` app-builder API (NOT the deprecated
// `AgentSideConnection`/`acp.Agent`). Spec: specs/acp-runtime-integration/spec.md.

import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

/**
 * The fixed tool-call id used by the mock's scripted turn.
 */
const TOOL_CALL_ID = 't1';

/**
 * The tool-call shape sent in both the `tool_call` update and the
 * `session/request_permission` request.
 */
const TOOL_CALL = {
  toolCallId: TOOL_CALL_ID,
  title: '改文件',
  kind: 'edit' as const,
  status: 'pending' as const,
};

/**
 * Permission options offered to the client. Explicitly typed so the
 * `requestPermission` request overload resolves to `RequestPermissionResponse`
 * (an untyped array literal widens the element type and defeats overload
 * inference, falling back to the `unknown` generic overload).
 */
const PERMISSION_OPTIONS: acp.PermissionOption[] = [
  { kind: 'allow_once', name: '允许', optionId: 'allow' },
  { kind: 'reject_once', name: '拒绝', optionId: 'reject' },
];

/**
 * Build the mock ACP agent app. Registers handlers for `initialize`,
 * `session/new`, `authenticate`, and `session/prompt`.
 *
 * On `session/prompt` the agent emits this scripted sequence:
 *  1. `agent_message_chunk` (text "开始")
 *  2. `tool_call` (pending)
 *  3. `session/request_permission` (awaited; client selects allow/reject)
 *  4. `tool_call_update` (status = allowed ? "completed" : "cancelled")
 *  5. `agent_message_chunk` (text "完成")
 *  6. returns `{ stopReason: "end_turn" }`
 *
 * "cancelled" is the mock's rejection sentinel. It is NOT a member of the
 * SDK's `ToolCallStatus` union (`pending` | `in_progress` | `completed` |
 * `failed`), so the value is cast when constructing the update. Note: on the
 * receiving side the SDK's zod layer treats an unknown status as a parse
 * error and falls back to `undefined` (see `defaultOnError`), so clients
 * reading through `ActiveSession.nextUpdate()` observe `status === undefined`
 * for the rejected turn. The raw wire value emitted by the mock remains
 * `"cancelled"`.
 */
export function createMockAgentApp(): acp.AgentApp {
  return acp
    .agent({ name: 'mock-acp-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
    }))
    .onRequest(acp.methods.agent.session.new, () => ({
      sessionId: 'mock-1',
    }))
    .onRequest(acp.methods.agent.authenticate, () => ({}))
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      const sessionId = ctx.params.sessionId;
      const upd = (update: acp.SessionUpdate) =>
        ctx.client.notify(acp.methods.client.session.update, {
          sessionId,
          update,
        });

      // 1. Opening agent message.
      await upd({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '开始' },
      });

      // 2. Tool call created (pending).
      await upd({
        sessionUpdate: 'tool_call',
        ...TOOL_CALL,
      });

      // 3. Request permission and await the client's decision.
      const perm = await ctx.client.request(
        acp.methods.client.session.requestPermission,
        {
          sessionId,
          toolCall: { ...TOOL_CALL },
          options: PERMISSION_OPTIONS,
        },
      );

      const allowed =
        perm.outcome.outcome === 'selected' && perm.outcome.optionId === 'allow';

      // 4. Report the tool call outcome.
      //    "cancelled" is a mock-only sentinel — not a valid ACP
      //    ToolCallStatus (pending|in_progress|completed|failed) — emitted to
      //    signal permission rejection. Cast through unknown to satisfy the
      //    discriminated-union type at compile time. NOTE: on the receiving
      //    side, the SDK's zod layer falls back to `undefined` for an unknown
      //    status value (see `defaultOnError` in schema-deserialize), so a
      //    client reading via `ActiveSession.nextUpdate()` observes
      //    `status === undefined` for the rejected turn.
      const toolStatus = (allowed ? 'completed' : 'cancelled') as unknown as acp.ToolCallStatus;
      await upd({
        sessionUpdate: 'tool_call_update',
        toolCallId: TOOL_CALL_ID,
        status: toolStatus,
      });

      // 5. Closing agent message.
      await upd({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '完成' },
      });

      // 6. Turn complete.
      return { stopReason: 'end_turn' };
    });
}

// ---------------------------------------------------------------------------
// Subprocess entry: `npx tsx src/server/agent/acp/mockAcpAgent.ts` serves an
// ACP agent over NDJSON stdio. The client (e.g. AcpBackend in Task 5) spawns
// this process and speaks ACP over stdin/stdout.
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stream = acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
  createMockAgentApp().connect(stream);
}
