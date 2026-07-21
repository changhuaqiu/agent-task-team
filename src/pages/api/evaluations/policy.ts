import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/server/db';
import { listAccounts } from '@/server/accounts-file';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
  const conversationId = String(req.method === 'GET' ? req.query.conversationId ?? '' : req.body?.conversationId ?? '').trim();
  if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
  const db = getDb();
  if (!db.prepare('SELECT id FROM conversation WHERE id=?').get(conversationId)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (req.method === 'GET') {
    const policy = db.prepare('SELECT * FROM eval_policy WHERE conversation_id=?').get(conversationId);
    const judgeAccounts = listAccounts().filter((account) =>
      account.enabled && account.authMode === 'api_key' && ['openai', 'anthropic'].includes(account.provider))
      .map(({ id, name, provider, models, status }) => ({ id, name, provider, models, status }));
    return res.status(200).json({ policy: policy ?? {
      conversation_id: conversationId, enabled: 1, sampling_rate: 1, daily_token_budget: 50_000,
      judge_account_id: null, secondary_judge_account_id: null, allowed_providers: '["openai","anthropic"]',
      max_concurrency: 2, retention_days: 180, fail_strategy: 'partial',
    }, judgeAccounts });
  }
  if (req.method === 'PATCH') {
    const body = req.body as Record<string, unknown>;
    const samplingRate = Number(body.samplingRate ?? 1);
    const dailyTokenBudget = Number(body.dailyTokenBudget ?? 50_000);
    const maxConcurrency = Number(body.maxConcurrency ?? 2);
    if (!Number.isFinite(samplingRate) || samplingRate < 0 || samplingRate > 1) {
      return res.status(400).json({ error: 'samplingRate must be between 0 and 1' });
    }
    if (!Number.isInteger(dailyTokenBudget) || dailyTokenBudget < 0) {
      return res.status(400).json({ error: 'dailyTokenBudget must be a non-negative integer' });
    }
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 10) {
      return res.status(400).json({ error: 'maxConcurrency must be an integer between 1 and 10' });
    }
    const judgeAccountId = typeof body.judgeAccountId === 'string' && body.judgeAccountId ? body.judgeAccountId : null;
    const secondaryJudgeAccountId = typeof body.secondaryJudgeAccountId === 'string' && body.secondaryJudgeAccountId
      ? body.secondaryJudgeAccountId : null;
    const allowedAccounts = listAccounts().filter((account) => account.enabled &&
      account.authMode === 'api_key' && ['openai', 'anthropic'].includes(account.provider));
    if (judgeAccountId && !allowedAccounts.some((account) => account.id === judgeAccountId)) {
      return res.status(400).json({ error: 'Primary Judge account is not an enabled allowed API Key account' });
    }
    if (secondaryJudgeAccountId && !allowedAccounts.some((account) => account.id === secondaryJudgeAccountId)) {
      return res.status(400).json({ error: 'Secondary Judge account is not an enabled allowed API Key account' });
    }
    if (judgeAccountId && secondaryJudgeAccountId === judgeAccountId) {
      return res.status(400).json({ error: 'Secondary Judge must use a different account' });
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO eval_policy
      (conversation_id,enabled,sampling_rate,daily_token_budget,judge_account_id,secondary_judge_account_id,max_concurrency,allowed_providers,
       retention_days,fail_strategy,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,'["openai","anthropic"]',180,'partial',?,?)
      ON CONFLICT(conversation_id) DO UPDATE SET enabled=excluded.enabled,sampling_rate=excluded.sampling_rate,
      daily_token_budget=excluded.daily_token_budget,judge_account_id=excluded.judge_account_id,
      secondary_judge_account_id=excluded.secondary_judge_account_id,
      max_concurrency=excluded.max_concurrency,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(
      conversationId, body.enabled === false ? 0 : 1, samplingRate, dailyTokenBudget,
      judgeAccountId, secondaryJudgeAccountId, maxConcurrency, 'platform-user', now);
    return res.status(200).json({ policy: db.prepare('SELECT * FROM eval_policy WHERE conversation_id=?').get(conversationId) });
  }
  return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
