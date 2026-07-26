// src/lib/agent-context/BudgetGuard.ts
import type { ContextBudget } from './ContextBudget';

export type ContextTier = 'system' | 'tool' | 'project';

export interface BudgetPart {
  layer: string;
  content: string;
  /** @deprecated legacy 0=P0(保留)..4=P4(先丢)。无 tier+importance 时自动映射。 */
  priority?: number;
  tier?: ContextTier;
  importance?: number; // 0..1，越大越后裁
  scope?: string;
  private?: boolean;
  /** Required parts reserve budget before optional tool/project context. */
  required?: boolean;
  /** 产生该 part 的 agentId，私有可见性过滤用（spec §9） */
  source?: string;
}

export interface BudgetReport {
  totalTokens: number;
  trimmed: string[];
  /** system 层自身超过可用预算（健康信号，不阻断） */
  systemOverflow?: boolean;
}

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Ranked {
  part: BudgetPart;
  tier: ContextTier;
  imp: number;
}

/** 把 legacy priority 映射成 tier + importance；有 tier+importance 则直用。 */
function rank(part: BudgetPart): Ranked {
  if (part.tier !== undefined) {
    return { part, tier: part.tier, imp: part.importance ?? 0.5 }; // 显式 tier 优先；importance 缺省 0.5
  }
  const pr = part.priority ?? 4;
  const tier: ContextTier = pr <= 1 ? 'system' : pr === 2 ? 'tool' : 'project';
  const imp = 1 - pr / 4; // P0→1.0 … P4→0.0
  return { part, tier, imp };
}

// 包含顺序：system → tool → project；同层内高 importance 优先包含（=后裁）
const INCLUDE_ORDER: Record<ContextTier, number> = { system: 0, tool: 1, project: 2 };

export function composeWithBudget(
  parts: BudgetPart[],
  budget: ContextBudget,
): { prompt: string; report: BudgetReport } {
  const available = budget.availableTokens();
  const ranked = parts.map(rank);
  const sorted = [...ranked].sort((a, b) => {
    if (a.tier === 'system' || b.tier === 'system') {
      return INCLUDE_ORDER[a.tier] - INCLUDE_ORDER[b.tier];
    }
    if (Boolean(a.part.required) !== Boolean(b.part.required)) {
      return a.part.required ? -1 : 1;
    }
    if (INCLUDE_ORDER[a.tier] !== INCLUDE_ORDER[b.tier]) {
      return INCLUDE_ORDER[a.tier] - INCLUDE_ORDER[b.tier];
    }
    return b.imp - a.imp; // 高 importance 先包含
  });

  const included: BudgetPart[] = [];
  const trimmed: string[] = [];
  let usedTokens = 0;
  let systemOverflow = false;

  for (const r of sorted) {
    const tokens = countTokens(r.part.content);
    if (r.tier === 'system') {
      // 系统层永不裁（spec §8）
      included.push(r.part);
      usedTokens += tokens;
      if (tokens > available) systemOverflow = true;
    } else if (usedTokens + tokens <= available) {
      included.push(r.part);
      usedTokens += tokens;
    } else {
      trimmed.push(r.part.layer);
    }
  }

  // 按原始 parts 顺序组装（不改变呈现顺序）
  const includedSet = new Set(included);
  const ordered = parts.filter((p) => includedSet.has(p));
  const prompt = ordered.map((p) => p.content).join('\n\n---\n\n');

  return { prompt, report: { totalTokens: usedTokens, trimmed, systemOverflow } };
}
