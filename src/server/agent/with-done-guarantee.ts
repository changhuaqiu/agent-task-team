import type { AgentEvent, AgentResult } from './types';

/**
 * Wraps an agent event stream to guarantee a `done` event is always emitted.
 *
 * Some backends (e.g., OpenCode) may not yield a `done` event when the process
 * exits. This wrapper ensures consumers can always rely on `done` as a
 * completion signal — matching the contract that Clowder AI enforces at the
 * provider level.
 *
 * If the underlying stream already yields `done`, this is a no-op passthrough.
 */
export async function* withDoneGuarantee(
  events: AsyncGenerator<AgentEvent>,
  result: Promise<AgentResult>,
): AsyncGenerator<AgentEvent> {
  let sawDone = false;

  for await (const event of events) {
    if (event.type === 'done') sawDone = true;
    yield event;
  }

  if (!sawDone) {
    const r = await result;
    yield {
      type: 'done',
      content: r.output ?? '',
      sessionId: r.sessionId,
    };
  }
}
