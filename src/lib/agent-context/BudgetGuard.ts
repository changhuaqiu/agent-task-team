// src/lib/agent-context/BudgetGuard.ts
// stub —— TDD RED 阶段。

import type { ContextBudget } from './ContextBudget';

export interface BudgetPart {
  layer: string;
  content: string;
  priority: number; // 0=P0（几乎不丢）... 4=P4（最先压）
}

export interface BudgetReport {
  totalTokens: number;
  trimmed: string[];
}

/** 简单 token 估算（字符/4）。后续可换 gpt-tokenizer 精确计数。 */
function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function composeWithBudget(
  parts: BudgetPart[],
  budget: ContextBudget,
): { prompt: string; report: BudgetReport } {
  const available = budget.availableTokens();
  // 按优先级升序（P4 先处理），同优先级保持原顺序
  const sorted = [...parts].sort((a, b) => a.priority - b.priority);
  const included: BudgetPart[] = [];
  const trimmed: string[] = [];
  let usedTokens = 0;

  for (const part of sorted) {
    const tokens = countTokens(part.content);
    if (part.priority === 0) {
      // P0 无条件纳入（身份/约束/任务，几乎不丢）
      // P0 不占用预算，直接加入
      included.push(part);
      usedTokens += tokens;
    } else if (usedTokens + tokens <= available) {
      included.push(part);
      usedTokens += tokens;
    } else {
      trimmed.push(part.layer);
    }
  }

  // 按原始 parts 顺序组装（不改变层的呈现顺序）
  const includedSet = new Set(included);
  const ordered = parts.filter((p) => includedSet.has(p));
  const prompt = ordered.map((p) => p.content).join('\n\n---\n\n');

  return { prompt, report: { totalTokens: usedTokens, trimmed } };
}