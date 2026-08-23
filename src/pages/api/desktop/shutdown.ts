import type { NextApiRequest, NextApiResponse } from 'next';
import { authorizeDesktopHost } from '@/lib/desktop-host/protocol';
import { drainDesktopService } from '@/server/desktop-service-lifecycle';

type ResponseBody = { ok: true } | { error: string };

export default function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const header = req.headers['x-ath-bootstrap-secret'];
    authorizeDesktopHost(Array.isArray(header) ? header[0] : header);
  } catch {
    return res.status(401).json({ error: 'desktop_host_unauthorized' });
  }

  try {
    drainDesktopService();
    res.setHeader('Cache-Control', 'no-store');
    res.once('finish', () => setTimeout(() => process.exit(0), 50));
    return res.status(202).json({ ok: true });
  } catch (error) {
    console.error('[desktop] graceful shutdown failed:', error);
    return res.status(500).json({ error: 'desktop_shutdown_failed' });
  }
}
