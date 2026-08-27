import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as IOServer } from 'socket.io';
import { discoverAcpRuntimes } from '@/server/agent/acp/runtimeDiscovery';
import { deleteCustomAcpHarness, saveCustomAcpHarness } from '@/server/agent/acp/customCatalog';
import { getAgentRuntimeControl } from '@/server/agent-runtime';

function socketServer(res: NextApiResponse): IOServer | undefined {
  return (res.socket as typeof res.socket & { server?: { io?: IOServer } } | null)?.server?.io;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'POST') {
      const args = req.body?.args ?? [];
      const env = req.body?.env ?? {};
      const saved = saveCustomAcpHarness({
        id: typeof req.body?.id === 'string' ? req.body.id : '',
        label: typeof req.body?.label === 'string' ? req.body.label : '',
        command: typeof req.body?.command === 'string' ? req.body.command : '',
        args,
        env,
      });
      const io = socketServer(res);
      if (io) await getAgentRuntimeControl(io)?.invalidate(saved.id);
      const runtimes = await discoverAcpRuntimes({ force: true });
      return res.status(201).json({ runtimes });
    }
    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id.startsWith('custom:')) return res.status(400).json({ error: 'custom_runtime_id_required' });
      if (!deleteCustomAcpHarness(id)) return res.status(404).json({ error: 'custom_runtime_not_found' });
      const io = socketServer(res);
      if (io) await getAgentRuntimeControl(io)?.invalidate(id);
      const runtimes = await discoverAcpRuntimes({ force: true });
      return res.status(200).json({ runtimes });
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const runtimes = await discoverAcpRuntimes({ force: req.query.refresh === '1' });
    return res.status(200).json({ runtimes });
  } catch (error) {
    console.error('[api/agent-runtimes] discovery failed', error);
    const message = error instanceof Error ? error.message : '运行环境检查失败';
    const isValidationError = message.startsWith('custom_runtime_');
    return res.status(isValidationError ? 400 : 500).json({ error: message });
  }
}
