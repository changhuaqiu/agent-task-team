import type { NextApiRequest, NextApiResponse } from 'next';
import { WorktreeManager } from '@/server/worktree-manager';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { path: dirPath } = req.body as { path?: string };
  if (!dirPath) return res.status(400).json({ error: 'path is required' });

  const isGit = await WorktreeManager.isGitRepo(dirPath);
  const repoRoot = isGit ? await WorktreeManager.getRepoRoot(dirPath) : null;

  res.status(200).json({ isGit, repoRoot });
}
