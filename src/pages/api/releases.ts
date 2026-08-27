import type { NextApiRequest, NextApiResponse } from 'next';
import { projectRepo } from '@/server/repositories/project-repo';
import { projectReleaseRepo } from '@/server/repositories/project-release-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const projectId = Array.isArray(req.query.projectId) ? req.query.projectId[0] : req.query.projectId;
  if (!projectId?.trim() || !projectRepo.getById(projectId.trim())) {
    res.status(404).json({ error: 'project_not_found' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ releases: projectReleaseRepo.list(projectId.trim()) });
}
