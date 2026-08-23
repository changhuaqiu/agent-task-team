import { createHmac, timingSafeEqual } from 'node:crypto';
import { DESKTOP_BUILD_ID } from './generated-build-id';

export const DESKTOP_SERVICE_PROTOCOL_VERSION = 1;

export interface DesktopServiceHandshake {
  protocolVersion: number;
  buildRevision: string;
  servicePid: number;
  rendererSessionToken: string;
}

export const DESKTOP_SERVICE_BUILD_REVISION = DESKTOP_BUILD_ID;

function equalSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizeDesktopHost(provided: string | undefined): string {
  const expected = process.env.ATH_DESKTOP_BOOTSTRAP_SECRET;
  if (!expected || !provided || !equalSecret(provided, expected)) {
    throw new Error('desktop_host_unauthorized');
  }
  return expected;
}

export function createDesktopHandshake(secret: string): DesktopServiceHandshake {
  const buildRevision = DESKTOP_SERVICE_BUILD_REVISION;
  return {
    protocolVersion: DESKTOP_SERVICE_PROTOCOL_VERSION,
    buildRevision,
    servicePid: process.pid,
    rendererSessionToken: createHmac('sha256', secret)
      .update(`renderer:${process.pid}:${buildRevision}`)
      .digest('hex'),
  };
}

export function authorizeDesktopRendererSession(provided: string | undefined): void {
  const secret = process.env.ATH_DESKTOP_BOOTSTRAP_SECRET;
  if (!secret || !provided || !equalSecret(provided, createDesktopHandshake(secret).rendererSessionToken)) {
    throw new Error('desktop_renderer_unauthorized');
  }
}
