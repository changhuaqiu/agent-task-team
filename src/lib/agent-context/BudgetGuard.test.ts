import { describe, it, expect } from 'vitest';
import { composeWithBudget } from './BudgetGuard';
import { ContextBudget } from './ContextBudget';

describe('BudgetGuard', () => {
  it('P0 层（priority 0）即使超预算也保留', () => {
    const parts = [{ layer: 'role', content: 'X'.repeat(200), priority: 0 }];
    const { prompt } = composeWithBudget(parts, new ContextBudget({ maxTokens: 10, reserveRatio: 0 }));
    expect(prompt).toContain('X'.repeat(200));
  });

  it('超预算时低优先级层（P4）先被丢弃，P0 保留', () => {
    const parts = [
      { layer: 'role', content: 'ROLE', priority: 0 },
      { layer: 'history', content: 'H'.repeat(500), priority: 4 },
    ];
    const { prompt } = composeWithBudget(parts, new ContextBudget({ maxTokens: 20, reserveRatio: 0 }));
    expect(prompt).toContain('ROLE'); // P0 保留
    expect(prompt).not.toContain('H'.repeat(500)); // P4 被丢
  });

  it('未超预算时所有层保留', () => {
    const parts = [
      { layer: 'role', content: 'ROLE', priority: 0 },
      { layer: 'history', content: 'HIST', priority: 4 },
    ];
    const { prompt } = composeWithBudget(parts, new ContextBudget({ maxTokens: 1000, reserveRatio: 0 }));
    expect(prompt).toContain('ROLE');
    expect(prompt).toContain('HIST');
  });
});
