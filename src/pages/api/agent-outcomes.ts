import type { NextApiRequest, NextApiResponse } from 'next';
import {
  InvalidAgentOutcomeInputError,
  parseAgentOutcomeInput,
} from '@/server/work-contract/outcome-input';
import {
  AgentOutcomeIdempotencyConflictError,
  WorkContractInvariantError,
  workContractRepo,
} from '@/server/work-contract/repository';

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
    const admission = workContractRepo.admitOutcome(parseAgentOutcomeInput(req.body));
    res.status(admission.status === 'rejected' ? 409 : admission.status === 'accepted' ? 202 : 200)
      .json({
        ok: admission.status !== 'rejected',
        status: admission.status,
        outcomeId: admission.outcome.id,
        ...('reasonCode' in admission ? { reasonCode: admission.reasonCode } : {}),
      });
  } catch (error) {
    if (error instanceof AgentOutcomeIdempotencyConflictError) {
      res.status(409).json({
        ok: false,
        reasonCode: error.reasonCode,
        error: error.message,
      });
      return;
    }
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
