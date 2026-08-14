import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  // A same-platform caller can otherwise submit an experiment and map A/B through
  // adjacent run APIs. Until the platform has verified reviewer identity and a trusted
  // case runner, exposing this as a "blind" workflow would be a false security claim.
  return res.status(409).json({
    error: 'Blind pairwise review requires verified platform identity and trusted case execution provenance',
    code: 'pairwise_blind_integrity_unavailable',
  });
}
