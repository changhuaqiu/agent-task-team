import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

interface UpdateInput {
  displayName?: string;
  description?: string;
  workflow?: Record<string, unknown>;
  communicationMatrix?: Record<string, { canSendTo: string[]; canReceiveFrom: string[]; canEscalateTo?: string[] }>;
  sharedContext?: Record<string, unknown>;
  rules?: Record<string, unknown>;
}

function validateUpdateInput(input: Record<string, unknown>): { valid: boolean; error?: string } {
  const allowedFields = ['displayName', 'description', 'workflow', 'communicationMatrix', 'sharedContext', 'rules'];
  const invalidKeys = Object.keys(input).filter(key => !allowedFields.includes(key));

  if (invalidKeys.length > 0) {
    return { valid: false, error: `不允许更新字段: ${invalidKeys.join(', ')}` };
  }

  // Validate workflow type if provided
  if (input.workflow && typeof input.workflow !== 'object') {
    return { valid: false, error: 'workflow 必须是对象' };
  }

  // Validate communicationMatrix structure
  if (input.communicationMatrix && typeof input.communicationMatrix !== 'object') {
    return { valid: false, error: 'communicationMatrix 必须是对象' };
  }

  // Validate sharedContext structure
  if (input.sharedContext && typeof input.sharedContext !== 'object') {
    return { valid: false, error: 'sharedContext 必须是对象' };
  }

  // Validate rules structure
  if (input.rules && typeof input.rules !== 'object') {
    return { valid: false, error: 'rules 必须是对象' };
  }

  return { valid: true };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { packId } = req.query as { packId: string };

  if (req.method === 'GET') {
    const pack = teamPackRepo.getById(packId);
    if (!pack) return res.status(404).json({ error: 'Team pack not found' });
    return res.status(200).json(pack);
  }

  if (req.method === 'PATCH') {
    const validation = validateUpdateInput(req.body);

    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    teamPackRepo.update(packId, req.body);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    teamPackRepo.delete(packId);
    return res.status(204).end();
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
  res.status(405).end();
}
