import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('runtime ownership architecture', () => {
  const daemon = source('src/server/daemon.ts');
  const taskHubStore = source('src/store/taskHubStore.ts');

  it('does not accept browser execution acknowledgements for server-owned A2A work', () => {
    for (const event of [
      'a2a:agent-started',
      'a2a:dispatch-failed',
      'a2a:dispatch-deferred',
      'a2a:user-message',
    ]) {
      expect(daemon).not.toContain(`socket.on('${event}'`);
    }
  });

  it('does not retain legacy automatic-control consumers in WebUI', () => {
    for (const event of ['agent:event', 'agent:error', 'task.assigned']) {
      expect(taskHubStore).not.toContain(`socket.on('${event}'`);
    }
    expect(taskHubStore).not.toContain(`socket.emit('a2a:agent-started'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:dispatch-failed'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:dispatch-deferred'`);
    expect(taskHubStore).not.toContain('handledByHarness');
    expect(taskHubStore).not.toContain('harnessFallbackReasonCode');
  });

  it('keeps explicit human command adapters available', () => {
    expect(taskHubStore).toContain(`type: 'a2a.human_handoff'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:user-turn-created'`);
    expect(daemon).not.toContain(`socket.on('a2a:user-turn-created'`);
    expect(daemon).toContain(`socket.on('terminal:start'`);
    expect(daemon).toContain(`socket.on('terminal:kill'`);
  });

  it('allows global broadcast only for the system runtime catalog', () => {
    const broadcastEvents = Array.from(
      daemon.matchAll(/\bbroadcast\('([^']+)'/g),
      (match) => match[1],
    );
    expect(broadcastEvents).toEqual(['runtimes:update']);
    expect(daemon.match(/\bio\.emit\(/g)).toHaveLength(1);
  });
});
