// src/test-helpers/acp/mockAcpAgent.test.ts
//
// In-process test for the mock ACP agent (test double). Drives one prompt turn
// through a real `client()` ClientApp connected directly to
// `createMockAgentApp()` — no subprocess. Asserts the scripted emit sequence,
// the permission round-trip, and both permission outcomes (allow →
// tool_call_update "completed"; reject → "failed").
//
// All update assertions go through the STANDARD `ActiveSession.nextUpdate()`
// stream — the same path Task 5's `AcpBackend` uses — so the test observes
// exactly what a real consumer will observe. No raw-capture notification
// handler, no zod bypass.
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking. Field access on discriminated-
// union variants uses `as any` where array-index narrowing does not apply.

import { describe, it, expect } from 'vitest';
import * as acp from '@agentclientprotocol/sdk';
import { createMockAgentApp } from './mockAcpAgent';

/**
 * The `tool_call_update` variant of `SessionUpdate`, narrowed for typed field
 * access in assertions.
 */
type ToolCallUpdateMessage = Extract<
  acp.SessionUpdate,
  { sessionUpdate: 'tool_call_update' }
>;

/**
 * Drive one prompt turn against the mock agent in-process, with the test
 * client returning a controlled permission decision.
 *
 * Reads the full update sequence through the STANDARD
 * `ActiveSession.nextUpdate()` stream (the same path Task 5's AcpBackend
 * uses) — no raw-capture notification handler, no zod bypass.
 *
 * Captures:
 *  - `updates`: the typed `SessionUpdate` values drained from `nextUpdate()`
 *    (in emit order).
 *  - `permissionRequest`: the `session/request_permission` request params.
 *  - `response`: the final `session/prompt` response (stopReason).
 *  - `sessionId`: the `session/new` response.
 */
async function runMockTurn(allow: boolean) {
  const agentApp = createMockAgentApp();

  let permissionRequest: acp.RequestPermissionRequest | null = null;

  const clientApp = acp
    .client({ name: 'test-client' })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      permissionRequest = ctx.params;
      return {
        outcome: allow
          ? { outcome: 'selected' as const, optionId: 'allow' }
          : { outcome: 'selected' as const, optionId: 'reject' },
      };
    });

  const result = await clientApp.connectWith(agentApp, async (ctx) => {
    return ctx.buildSession(process.cwd()).withSession(async (session) => {
      // Start the prompt turn without awaiting so we can drain updates
      // concurrently via the standard nextUpdate() stream. The permission
      // request (an inbound client-side request) is handled in parallel by
      // the handler registered above; nextUpdate() only blocks on
      // session/update notifications and the final stop message.
      const promptPromise = session.prompt('go');
      const updates: acp.SessionUpdate[] = [];
      for (;;) {
        const msg = await session.nextUpdate();
        if (msg.kind === 'stop') break;
        updates.push(msg.update);
      }
      const response = await promptPromise;
      return { response, sessionId: session.sessionId, updates };
    });
  });

  return { ...result, permissionRequest };
}

describe('createMockAgentApp', () => {
  it('emits the scripted update sequence and ends with end_turn', async () => {
    const { updates, permissionRequest, response, sessionId } =
      await runMockTurn(true);

    // session/new returned the fixed mock id.
    expect(sessionId).toBe('mock-1');

    // A permission request arrived mid-turn.
    expect(permissionRequest).not.toBeNull();
    const perm = permissionRequest!;
    expect(perm.toolCall.toolCallId).toBe('t1');
    expect(perm.toolCall.title).toBe('改文件');
    expect(perm.toolCall.kind).toBe('edit');
    expect(perm.toolCall.status).toBe('pending');
    expect(perm.options.map((o) => o.optionId)).toEqual(['allow', 'reject']);
    expect(perm.options.map((o) => o.kind)).toEqual([
      'allow_once',
      'reject_once',
    ]);

    // Update sequence (observed via the standard nextUpdate() stream):
    //   1. agent_message_chunk  text "开始"
    //   2. tool_call            pending
    //   3. tool_call_update     (status depends on permission outcome)
    //   4. agent_message_chunk  text "完成"
    expect(updates).toHaveLength(4);

    // 1. agent_message_chunk text "开始"
    expect(updates[0].sessionUpdate).toBe('agent_message_chunk');
    expect((updates[0] as any).content).toEqual({ type: 'text', text: '开始' });

    // 2. tool_call pending
    expect(updates[1].sessionUpdate).toBe('tool_call');
    expect((updates[1] as any).toolCallId).toBe('t1');
    expect((updates[1] as any).title).toBe('改文件');
    expect((updates[1] as any).kind).toBe('edit');
    expect((updates[1] as any).status).toBe('pending');

    // 3. tool_call_update (allow → completed)
    expect(updates[2].sessionUpdate).toBe('tool_call_update');
    expect((updates[2] as any).toolCallId).toBe('t1');
    expect((updates[2] as any).status).toBe('completed');

    // 4. agent_message_chunk text "完成"
    expect(updates[3].sessionUpdate).toBe('agent_message_chunk');
    expect((updates[3] as any).content).toEqual({ type: 'text', text: '完成' });

    // Turn ended with end_turn.
    expect(response.stopReason).toBe('end_turn');
  }, 15000);

  it('marks tool_call_update as completed when client allows', async () => {
    const { updates } = await runMockTurn(true);
    const toolCallUpdate = updates.find(
      (u): u is ToolCallUpdateMessage => u.sessionUpdate === 'tool_call_update',
    );
    expect(toolCallUpdate).toBeDefined();
    // Observed via the standard nextUpdate() stream — no zod bypass.
    expect(toolCallUpdate!.status).toBe('completed');
  }, 15000);

  it('marks tool_call_update as failed when client rejects', async () => {
    const { updates } = await runMockTurn(false);
    const toolCallUpdate = updates.find(
      (u): u is ToolCallUpdateMessage => u.sessionUpdate === 'tool_call_update',
    );
    expect(toolCallUpdate).toBeDefined();
    // The reject path emits "failed" — a valid ToolCallStatus union member
    // (pending|in_progress|completed|failed) — so it survives the SDK's zod
    // parsing and is observable through the standard nextUpdate() stream
    // (the path Task 5's AcpBackend uses). No raw-capture workaround.
    expect(toolCallUpdate!.status).toBe('failed');
  }, 15000);
});
