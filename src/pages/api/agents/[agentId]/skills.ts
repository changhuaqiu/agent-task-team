import type { NextApiRequest, NextApiResponse } from 'next';
import { skillRepo } from '@/server/repositories/skill-repo';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { agentId } = req.query as { agentId: string };
  if (req.method === 'GET') return handleGet(agentId, res);
  if (req.method === 'POST') return res.status(410).json({
    error: 'direct_agent_skill_write_disabled',
    reasonCode: 'use_agent_update_command',
  });
  return res.status(405).json({ error: 'Method not allowed' });
}

function handleGet(agentId: string, res: NextApiResponse) {
  const skills = skillRepo.getSkillsForAgent(agentId);
  return res.status(200).json(skills);
}
