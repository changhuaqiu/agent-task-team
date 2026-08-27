import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as IOServer } from 'socket.io';
import { getAgentRuntimeControl } from '@/server/agent-runtime';

function socketServer(res: NextApiResponse): IOServer | undefined {
  return (res.socket as typeof res.socket & { server?: { io?: IOServer } } | null)?.server?.io;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const io = socketServer(res);
  const control = io ? getAgentRuntimeControl(io) : undefined;
  if (!control) return res.status(503).json({ error: 'agent_runtime_control_unavailable' });
  const agentId = typeof (req.method === 'GET' ? req.query.agentId : req.body?.agentId) === 'string'
    ? String(req.method === 'GET' ? req.query.agentId : req.body.agentId).trim()
    : '';
  if (!agentId) return res.status(400).json({ error: 'agent_id_required' });
  if (req.method === 'GET') return res.status(200).json({ runtimes: control.list(agentId) });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const projectId = typeof req.body?.projectId === 'string' && req.body.projectId.trim()
    ? req.body.projectId.trim()
    : undefined;
  try {
    if (req.body?.action === 'stop') {
      const result = await control.stop(agentId, projectId);
      return res.status(200).json(result);
    }
    if (req.body?.action === 'restart') {
      const runtimes = await control.restart(agentId, projectId);
      if (runtimes.length === 0) return res.status(409).json({ error: 'runtime_registration_missing' });
      return res.status(200).json({ runtimes });
    }
    return res.status(400).json({ error: 'runtime_action_not_supported' });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'runtime_control_failed' });
  }
}
