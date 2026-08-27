import type { NextApiRequest, NextApiResponse } from 'next';
import { projectReviewFromRow, projectReviewRepo } from '@/server/repositories/project-review-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
  const rows = projectId ? projectReviewRepo.list(projectId) : projectReviewRepo.listAll();
  res.status(200).json({ reviews: rows.map(projectReviewFromRow) });
}
