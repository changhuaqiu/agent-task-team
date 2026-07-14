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
 *  4. `tool_call_update` (status = allowed ? "completed" : "failed")
 *  5. `agent_message_chunk` (text "完成")
 *  6. returns `{ stopReason: "end_turn" }`
 *
 * The reject path emits `"failed"` — a valid member of the SDK's
 * `ToolCallStatus` union (`pending` | `in_progress` | `completed` | `failed`)
 * — so it survives the receiving side's zod parsing and is observable through
 * the standard `ActiveSession.nextUpdate()` stream (the path Task 5's
 * `AcpBackend` uses). `"failed"` conveys that the tool call did not succeed
 * (permission was rejected).
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
    // No-op handlers so Task 5's AcpBackend.kill() (session/cancel) and
    // daemon mode switches (session/setMode) don't hit method-not-found.
    // These are no-ops for the scripted turn; real cooperative cancellation
    // is a later concern.
    .onRequest(acp.methods.agent.session.setMode, () => ({}))
    .onNotification(acp.methods.agent.session.cancel, () => {})
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
      //    On rejection emit "failed" — a valid ACP ToolCallStatus
      //    (pending|in_progress|completed|failed) — so the value survives
      //    the receiving side's zod parsing and is observable through the
      //    standard ActiveSession.nextUpdate() stream (the path Task 5's
      //    AcpBackend uses). "failed" conveys that the tool call did not
      //    succeed (permission was rejected). No cast needed: "failed" is a
      //    union member.
      const toolStatus: acp.ToolCallStatus = allowed ? 'completed' : 'failed';
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
