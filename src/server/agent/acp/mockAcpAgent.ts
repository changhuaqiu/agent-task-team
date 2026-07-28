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
 * Scripted scenario the mock agent plays out on `session/prompt`.
 *
 *  - `"normal"` (default): the canonical Task 3/5 sequence —
 *    text → tool_call → permission → tool_call_update → text → end_turn.
 *    Existing tests (mockAcpAgent.test.ts, acpBackend.test.ts) depend on this
 *    exact sequence, so it MUST stay unchanged.
 *
 *  - `"slow"`: emit the opening `agent_message_chunk` (text "开始"), then
 *    BLOCK mid-turn for a long time (60s) before completing the rest of the
 *    sequence. The point is an interruptible long turn: `AcpBackend.kill()`
 *    or a short `timeoutMs` can fire while the agent is still mid-turn, so
 *    the cause-based close handler resolves `cancelled` / `timeout`.
 *    (Task 9 cancel/timeout compat tests.)
 *
 *  - `"error"`: emit the opening text chunk, then abnormally exit mid-turn
 *    (`process.exit(1)`) — so `AcpBackend`'s `close` handler fires with an
 *    abnormal exit and resolves `failed`. (Task 9 failure-recovery test.)
 */
export type MockScenario = 'normal' | 'slow' | 'active' | 'error' | 'flood' | 'large' | 'wrong_session' | 'empty_once' | 'empty_silent' | 'tool_only' | 'tool_silent' | 'mcp_echo' | 'platform_mcp_permission';

/** How long the "slow" scenario blocks mid-turn before completing. */
const SLOW_BLOCK_MS = 60_000;

/**
 * Build the mock ACP agent app. Registers handlers for `initialize`,
 * `session/new`, `authenticate`, and `session/prompt`.
 *
 * On `session/prompt` the agent emits this scripted sequence (for the default
 * `"normal"` scenario):
 *  1. `agent_message_chunk` (text "开始")
 *  2. `tool_call` (pending)
 *  3. `session/request_permission` (awaited; client selects allow/reject)
 *  4. `tool_call_update` (status = allowed ? "completed" : "failed")
 *  5. `agent_message_chunk` (text "完成")
 *  6. returns `{ stopReason: "end_turn" }`
 *
 * The `"slow"` and `"error"` scenarios emit step 1 then interrupt (block /
 * exit) before step 2, so kill/timeout/abnormal-exit paths can be exercised.
 *
 * The reject path emits `"failed"` — a valid member of the SDK's
 * `ToolCallStatus` union (`pending` | `in_progress` | `completed` | `failed`)
 * — so it survives the receiving side's zod parsing and is observable through
 * the standard `ActiveSession.nextUpdate()` stream (the path Task 5's
 * `AcpBackend` uses). `"failed"` conveys that the tool call did not succeed
 * (permission was rejected).
 */
