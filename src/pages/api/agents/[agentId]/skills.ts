import type { NextApiRequest, NextApiResponse } from 'next';
import { skillRepo } from '@/server/repositories/skill-repo';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { agentId } = req.query as { agentId: string };
  if (req.method === 'GET') return handleGet(agentId, res);
  if (req.method === 'POST') return handleSet(agentId, req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

function handleGet(agentId: string, res: NextApiResponse) {
  const skills = skillRepo.getSkillsForAgent(agentId);
  return res.status(200).json(skills);
}

function handleSet(agentId: string, req: NextApiRequest, res: NextApiResponse) {
  const { skillIds } = req.body;
  if (!Array.isArray(skillIds)) {
    return res.status(400).json({ error: 'skillIds must be an array' });
  }
  skillRepo.setAgentSkills(agentId, skillIds);
  const skills = skillRepo.getSkillsForAgent(agentId);
  return res.status(200).json(skills);
}
