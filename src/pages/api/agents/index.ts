import type { NextApiRequest, NextApiResponse } from 'next';
import { agentDefinitionRepo } from '@/server/agents/agent-definition-repo';
import {
  asAgentCreateCommand,
  asAgentUpdateCommand,
  commandService,
} from '@/server/command-kernel/service';

function statusFor(status: string): number {
  if (status === 'applied' || status === 'duplicate') return 200;
  if (status === 'conflict') return 409;
  return 422;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const agents = agentDefinitionRepo.list();
      return res.status(200).json({ agents });
    }

    if (req.method === 'POST') {
      const legacyId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
      const commandId = typeof req.body?.commandId === 'string'
        ? req.body.commandId.trim()
        : legacyId ? `legacy-api:agent.create:${legacyId}` : '';
      if (!commandId) {
        return res.status(400).json({ error: 'commandId or stable id is required; use /api/commands for new clients' });
      }
      const receipt = commandService.execute(asAgentCreateCommand({
        commandId,
        idempotencyKey: typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : commandId,
        agent: req.body,
      }));
      return res.status(statusFor(receipt.status)).json({
        receipt,
        ...(receipt.result && 'agent' in receipt.result ? { agent: receipt.result.agent } : {}),
      });
    }

    if (req.method === 'PATCH') {
      const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
      const existing = id ? agentDefinitionRepo.get(id) : undefined;
      if (!existing) return res.status(404).json({ error: 'Agent 不存在' });
      if (!existing.runtime_id) return res.status(422).json({ error: 'agent_runtime_required' });
      const expectedRevision = Number.isSafeInteger(req.body?.expectedRevision)
        ? Number(req.body.expectedRevision)
        : existing.revision;
      const commandId = typeof req.body?.commandId === 'string' && req.body.commandId.trim()
        ? req.body.commandId.trim()
        : `legacy-api:agent.update:${id}:r${expectedRevision}`;
      const receipt = commandService.execute(asAgentUpdateCommand({
        commandId,
        idempotencyKey: typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : commandId,
        expectedRevision,
        agent: {
          id,
          name: typeof req.body.name === 'string' ? req.body.name : existing.name,
          theme: typeof req.body.theme === 'string' ? req.body.theme : existing.theme,
          emoji: typeof req.body.emoji === 'string' ? req.body.emoji : existing.emoji,
          runtimeId: req.body.runtimeId ?? existing.runtime_id,
          accountIds: Array.isArray(req.body.accountIds) ? req.body.accountIds : existing.account_ids,
          skillIds: Array.isArray(req.body.skillIds) ? req.body.skillIds : existing.skill_ids,
          instructions: typeof req.body.instructions === 'string' ? req.body.instructions : existing.instructions,
          responsibility: req.body.responsibility ?? existing.responsibility,
          avatarUrl: typeof req.body.avatarUrl === 'string' ? req.body.avatarUrl : existing.avatar_url ?? undefined,
          model: typeof req.body.model === 'string' ? req.body.model : existing.model ?? undefined,
          permissions: req.body.permissions ?? {
            canModifyCode: Boolean(existing.can_modify_code),
            canReview: Boolean(existing.can_review),
          },
          runtimeMode: req.body.runtimeMode ?? (existing.use_runtime_defaults ? 'defaults' : 'custom'),
          audience: req.body.audience ?? { mode: existing.audience_mode, ids: existing.audience_ids },
          parallelism: req.body.parallelism === undefined ? existing.parallelism : req.body.parallelism,
          instanceNamePool: req.body.instanceNamePool ?? existing.instance_name_pool,
          runLocation: 'local',
        },
      }));
      return res.status(statusFor(receipt.status)).json({
        receipt,
        ...(receipt.result && 'agent' in receipt.result ? { agent: receipt.result.agent } : {}),
      });
    }

    if (req.method === 'DELETE') {
      return res.status(410).json({ error: 'agent.delete is not available; direct repository deletion has been disabled' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const msg = (error as Error).message;
    if (msg === 'Cannot delete preset agent') {
      return res.status(403).json({ error: msg });
    }
    console.error('[api/agents] Error:', error);
    return res.status(500).json({ error: msg });
  }
}
