import type { NextApiRequest } from 'next';
import type { NextApiResponse } from 'next';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  try {
    const { stdout: pathStdout } = await execFileAsync('sh', ['-c', 'command -v opencode || true'], {
      timeout: 1500,
    });
    const path = String(pathStdout || '').trim();
    if (!path) {
      res.status(200).json({ available: false });
      return;
    }

    const { stdout: versionStdout } = await execFileAsync('opencode', ['--version'], { timeout: 1500 });
    const version = String(versionStdout || '').trim();
    res.status(200).json({ available: true, path, version });
  } catch (e) {
    const err = e as any;
    res.status(200).json({ available: false, error: String(err?.message || err) });
  }
}
