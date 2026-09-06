import type { NextApiRequest, NextApiResponse } from 'next';
import { readArtifactPreview } from '@/server/artifacts/artifact-preview';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const value = (key: string) => typeof req.query[key] === 'string' ? req.query[key] as string : undefined;
  const projectId = value('projectId');
  if (!projectId) return res.status(400).json({ error: 'preview_scope_required' });
  try { return res.status(200).json(await readArtifactPreview({ projectId, artifactId: value('artifactId'), conversationId: value('conversationId'), workId: value('workId'), ref: value('ref') })); }
  catch (error) {
    const code = error instanceof Error && error.message.startsWith('preview_') ? error.message : 'preview_unavailable';
    return res.status(code === 'preview_forbidden' ? 403 : code === 'preview_not_found' ? 404 : 422).json({ error: code });
  }
}
