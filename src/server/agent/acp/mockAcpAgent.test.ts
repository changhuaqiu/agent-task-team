// src/server/agent/acp/mockAcpAgent.test.ts
//
// In-process test for the mock ACP agent (test double). Drives one prompt turn
// through a real `client()` ClientApp connected directly to
// `createMockAgentApp()` — no subprocess. Asserts the scripted emit sequence,
// the permission round-trip, and both permission outcomes (allow →
// tool_call_update "completed"; reject → "cancelled").
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); raw captured
// payloads use `any` where they touch the SDK's narrower union types.

import { describe, it, expect } from 'vitest';
import * as acp from '@agentclientprotocol/sdk';
import { createMockAgentApp } from './mockAcpAgent';

/**
 * Drive one prompt turn against the mock agent in-process, with the test
 * client returning a controlled permission decision.
 *
 * Captures:
 *  - `rawUpdates`: the RAW `session/update` notification params (before zod
 *    parsing), so the mock's `"cancelled"` ToolCallStatus sentinel — which the
 *    SDK's zod layer would otherwise strip to `undefined` — is observable.
 *  - `permissionRequest`: the `session/request_permission` request params.
 *  - `response`: the final `session/prompt` response (stopReason).
 *  - `sessionId`: the `session/new` response.
 *
 * Raw capture uses the generic 3-arg `onNotification(method, parser, handler)`
 * overload with a passthrough parser. The built-in `SessionUpdateRouter`
 * (registered in the `ClientApp` constructor) runs first and returns
 * `Handled.no`, so it still routes updates to the `ActiveSession` queue; our
 * raw handler runs second and captures the unmodified params.
 */
async function runMockTurn(allow: boolean) {
  const agentApp = createMockAgentApp();

  const rawUpdates: any[] = [];
  let permissionRequest: any = null;

  const clientApp = acp
    .client({ name: 'test-client' })
    // Capture RAW session/update params (bypass the built-in zod parser).
    .onNotification(
      'session/update',
      (p: unknown) => p,
      (ctx) => {
        rawUpdates.push(ctx.params);
      },
    )
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
      const response = await session.prompt('go');
      return { response, sessionId: session.sessionId };
    });
  });

  return { ...result, rawUpdates, permissionRequest };
}

describe('createMockAgentApp', () => {
  it('emits the scripted update sequence and ends with end_turn', async () => {
    const { rawUpdates, permissionRequest, response, sessionId } =
      await runMockTurn(true);

    // session/new returned the fixed mock id.
    expect(sessionId).toBe('mock-1');

    // A permission request arrived mid-turn.
    expect(permissionRequest).not.toBeNull();
    const perm = permissionRequest;
    expect(perm.toolCall.toolCallId).toBe('t1');
    expect(perm.toolCall.title).toBe('改文件');
    expect(perm.toolCall.kind).toBe('edit');
    expect(perm.toolCall.status).toBe('pending');
    expect(perm.options.map((o: any) => o.optionId)).toEqual(['allow', 'reject']);
    expect(perm.options.map((o: any) => o.kind)).toEqual([
      'allow_once',
      'reject_once',
    ]);

    // Update sequence (raw wire values):
    //   1. agent_message_chunk  text "开始"
    //   2. tool_call            pending
    //   3. tool_call_update     (status depends on permission outcome)
    //   4. agent_message_chunk  text "完成"
    expect(rawUpdates).toHaveLength(4);

    const updates = rawUpdates.map((n: any) => n.update);

    // 1. agent_message_chunk text "开始"
    expect(updates[0].sessionUpdate).toBe('agent_message_chunk');
    expect(updates[0].content).toEqual({ type: 'text', text: '开始' });

    // 2. tool_call pending
    expect(updates[1].sessionUpdate).toBe('tool_call');
    expect(updates[1].toolCallId).toBe('t1');
    expect(updates[1].title).toBe('改文件');
    expect(updates[1].kind).toBe('edit');
    expect(updates[1].status).toBe('pending');

    // 3. tool_call_update (allow → completed)
    expect(updates[2].sessionUpdate).toBe('tool_call_update');
    expect(updates[2].toolCallId).toBe('t1');
    expect(updates[2].status).toBe('completed');

    // 4. agent_message_chunk text "完成"
    expect(updates[3].sessionUpdate).toBe('agent_message_chunk');
    expect(updates[3].content).toEqual({ type: 'text', text: '完成' });

    // Turn ended with end_turn.
    expect(response.stopReason).toBe('end_turn');
  }, 15000);

  it('marks tool_call_update as completed when client allows', async () => {
    const { rawUpdates } = await runMockTurn(true);
    const toolCallUpdate = rawUpdates
      .map((n: any) => n.update)
      .find((u: any) => u.sessionUpdate === 'tool_call_update');
    expect(toolCallUpdate).toBeDefined();
    expect(toolCallUpdate.status).toBe('completed');
  }, 15000);

  it('marks tool_call_update as cancelled when client rejects', async () => {
    const { rawUpdates } = await runMockTurn(false);
    const toolCallUpdate = rawUpdates
      .map((n: any) => n.update)
      .find((u: any) => u.sessionUpdate === 'tool_call_update');
    expect(toolCallUpdate).toBeDefined();
    // "cancelled" is the mock's rejection sentinel — NOT a member of the
    // SDK's ToolCallStatus union (pending|in_progress|completed|failed). The
    // mock emits it on the wire; the test observes it via the raw-capture
    // notification handler (the SDK's zod layer would otherwise strip it to
    // undefined — see mockAcpAgent.ts for details).
    expect(toolCallUpdate.status).toBe('cancelled');
  }, 15000);
});
