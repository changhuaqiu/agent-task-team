import type { NextApiRequest, NextApiResponse } from 'next';
import { skillRepo, type SkillRow } from '@/server/repositories/skill-repo';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query as { id: string };
  if (req.method === 'GET') return handleGet(id, res);
  if (req.method === 'PATCH') return handleUpdate(id, req, res);
  if (req.method === 'DELETE') return handleDelete(id, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

function handleGet(id: string, res: NextApiResponse) {
  const skill = skillRepo.getById(id);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  const files = skillRepo.listFiles(id);
  const revision = skillRepo.getActiveRevision(id);
  const activeRevision = revision ? {
    id: revision.id,
    contentHash: revision.content_hash,
    createdAt: revision.created_at,
    files: skillRepo.listRevisionFiles(revision.id).map(file => ({
      path: file.path,
      kind: file.kind,
      contentHash: file.content_hash,
      byteSize: file.byte_size,
    })),
  } : null;
  return res.status(200).json({ ...skill, files, activeRevision });
}

function handleUpdate(id: string, req: NextApiRequest, res: NextApiResponse) {
  const skill = skillRepo.getById(id);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  const { name, description, content, config, files } = req.body;
  const updates: Partial<Pick<SkillRow, 'name' | 'description' | 'content' | 'config'>> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (content !== undefined) updates.content = content;
  if (config !== undefined) updates.config = config;
  skillRepo.update(id, updates);
  if (files && Array.isArray(files)) {
    skillRepo.replaceFiles(id, files);
  }
  const updated = skillRepo.getById(id)!;
  const updatedFiles = skillRepo.listFiles(id);
  return res.status(200).json({ ...updated, files: updatedFiles });
}

function handleDelete(id: string, res: NextApiResponse) {
  skillRepo.delete(id);
  return res.status(200).json({ ok: true });
}
