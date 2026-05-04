import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/server/db/index';

interface TokenUsageRow {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  model: string;
}

interface ModelBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface SummaryResponse {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  byModel: Record<string, ModelBreakdown>;
}

function parseTokenUsage(raw: string | null): TokenUsageRow | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      input_tokens: parsed.input_tokens ?? 0,
      output_tokens: parsed.output_tokens ?? 0,
      cache_read_tokens: parsed.cache_read_tokens ?? 0,
      cache_write_tokens: parsed.cache_write_tokens ?? 0,
      model: parsed.model ?? 'unknown',
    };
  } catch {
    return null;
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const { conversationId, agentId } = req.query;
    const db = getDb();

    const conditions: string[] = ["token_usage IS NOT NULL"];
    const values: string[] = [];

    if (typeof conversationId === 'string') {
      conditions.push("conversation_id = ?");
      values.push(conversationId);
    }
    if (typeof agentId === 'string') {
      conditions.push("agent_id = ?");
      values.push(agentId);
    }

    const invocations = db
      .prepare(`SELECT token_usage FROM invocation WHERE ${conditions.join(' AND ')}`)
      .all(...values) as { token_usage: string | null }[];

    const sessionConditions: string[] = ["usage_snapshot IS NOT NULL"];
    const sessionValues: string[] = [];

    if (typeof conversationId === 'string') {
      sessionConditions.push("conversation_id = ?");
      sessionValues.push(conversationId);
    }
    if (typeof agentId === 'string') {
      sessionConditions.push("agent_id = ?");
      sessionValues.push(agentId);
    }

    const sessions = db
      .prepare(`SELECT usage_snapshot FROM agent_session WHERE ${sessionConditions.join(' AND ')}`)
      .all(...sessionValues) as { usage_snapshot: string | null }[];

    const byModel: Record<string, ModelBreakdown> = {};
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;

    const seenInvocationTokens = new Set<string>();

    for (const row of invocations) {
      const usage = parseTokenUsage(row.token_usage);
      if (!usage) continue;

      // Deduplicate by raw string (same token_usage JSON)
      const key = row.token_usage!;
      if (seenInvocationTokens.has(key)) continue;
      seenInvocationTokens.add(key);

      totalInput += usage.input_tokens;
      totalOutput += usage.output_tokens;
      totalCacheRead += usage.cache_read_tokens;
      totalCacheWrite += usage.cache_write_tokens;

      const model = usage.model;
      if (!byModel[model]) {
        byModel[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      }
      byModel[model].input += usage.input_tokens;
      byModel[model].output += usage.output_tokens;
      byModel[model].cacheRead += usage.cache_read_tokens;
      byModel[model].cacheWrite += usage.cache_write_tokens;
    }

    // Only include session snapshots if no invocations matched (fallback)
    if (invocations.length === 0) {
      for (const row of sessions) {
        const usage = parseTokenUsage(row.usage_snapshot);
        if (!usage) continue;

        totalInput += usage.input_tokens;
        totalOutput += usage.output_tokens;
        totalCacheRead += usage.cache_read_tokens;
        totalCacheWrite += usage.cache_write_tokens;

        const model = usage.model;
        if (!byModel[model]) {
          byModel[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        }
        byModel[model].input += usage.input_tokens;
        byModel[model].output += usage.output_tokens;
        byModel[model].cacheRead += usage.cache_read_tokens;
        byModel[model].cacheWrite += usage.cache_write_tokens;
      }
    }

    const response: SummaryResponse = {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheReadTokens: totalCacheRead,
      totalCacheWriteTokens: totalCacheWrite,
      byModel,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('[api/tokens/summary] Error:', error);
    res.status(500).json({ error: 'Failed to compute token summary' });
  }
}
