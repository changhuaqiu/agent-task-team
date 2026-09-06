import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();

function safeResolve(input: string): string | null {
  try {
    const root = fs.realpathSync(HOME);
    const resolved = fs.realpathSync(path.resolve(/*turbopackIgnore: true*/ input));
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch { return null; }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (req.query.path !== undefined && typeof req.query.path !== 'string') return res.status(400).json({ error: 'Invalid path' });
  const rawPath = req.query.path || HOME;
  const resolved = safeResolve(rawPath);
  if (!resolved) return res.status(403).json({ error: 'Path not allowed' });

  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ resolved)) {
      return res.status(200).json({ path: resolved, children: [] });
    }

    const entries = fs.readdirSync(/*turbopackIgnore: true*/ resolved, { withFileTypes: true });
    const children = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => {
        const childPath = path.join(/*turbopackIgnore: true*/ resolved, e.name);
        let hasChildren = false;
        try {
          hasChildren = fs.readdirSync(/*turbopackIgnore: true*/ childPath).some((name) => {
            try {
              return fs.statSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ childPath, name)).isDirectory();
            } catch { return false; }
          });
        } catch { /* ignore */ }
        return { name: e.name, path: childPath, hasChildren };
      });

    res.status(200).json({ path: resolved, children });
  } catch (error) {
    console.error('[api/fs/list] Error:', error);
    res.status(500).json({ error: 'Failed to list directory' });
  }
}
