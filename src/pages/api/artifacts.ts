import type { NextApiRequest, NextApiResponse } from 'next';
import { projectArtifactLedger } from '@/server/artifacts/project-artifact-ledger';
import type { ProjectArtifactLedgerItem } from '@/shared/project-artifact-ledger';

type ArtifactsResponse = { artifacts: ProjectArtifactLedgerItem[] } | { error: string };

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArtifactsResponse>,
): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
  try {
    res.status(200).json({ artifacts: projectId ? projectArtifactLedger.list(projectId) : projectArtifactLedger.listAll() });
  } catch (error) {
    const reasonCode = error instanceof Error ? error.message : 'artifact_projection_failed';
    res.status(reasonCode === 'artifact_project_not_found' ? 404 : 500).json({ error: reasonCode });
  }
}
