import { afterEach, describe, expect, it } from 'vitest';
import {
  authorizeDesktopHost,
  authorizeDesktopRendererSession,
  createDesktopHandshake,
  DESKTOP_SERVICE_BUILD_REVISION,
  DESKTOP_SERVICE_PROTOCOL_VERSION,
} from './protocol';

const previousSecret = process.env.ATH_DESKTOP_BOOTSTRAP_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.ATH_DESKTOP_BOOTSTRAP_SECRET;
  else process.env.ATH_DESKTOP_BOOTSTRAP_SECRET = previousSecret;
});

describe('desktop host protocol', () => {
  it('fails closed without the exact bootstrap secret', () => {
    process.env.ATH_DESKTOP_BOOTSTRAP_SECRET = 'expected-secret';
    expect(() => authorizeDesktopHost(undefined)).toThrow('desktop_host_unauthorized');
    expect(() => authorizeDesktopHost('wrong-secret')).toThrow('desktop_host_unauthorized');
    expect(authorizeDesktopHost('expected-secret')).toBe('expected-secret');
  });

  it('returns a versioned, build-bound renderer session', () => {
    const handshake = createDesktopHandshake('bootstrap-secret');
    expect(handshake).toMatchObject({
      protocolVersion: DESKTOP_SERVICE_PROTOCOL_VERSION,
      buildRevision: DESKTOP_SERVICE_BUILD_REVISION,
      servicePid: process.pid,
    });
    expect(handshake.rendererSessionToken).toHaveLength(64);
  });

  it('accepts only the renderer session derived from the active desktop secret', () => {
    process.env.ATH_DESKTOP_BOOTSTRAP_SECRET = 'bootstrap-secret';
    const token = createDesktopHandshake('bootstrap-secret').rendererSessionToken;
    expect(() => authorizeDesktopRendererSession(token)).not.toThrow();
    expect(() => authorizeDesktopRendererSession('wrong-token')).toThrow('desktop_renderer_unauthorized');
  });
});
