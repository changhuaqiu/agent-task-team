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

function socketServer(res: NextApiResponse): IOServer | undefined {
  return (res.socket as typeof res.socket & { server?: { io?: IOServer } } | null)?.server?.io;
}

function isGoalContract(value: unknown): value is GoalContract {
  if (!value || typeof value !== 'object') return false;
  const contract = value as Partial<GoalContract>;
  return typeof contract.idempotencyKey === 'string'
    && Boolean(contract.idempotencyKey.trim())
    && (
      contract.correlationId === undefined
      || (typeof contract.correlationId === 'string' && Boolean(contract.correlationId.trim()))
    )
    && typeof contract.goal === 'string'
    && Array.isArray(contract.acceptanceCriteria)
    && contract.acceptanceCriteria.every((item) => typeof item === 'string')
    && typeof contract.scope?.conversationId === 'string'
    && typeof contract.authorization === 'object'
    && typeof contract.recoveryPolicy === 'object'
    && typeof contract.deliveryPolicy === 'object';
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
  const io = socketServer(res);
  if (!io) return res.status(503).json({ error: 'Delivery runtime is not ready' });
  ensureAutonomousDeliveryRuntime(io);

  try {
    if (action === 'advance') {
      const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
      if (!runId) return res.status(400).json({ error: 'runId is required' });
      const idempotencyKey = typeof req.body?.idempotencyKey === 'string'
        ? req.body.idempotencyKey.trim()
        : '';
      const actorId = typeof req.body?.actorId === 'string' ? req.body.actorId.trim() : '';
      if (!idempotencyKey) {
        return res.status(400).json({ error: 'idempotencyKey is required' });
      }
      if (!actorId) return res.status(400).json({ error: 'actorId is required' });
      const result = await advanceAutonomousDelivery(io, runId, {
        kind: 'manual_resume',
        idempotencyKey,
        actor: { type: 'user', id: actorId },
      });
      if (!result) return res.status(503).json({ error: 'Delivery runtime is not registered' });
      return res.status(200).json(result);
    }

    const contract = req.body?.contract;
    if (!isGoalContract(contract)) {
      return res.status(400).json({ error: 'Invalid GoalContract' });
    }
    if (!conversationRepo.getById(contract.scope.conversationId)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const snapshot = startAutonomousDelivery(io, contract);
    if (!snapshot) return res.status(503).json({ error: 'Delivery runtime is not registered' });
    void advanceAutonomousDelivery(io, snapshot.run.id, { kind: 'started' })?.catch((error) => {
      console.error(`[autonomous-delivery] initial advance failed for ${snapshot.run.id}:`, error);
    });
    return res.status(202).json(snapshot);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
