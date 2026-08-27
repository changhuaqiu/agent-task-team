import type { NextApiRequest, NextApiResponse } from 'next';
import {
  InvalidAgentOutcomeInputError,
  parseAgentOutcomeInput,
} from '@/server/work-contract/outcome-input';
import {
  WorkContractInvariantError,
} from '@/server/work-contract/repository';
import { asWorkSubmitOutcomeCommand, commandService } from '@/server/command-kernel/service';

type ResponseBody = {
  ok: boolean;
  status?: 'accepted' | 'duplicate' | 'rejected';
  outcomeId?: string;
  reasonCode?: string;
  error?: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
): void {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  try {
    const receipt = commandService.execute(asWorkSubmitOutcomeCommand(parseAgentOutcomeInput(req.body)));
    const status = receipt.status === 'applied'
      ? 'accepted'
      : receipt.status === 'duplicate'
        ? 'duplicate'
        : 'rejected';
    res.status(status === 'rejected' ? 409 : status === 'accepted' ? 202 : 200)
      .json({
        ok: status !== 'rejected',
        status,
        outcomeId: receipt.commandId,
        ...(receipt.reasonCode ? { reasonCode: receipt.reasonCode } : {}),
      });
  } catch (error) {
    if (
      error instanceof InvalidAgentOutcomeInputError
      || error instanceof WorkContractInvariantError
    ) {
      res.status(400).json({
        ok: false,
        reasonCode: error.reasonCode,
        error: error.message,
      });
      return;
    }
    console.error('[agent-outcomes] admission failed:', error);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
