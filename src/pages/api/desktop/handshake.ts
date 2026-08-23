import type { NextApiRequest, NextApiResponse } from 'next';
import {
  authorizeDesktopHost,
  createDesktopHandshake,
  type DesktopServiceHandshake,
} from '@/lib/desktop-host/protocol';

type ResponseBody = DesktopServiceHandshake | { error: string };

export default function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const header = req.headers['x-ath-bootstrap-secret'];
    const secret = authorizeDesktopHost(Array.isArray(header) ? header[0] : header);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(createDesktopHandshake(secret));
  } catch {
    return res.status(401).json({ error: 'desktop_host_unauthorized' });
  }
}
