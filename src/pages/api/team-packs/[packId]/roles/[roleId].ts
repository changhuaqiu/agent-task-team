import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import type { TeamPackRole } from '@/types/teamPack';

type PatchBody = Pick<Partial<TeamPackRole>, 'roleCardId' | 'roleCardSnapshot' | 'accountIds' | 'skillIds'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasEnumValue(value: unknown, allowed: string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function validateRoleCardSnapshot(snapshot: Record<string, unknown>): { valid: boolean; error?: string } {
  const stringFields = ['name', 'displayName', 'description', 'category', 'snapshottedAt'];
  for (const field of stringFields) {
    if (typeof snapshot[field] !== 'string') {
      return { valid: false, error: `roleCardSnapshot 缺少字段: ${field}` };
    }
  }

  const arrayFields = [
    'tags',
    'applicableScenarios',
    'responsibilities',
    'nonResponsibilities',
    'successCriteria',
    'allowedActions',
    'requiresConfirmation',
    'forbiddenActions',
    'preferredEngines',
    'allowedTools',
    'accountIds',
  ];
  for (const field of arrayFields) {
    if (!isStringArray(snapshot[field])) {
      return { valid: false, error: `roleCardSnapshot 缺少字段: ${field}` };
    }
  }

  if (!hasEnumValue(snapshot.clarifyBeforeExecute, ['always', 'when_ambiguous', 'never'])) {
    return { valid: false, error: 'roleCardSnapshot 缺少字段: clarifyBeforeExecute' };
  }
  if (!hasEnumValue(snapshot.outputStyle, ['concise', 'detailed', 'structured'])) {
    return { valid: false, error: 'roleCardSnapshot 缺少字段: outputStyle' };
  }
  if (typeof snapshot.preferStructuredOutput !== 'boolean') {
    return { valid: false, error: 'roleCardSnapshot 缺少字段: preferStructuredOutput' };
  }
  if (!hasEnumValue(snapshot.outputFormat, ['freeform', 'structured_list', 'report', 'checklist'])) {
    return { valid: false, error: 'roleCardSnapshot 缺少字段: outputFormat' };
  }
  if (typeof snapshot.requiresEvidence !== 'boolean') {
    return { valid: false, error: 'roleCardSnapshot 缺少字段: requiresEvidence' };
  }
  if (!hasEnumValue(snapshot.riskGrading, ['none', 'required', 'optional'])) {
    return { valid: false, error: 'roleCardSnapshot 缺少字段: riskGrading' };
  }
  if (typeof snapshot.snapshotVersion !== 'number') {
    return { valid: false, error: 'roleCardSnapshot 缺少字段: snapshotVersion' };
  }
  return { valid: true };
}

function validatePatch(input: unknown): { valid: boolean; error?: string } {
  if (!isRecord(input)) {
    return { valid: false, error: '请求体必须是对象' };
  }

  const allowedFields = ['roleCardId', 'roleCardSnapshot', 'accountIds', 'skillIds'];
  const invalidKeys = Object.keys(input).filter((key) => !allowedFields.includes(key));
  if (invalidKeys.length > 0) {
    return { valid: false, error: `不允许更新字段: ${invalidKeys.join(', ')}` };
  }

  if (input.accountIds !== undefined && !isStringArray(input.accountIds)) {
    return { valid: false, error: 'accountIds 必须是字符串数组' };
  }
  if (input.skillIds !== undefined && !isStringArray(input.skillIds)) {
    return { valid: false, error: 'skillIds 必须是字符串数组' };
  }
  if (input.roleCardId !== undefined && typeof input.roleCardId !== 'string') {
    return { valid: false, error: 'roleCardId 必须是字符串' };
  }
  if (input.roleCardSnapshot !== undefined && !isRecord(input.roleCardSnapshot)) {
    return { valid: false, error: 'roleCardSnapshot 必须是对象' };
  }
  if (input.roleCardSnapshot !== undefined) {
    const snapshot = input.roleCardSnapshot as Record<string, unknown>;
    const snapshotValidation = validateRoleCardSnapshot(snapshot);
    if (!snapshotValidation.valid) return snapshotValidation;
  }

  return { valid: true };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { packId, roleId } = req.query as { packId: string; roleId: string };

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).end();
  }

  const validation = validatePatch(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const role = teamPackRepo.updateRoleConfig(packId, roleId, req.body as PatchBody);
  if (!role) {
    return res.status(404).json({ error: 'Team pack role not found' });
  }

  return res.status(200).json({ role });
}
