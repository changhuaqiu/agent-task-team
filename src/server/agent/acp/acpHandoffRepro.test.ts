// Targeted reproduction: claude ACP session resume across two turns, simulating
// an A2A handoff where agent B reuses agent A's confirmed runtime session.
//
// Spawns the REAL claude-agent-acp adapter. Runs two prompt turns against the
// SAME session id (second turn uses resumeSessionId). This is the path that
// daemon.ts handleTerminalStart takes when an agent has a persisted
// cli_session_id from a prior successful turn.
//
// If the second turn fails with acp_session_not_found or hangs, that localizes
// the handoff breakage to the ACP session-resume path.

import { describe, it, expect } from 'vitest';
import { AcpBackend } from './acpBackend';

describe('AcpBackend claude handoff repro (real claude-agent-acp)', () => {
  // Long timeout: claude adapter startup + two full turns.
  it('completes two turns resuming the same session (simulates A2A handoff)', async () => {
    const backend = new AcpBackend({
      command: 'npx',
      args: ['-y', '@agentclientprotocol/claude-agent-acp@0.59.0'],
      engine: 'claude',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
      timeoutMs: 120_000,
    });

    // --- Turn 1: establish session ---
    const run1 = backend.execute('Reply with exactly one word: READY', {});
    let sessionId1: string | undefined;
    const types1: string[] = [];
    for await (const event of run1.events) {
      types1.push(event.type);
      if (event.sessionId && !sessionId1) sessionId1 = event.sessionId;
    }
    const result1 = await run1.result;

    expect(result1.status).toBe('completed');
    expect(sessionId1).toBeTruthy();
    console.log('[handoff-repro] Turn 1 completed, sessionId:', sessionId1, 'events:', types1.join(','));

    // --- Turn 2: resume the same session (this is the handoff path) ---
    const backend2 = new AcpBackend({
      command: 'npx',
      args: ['-y', '@agentclientprotocol/claude-agent-acp@0.59.0'],
      engine: 'claude',
      cwd: process.cwd(),
      permissionPolicy: 'allow_once',
      timeoutMs: 120_000,
    });

    const run2 = backend2.execute(
      'Reply with exactly one word: HANDOFF_OK',
      { resumeSessionId: sessionId1 },
    );
    const types2: string[] = [];
    let sessionId2: string | undefined;
    for await (const event of run2.events) {
      types2.push(event.type);
      if (event.sessionId && !sessionId2) sessionId2 = event.sessionId;
    }
    const result2 = await run2.result;

    console.log('[handoff-repro] Turn 2 result:', result2.status,
      'reasonCode:', result2.reasonCode,
      'sessionId:', sessionId2,
      'events:', types2.join(','),
      'error:', result2.error?.slice(0, 200));

    // The handoff succeeds if turn 2 completes without session_not_found.
    expect(result2.status).toBe('completed');
    expect(result2.reasonCode).not.toBe('acp_session_not_found');
  }, 180_000);
});
