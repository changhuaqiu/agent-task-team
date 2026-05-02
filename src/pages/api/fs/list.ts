import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();

function safeResolve(input: string): string | null {
  const resolved = path.resolve(input);
  if (!resolved.startsWith(HOME)) return null;
  if (resolved.includes('..')) return null;
  return resolved;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rawPath = (req.query.path as string) || HOME;
  const resolved = safeResolve(rawPath);
  if (!resolved) return res.status(403).json({ error: 'Path not allowed' });

  try {
    if (!fs.existsSync(resolved)) {
      return res.status(200).json({ path: resolved, children: [] });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const children = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => {
        const childPath = path.join(resolved, e.name);
        let hasChildren = false;
        try {
          hasChildren = fs.readdirSync(childPath).some((name) => {
            try {
              return fs.statSync(path.join(childPath, name)).isDirectory();
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