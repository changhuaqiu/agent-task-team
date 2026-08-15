import type { NextApiRequest } from 'next';
import type { NextApiResponse } from 'next';
import { ensureProjectSocketRuntime } from '@/server/socket-runtime';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const runtime = ensureProjectSocketRuntime(res);
  if (!runtime) {
    return res.status(503).json({ error: 'Socket runtime is not available' });
  }
  return res.end();
}
