// src/lib/agent-context/ContextBudget.ts
// stub —— TDD RED 阶段。

export interface ContextBudgetOpts {
  maxTokens?: number;
  reserveRatio?: number;
}

export class ContextBudget {
  maxTokens: number;
  reserveRatio: number;

  constructor(opts: ContextBudgetOpts = {}) {
    this.maxTokens = opts.maxTokens ?? 8000;
    this.reserveRatio = opts.reserveRatio ?? 0.15;
  }

  availableTokens(): number {
    return Math.round(this.maxTokens * (1 - this.reserveRatio));
  }
}
