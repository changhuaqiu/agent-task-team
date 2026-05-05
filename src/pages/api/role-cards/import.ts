import type { NextApiRequest, NextApiResponse } from 'next';
import { importRoleCardFromUrl } from '@/server/role-card-import';

// Rate limiting configuration
const importRequests = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

function checkRateLimit(ip: string): { allowed: boolean; resetAt?: number } {
  const now = Date.now();
  const record = importRequests.get(ip);

  if (!record || now - record.resetAt > RATE_LIMIT_WINDOW) {
    importRequests.set(ip, { count: 1, resetAt: now });
    return { allowed: true };
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    const timeUntilReset = Math.ceil((RATE_LIMIT_WINDOW - (now - record.resetAt)) / 1000);
    return { allowed: false, resetAt: record.resetAt + timeUntilReset };
  }

  return { allowed: true };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end();
  }

  const { source } = req.body;
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'Missing source URL' });
  }

  // Extract IP from request and check rate limit
  const forwardedFor = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const ip: string = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor
      ? forwardedFor
      : typeof realIp === 'string'
        ? realIp
        : req.socket.remoteAddress || 'unknown';
  const rateCheck = checkRateLimit(ip);

  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter: rateCheck.resetAt,
    });
  }

  try {
    const result = await importRoleCardFromUrl(source);
    return res.status(200).json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return res.status(400).json({ error: message });
  }
}
