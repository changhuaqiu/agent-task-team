import type { NextApiRequest, NextApiResponse } from 'next';
import { observationSpanRepo } from '@/server/repositories/observation-span-repo';
import { spanPayloadRepo } from '@/server/repositories/span-payload-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : '';
  const spanId = typeof req.query.spanId === 'string' ? req.query.spanId.trim() : '';
  if (!conversationId || !spanId) {
    return res.status(400).json({ error: 'conversationId and spanId are required' });
  }
  res.setHeader('Cache-Control', 'no-store');
  const span = observationSpanRepo.get(spanId);
  if (!span || span.conversation_id !== conversationId) {
    return res.status(404).json({ error: 'span payload not found' });
  }
  return res.status(200).json({ spanId, payloads: spanPayloadRepo.listBySpan(spanId) });
}
