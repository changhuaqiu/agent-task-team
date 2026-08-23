import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as IOServer } from 'socket.io';
import type { WorkspaceCommand, WorkspaceCommandReceipt } from '@/lib/workspace-command';
import { authorizeDesktopRendererSession } from '@/lib/desktop-host/protocol';
import { DESKTOP_RENDERER_SESSION_HEADER } from '@/lib/desktop-host/renderer-session';
import {
  WorkspaceCommandIdempotencyConflictError,
  WorkspaceCommandInvariantError,
  WorkspaceCommandService,
} from '@/server/workspace-command/service';

interface ResponseBody {
  receipt?: WorkspaceCommandReceipt;
  error?: string;
  reasonCode?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed', reasonCode: 'method_not_allowed' });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be a Workspace Command object', reasonCode: 'workspace_command_invalid' });
  }
  try {
    const desktopMode = Boolean(process.env.ATH_DESKTOP_BOOTSTRAP_SECRET);
    if (desktopMode) {
      const header = req.headers[DESKTOP_RENDERER_SESSION_HEADER];
      authorizeDesktopRendererSession(Array.isArray(header) ? header[0] : header);
    }
    const io = (res.socket as typeof res.socket & { server?: { io?: IOServer } } | null)?.server?.io;
    const command = {
      ...(req.body as WorkspaceCommand),
      actor: { type: 'user' as const, id: desktopMode ? 'desktop:local-user' : 'web:local-user' },
    } as WorkspaceCommand;
    const receipt = await new WorkspaceCommandService({ io }).submit(command);
    return res.status(receipt.status === 'accepted' ? 200 : 409).json({ receipt });
  } catch (error) {
    if (error instanceof Error && error.message === 'desktop_renderer_unauthorized') {
      return res.status(401).json({ error: 'Desktop renderer session is invalid', reasonCode: 'desktop_renderer_unauthorized' });
    }
    if (error instanceof WorkspaceCommandIdempotencyConflictError) {
      return res.status(409).json({ error: error.message, reasonCode: error.reasonCode });
    }
    if (error instanceof WorkspaceCommandInvariantError) {
      return res.status(400).json({ error: error.message, reasonCode: error.reasonCode });
    }
    console.error('[workspace-command] submit failed:', error);
    return res.status(500).json({ error: '命令服务暂时不可用，请稍后重试', reasonCode: 'workspace_command_internal_error' });
  }
}
