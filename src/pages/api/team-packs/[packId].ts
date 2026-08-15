import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

function validateUpdateInput(input: Record<string, unknown>): { valid: boolean; error?: string } {
  const allowedFields = ['name', 'displayName', 'description', 'version', 'tags', 'category', 'teamMode', 'roles', 'workflow', 'communicationMatrix', 'sharedContext', 'rules'];
  const invalidKeys = Object.keys(input).filter(key => !allowedFields.includes(key));

  if (invalidKeys.length > 0) {
    return { valid: false, error: `不允许更新字段: ${invalidKeys.join(', ')}` };
  }

  for (const field of ['name', 'displayName', 'description', 'version', 'category', 'teamMode']) {
    if (input[field] !== undefined && typeof input[field] !== 'string') {
      return { valid: false, error: `${field} 必须是字符串` };
    }
  }

  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((item) => typeof item !== 'string'))) {
    return { valid: false, error: 'tags 必须是字符串数组' };
  }

  if (input.roles !== undefined && !Array.isArray(input.roles)) {
    return { valid: false, error: 'roles 必须是数组' };
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
    const pack = req.query.export === '1'
      ? teamPackRepo.getExportById(packId)
      : teamPackRepo.getById(packId);
    if (!pack) return res.status(404).json({ error: 'Team pack not found' });
    return res.status(200).json(pack);
  }

  if (req.method === 'POST') {
    if (req.body?.action !== 'materializeRoleSnapshots') {
      return res.status(400).json({ error: '不支持的团队套件操作' });
    }
    const pack = teamPackRepo.materializeRoleSnapshots(packId);
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

  res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
  res.status(405).end();
}
