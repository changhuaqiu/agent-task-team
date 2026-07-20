import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as IOServer } from 'socket.io';
import {
  configureAutonomousDeliveryE2EFixtures,
  getAutonomousDeliveryE2EDriverStatus,
  registerAutonomousDeliveryE2EDriver,
  submitBrowserAttestation,
  type BrowserAttestation,
} from '@/server/testing/autonomous-delivery-e2e-driver';

function socketServer(res: NextApiResponse): IOServer | undefined {
  return (res.socket as typeof res.socket & { server?: { io?: IOServer } } | null)?.server?.io;
}

function available(): boolean {
  return process.env.NODE_ENV !== 'production'
    && process.env.AUTONOMOUS_DELIVERY_E2E_DRIVER === '1';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!available()) return res.status(404).json({ error: 'Not found' });
  const io = socketServer(res);
  if (!io) return res.status(503).json({ error: 'Socket daemon is not ready' });
  const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;

  if (req.method === 'GET') {
    return res.status(200).json(getAutonomousDeliveryE2EDriverStatus(io, runId));
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const action = typeof req.body?.action === 'string' ? req.body.action : 'configure';
    if (action === 'configure') {
      configureAutonomousDeliveryE2EFixtures();
      registerAutonomousDeliveryE2EDriver(io);
      return res.status(200).json(getAutonomousDeliveryE2EDriverStatus(io, runId));
    }
    if (action === 'attest') {
      const input = req.body?.attestation as BrowserAttestation | undefined;
      if (
        !input
        || typeof input.runId !== 'string'
        || !['passed', 'failed'].includes(input.status)
        || typeof input.pageUrl !== 'string'
        || !Array.isArray(input.assertions)
        || !Array.isArray(input.evidenceRefs)
      ) {
        return res.status(400).json({ error: 'Invalid browser attestation' });
      }
      return res.status(200).json(await submitBrowserAttestation(io, input));
    }
    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