export function createMockAgentApp(
  scenario: MockScenario = 'normal',
): acp.AgentApp {
  let promptCount = 0;
  let sessionMcpServers: acp.McpServer[] = [];
  return acp
    .agent({ name: 'mock-acp-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: process.env.MOCK_ACP_LOAD_SESSION !== 'false' },
    }))
    .onRequest(acp.methods.agent.session.new, (ctx) => {
      sessionMcpServers = ctx.params.mcpServers;
      return { sessionId: 'mock-1' };
    })
    .onRequest(acp.methods.agent.session.load, async (ctx) => {
      sessionMcpServers = ctx.params.mcpServers;
      if (process.env.MOCK_ACP_LOAD_FAIL === 'true') {
        throw new Error('mock load failed');
      }
      // ACP load may replay history. The client must not append this content
      // to the new invocation's event stream.
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '历史回放' },
        },
      });
      return {};
    })
    .onRequest(acp.methods.agent.authenticate, () => ({}))
    // No-op handlers so Task 5's AcpBackend.kill() (session/cancel) and
    // daemon mode switches (session/setMode) don't hit method-not-found.
    // These are no-ops for the scripted turn; real cooperative cancellation
    // is a later concern.
    .onRequest(acp.methods.agent.session.setMode, () => ({}))
    .onNotification(acp.methods.agent.session.cancel, () => {})
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      promptCount += 1;
      const sessionId = ctx.params.sessionId;
      const updateSessionId = scenario === 'wrong_session' ? 'mock-wrong' : sessionId;
      const upd = (update: acp.SessionUpdate) =>
        ctx.client.notify(acp.methods.client.session.update, {
          sessionId: updateSessionId,
          update,
        });

      if (scenario === 'mcp_echo') {
        await upd({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: JSON.stringify(sessionMcpServers) },
        });
        return { stopReason: 'end_turn' };
      }

      if (scenario === 'empty_once' || scenario === 'empty_silent') {
        if (scenario === 'empty_once' && promptCount > 1) {
          await upd({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'recovered empty turn' },
          });
        }
        return { stopReason: 'end_turn' };
      }

      if (scenario === 'tool_only' && promptCount > 1) {
        await upd({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '恢复后的最终答复' },
        });
        return { stopReason: 'end_turn' };
      }

      // 1. Opening agent message. Tool-only scenarios deliberately omit all
      // text on the first turn so the harness completion invariant is tested.
      if (scenario !== 'tool_only' && scenario !== 'tool_silent') {
        await upd({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '开始' },
        });
      }

      // --- Scenario fork (Task 9): after the opening text, "slow" blocks
      // mid-turn and "error" exits mid-turn, so kill/timeout/abnormal-exit
      // paths fire while the turn is still in progress. Only the "normal"
      // scenario continues to the tool/permission/end_turn sequence. ---
      if (scenario === 'slow') {
        // Block for a long time — long enough that kill()/timeout (which fire
        // in ~500ms) always win the race. We never reach the tool/end_turn
        // steps in this scenario; the process is tree-killed mid-await.
        await new Promise((r) => setTimeout(r, SLOW_BLOCK_MS));
        // If we somehow get here (block elapsed without kill), complete
        // gracefully so the turn doesn't hang forever.
        return { stopReason: 'end_turn' };
      }
      if (scenario === 'error') {
        // Abnormally exit mid-turn. The client observes a process exit with a
        // non-zero code → AcpBackend's close handler resolves 'failed'.
        console.error('Authorization: Bearer test-secret-token');
        process.exit(1);
      }

      if (scenario === 'flood') {
        for (let index = 0; index < 100; index += 1) {
          await upd({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `chunk-${index}` },
          });
        }
        return { stopReason: 'end_turn' };
      }
      if (scenario === 'active') {
        for (let index = 0; index < 10; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await upd({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `active-${index}` },
          });
        }
        return { stopReason: 'end_turn' };
      }

      if (scenario === 'large') {
        await upd({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'x'.repeat(10_000) },
        });
        return { stopReason: 'end_turn' };
      }

      const activeToolCall = scenario === 'platform_mcp_permission'
        ? { ...TOOL_CALL, title: 'mcp.agent-task-team.task_create' }
        : TOOL_CALL;

      // 2. Tool call created (pending).
      await upd({
        sessionUpdate: 'tool_call',
        ...activeToolCall,
      });

      // 3. Request permission and await the client's decision.
      const perm = await ctx.client.request(
        acp.methods.client.session.requestPermission,
        {
          sessionId,
          toolCall: { ...activeToolCall, ...(scenario === 'platform_mcp_permission' ? { title: undefined } : {}) },
          ...(scenario === 'platform_mcp_permission' ? { _meta: { is_mcp_tool_approval: true } } : {}),
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

      if (scenario === 'platform_mcp_permission') {
        await upd({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: allowed ? 'platform-allowed' : 'platform-denied' },
        });
      }

      // 5. Closing agent message.
      if (scenario !== 'tool_only' && scenario !== 'tool_silent') {
        await upd({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '完成' },
        });
      }

      // 6. Turn complete.
      return { stopReason: 'end_turn' };
    });
}

// ---------------------------------------------------------------------------
// Subprocess entry: `npx tsx src/server/agent/acp/mockAcpAgent.ts` serves an
// ACP agent over NDJSON stdio. The client (e.g. AcpBackend in Task 5) spawns
// this process and speaks ACP over stdin/stdout.
//
// The scenario is selected via the `MOCK_ACP_SCENARIO` env var (one of
// "normal" | "slow" | "error" | "flood" | "large"; default "normal"). AcpBackend passes its `env`
// through to spawn, so compat tests set it on the backend opts.
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const envScenario = process.env.MOCK_ACP_SCENARIO;
  const scenario: MockScenario =
    envScenario === 'slow'
      || envScenario === 'active'
      || envScenario === 'error'
      || envScenario === 'normal'
      || envScenario === 'flood'
      || envScenario === 'large'
      || envScenario === 'wrong_session'
      || envScenario === 'empty_once'
      || envScenario === 'empty_silent'
      || envScenario === 'tool_only'
      || envScenario === 'tool_silent'
      || envScenario === 'mcp_echo'
      || envScenario === 'platform_mcp_permission'
      ? envScenario
      : 'normal';
  const stream = acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
  createMockAgentApp(scenario).connect(stream);
}
