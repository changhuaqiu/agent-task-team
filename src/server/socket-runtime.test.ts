import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiResponse } from 'next';

const runtime = vi.hoisted(() => ({
  registerDaemon: vi.fn(),
  instances: [] as Array<{ host: unknown; options: unknown }>,
  listeners: [] as Array<{ event: string; listener: unknown }>,
}));

vi.mock('socket.io', () => ({
  Server: class FakeIOServer {
    constructor(host: unknown, options: unknown) {
      runtime.instances.push({ host, options });
    }

    on(event: string, listener: unknown) {
      runtime.listeners.push({ event, listener });
      return this;
    }
  },
}));

vi.mock('./daemon', () => ({
  default: runtime.registerDaemon,
}));

import { ensureProjectSocketRuntime } from './socket-runtime';

describe('ensureProjectSocketRuntime', () => {
  beforeEach(() => {
    runtime.instances.length = 0;
    runtime.listeners.length = 0;
    runtime.registerDaemon.mockReset();
  });

  it('initializes and attaches the daemon on the first headless request', () => {
    const host = {};
    const response = { socket: { server: host } } as unknown as NextApiResponse;
    const first = ensureProjectSocketRuntime(response);
    const second = ensureProjectSocketRuntime(response);

    expect(first).toMatchObject({ created: true });
    expect(second).toEqual({ io: first?.io, created: false });
    expect(runtime.instances).toEqual([{
      host,
      options: { path: '/api/socketio', cors: { origin: '*' } },
    }]);
    expect(runtime.registerDaemon).toHaveBeenCalledTimes(1);
    expect(runtime.registerDaemon).toHaveBeenCalledWith(first?.io);
    expect(runtime.listeners).toEqual([{
      event: 'connection',
      listener: expect.any(Function),
    }]);
  });

  it('returns undefined when the response has no underlying server', () => {
    expect(ensureProjectSocketRuntime({ socket: null } as unknown as NextApiResponse))
      .toBeUndefined();
  });
});
