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
  const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : '';
  const workIds = (Array.isArray(req.query.workId) ? req.query.workId : [req.query.workId])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim());
  const scope = conversationId || workIds.length > 0
    ? { ...(conversationId ? { conversationId } : {}), ...(workIds.length > 0 ? { workIds } : {}) }
    : undefined;
  try {
    res.status(200).json({ artifacts: projectId ? projectArtifactLedger.list(projectId, 100, scope) : projectArtifactLedger.listAll() });
  } catch (error) {
    const reasonCode = error instanceof Error ? error.message : 'artifact_projection_failed';
    res.status(reasonCode === 'artifact_project_not_found' ? 404 : 500).json({ error: reasonCode });
  }
}
