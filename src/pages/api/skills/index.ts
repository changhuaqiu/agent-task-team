import type { NextApiRequest, NextApiResponse } from 'next';
import { skillRepo } from '@/server/repositories/skill-repo';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleList(req, res);
  if (req.method === 'POST') return handleCreate(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

function handleList(_req: NextApiRequest, res: NextApiResponse) {
  const skills = skillRepo.list();
  return res.status(200).json(skills);
}

function handleCreate(req: NextApiRequest, res: NextApiResponse) {
  const { name, description, content, files, isPreset } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: 'name and content are required' });
  }
  const existing = skillRepo.getByName(name);
  if (existing) {
    return res.status(409).json({ error: `Skill "${name}" already exists` });
  }
  const skill = skillRepo.create({ name, description, content, isPreset });
  const fileCount = files?.length ?? 0;
  if (files && Array.isArray(files)) {
    for (const f of files) {
      skillRepo.addFile(skill.id, f);
    }
  }
  return res.status(201).json({ ...skill, fileCount });
}
