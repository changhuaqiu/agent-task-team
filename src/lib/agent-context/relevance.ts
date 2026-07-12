// src/lib/agent-context/relevance.ts
// GSSC Select 的相关性评分。起步用关键词重叠（零依赖、兼容现状）；
// RelevanceProvider 接口预留 embedding（第 8 章向量）后续替换。

/**
 * 关键词重叠相关性：content 命中 query 的词占比（0-1）。
 * 大小写不敏感、空格分词；空 query 返回 0（避免除零）。
 */
export function keywordRelevance(query: string, content: string): number {
  const q = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
  if (q.size === 0) return 0;
  const c = new Set(content.toLowerCase().split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const token of q) {
    if (c.has(token)) overlap++;
  }
  return overlap / q.size;
}

/**
 * 新近性评分：指数衰减 exp(-Δt/τ)，Δt = (now - timestamp) 秒。
 * 未来时间钳为 0 差（返回 1，不超 1）。τ 暴露到 ContextConfig。
 */
export function recencyScore(timestampMs: number, nowMs: number, tauSec: number): number {
  const deltaSec = Math.max(0, (nowMs - timestampMs) / 1000);
  return Math.exp(-deltaSec / tauSec);
}
