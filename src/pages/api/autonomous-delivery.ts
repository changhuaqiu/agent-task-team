import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as IOServer } from 'socket.io';
import { autonomousDeliveryRepo } from '@/server/autonomous-delivery/repository';
import {
  advanceAutonomousDelivery,
  startAutonomousDelivery,
} from '@/server/autonomous-delivery/registry';
import type { GoalContract } from '@/server/autonomous-delivery/types';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { ensureAutonomousDeliveryRuntime } from '@/server/autonomous-delivery/bootstrap';
import { resolveTeamPackRuntimeReadiness } from '@/server/harness/conversation-runtime';

function socketServer(res: NextApiResponse): IOServer | undefined {
  return (res.socket as typeof res.socket & { server?: { io?: IOServer } } | null)?.server?.io;
}

function isGoalContract(value: unknown): value is GoalContract {
  if (!value || typeof value !== 'object') return false;
  const contract = value as Partial<GoalContract>;
  return typeof contract.goal === 'string'
    && Array.isArray(contract.acceptanceCriteria)
    && contract.acceptanceCriteria.every((item) => typeof item === 'string')
    && typeof contract.scope?.conversationId === 'string'
    && typeof contract.authorization === 'object'
    && typeof contract.recoveryPolicy === 'object'
    && typeof contract.deliveryPolicy === 'object';
}

function teamReadinessError(missingRoles: Array<{ displayName: string }>): string {
  return `请先为以下团队成员绑定可用账号：${missingRoles.map((role) => role.displayName).join('、')}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const conversationId = typeof req.query.conversationId === 'string'
      ? req.query.conversationId
      : undefined;
    const snapshot = runId
      ? autonomousDeliveryRepo.getSnapshot(runId)
      : conversationId
        ? autonomousDeliveryRepo.getLatestByConversation(conversationId)
        : undefined;
    if (!snapshot) return res.status(404).json({ error: 'Autonomous delivery run not found' });
    return res.status(200).json(snapshot);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = typeof req.body?.action === 'string' ? req.body.action : 'start';
  if (action === 'preflight') {
    const teamPackId = typeof req.body?.teamPackId === 'string' ? req.body.teamPackId : '';
    if (!teamPackId) return res.status(400).json({ error: 'teamPackId is required' });
    const readiness = resolveTeamPackRuntimeReadiness(teamPackId);
    if (!readiness.ready) {
      return res.status(409).json({
        error: readiness.error ?? teamReadinessError(readiness.missingRoles),
        reasonCode: 'team_runtime_profile_missing',
        missingRoles: readiness.missingRoles,
      });
    }
    return res.status(200).json(readiness);
  }
  const io = socketServer(res);
  if (!io) return res.status(503).json({ error: 'Delivery supervisor is not ready' });
  ensureAutonomousDeliveryRuntime(io);

  try {
    if (action === 'advance') {
      const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
      if (!runId) return res.status(400).json({ error: 'runId is required' });
      const result = await advanceAutonomousDelivery(io, runId, { kind: 'manual_resume' });
      if (!result) return res.status(503).json({ error: 'Delivery supervisor is not registered' });
      return res.status(200).json(result);
    }

    const contract = req.body?.contract;
    if (!isGoalContract(contract)) {
      return res.status(400).json({ error: 'Invalid GoalContract' });
    }
    const conversation = conversationRepo.getById(contract.scope.conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    if (conversation.team_pack_id) {
      const readiness = resolveTeamPackRuntimeReadiness(conversation.team_pack_id);
      if (!readiness.ready) {
        return res.status(409).json({
          error: readiness.error ?? teamReadinessError(readiness.missingRoles),
          reasonCode: 'team_runtime_profile_missing',
          missingRoles: readiness.missingRoles,
        });
      }
    }
    const existing = autonomousDeliveryRepo.getLatestByConversation(contract.scope.conversationId);
    if (existing && !['completed', 'escalated', 'cancelled'].includes(existing.run.status)) {
      return res.status(409).json({ error: 'An active delivery run already exists', snapshot: existing });
    }
    const snapshot = startAutonomousDelivery(io, contract);
    if (!snapshot) return res.status(503).json({ error: 'Delivery supervisor is not registered' });
    void advanceAutonomousDelivery(io, snapshot.run.id, { kind: 'started' })?.catch((error) => {
      console.error(`[autonomous-delivery] initial advance failed for ${snapshot.run.id}:`, error);
    });
    return res.status(202).json(snapshot);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
