import type { NextApiRequest, NextApiResponse } from 'next';
import type { CommandReceipt, HumanCommand } from '@/lib/human-command/types';
import {
  HumanCommandIdempotencyConflictError,
  HumanCommandInvariantError,
  HumanCommandService,
} from '@/server/human-command/service';

interface HumanCommandResponse {
  receipt?: CommandReceipt;
  error?: string;
  reasonCode?: string;
}

function invariantStatus(error: HumanCommandInvariantError): number {
  if (error.reasonCode === 'human_command_delivery_not_found') return 404;
  if (error.reasonCode === 'human_command_project_scope_mismatch') return 409;
  if (error.reasonCode === 'human_command_handoff_not_offered') return 409;
  return 400;
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HumanCommandResponse>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed', reasonCode: 'method_not_allowed' });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      error: 'Request body must be a Human Command object',
      reasonCode: 'human_command_invalid',
    });
  }

  try {
    const receipt = new HumanCommandService().submit(req.body as HumanCommand);
    return res.status(receipt.status === 'accepted' ? 200 : 409).json({ receipt });
  } catch (error) {
    if (error instanceof HumanCommandIdempotencyConflictError) {
      return res.status(409).json({ error: error.message, reasonCode: error.reasonCode });
    }
    if (error instanceof HumanCommandInvariantError) {
      return res.status(invariantStatus(error)).json({
        error: error.message,
        reasonCode: error.reasonCode,
      });
    }
    console.error('[human-command] submit failed:', error);
    return res.status(500).json({
      error: '命令服务暂时不可用，请稍后重试',
      reasonCode: 'human_command_internal_error',
    });
  }
}
