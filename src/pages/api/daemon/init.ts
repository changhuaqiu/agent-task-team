import type { NextApiRequest } from 'next';
import type { NextApiResponse } from 'next';
import { ensureProjectSocketRuntime } from '@/server/socket-runtime';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  if (!ensureProjectSocketRuntime(res)) {
    return res.status(503).json({ ok: false, error: 'Socket runtime is not available' });
  }

  return res.status(200).json({ ok: true });
}

