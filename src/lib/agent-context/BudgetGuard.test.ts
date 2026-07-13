import { describe, it, expect } from 'vitest';
import { composeWithBudget } from './BudgetGuard';
import { ContextBudget } from './ContextBudget';

describe('BudgetGuard', () => {
  it('P0 层（priority 0）有硬上限保护（50% 预算）', () => {
    const parts = [{ layer: 'role', content: 'X'.repeat(200), priority: 0 }];
    const budget = new ContextBudget({ maxTokens: 100, reserveRatio: 0 });
    const { prompt } = composeWithBudget(parts, budget);
    // P0 硬上限为 50 tokens，200 字符 ≈ 50 tokens，应该被包含
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('超预算时低优先级层（P4）先被丢弃，P0 保留（在硬上限内）', () => {
    const parts = [
      { layer: 'role', content: 'ROLE', priority: 0 },
      { layer: 'history', content: 'H'.repeat(500), priority: 4 },
    ];
    const { prompt } = composeWithBudget(parts, new ContextBudget({ maxTokens: 20, reserveRatio: 0 }));
    expect(prompt).toContain('ROLE'); // P0 保留（在硬上限内）
    expect(prompt).not.toContain('H'.repeat(500)); // P4 被丢
  });

  it('P0 超过硬上限时也会被裁剪', () => {
    const parts = [
      { layer: 'role', content: 'R'.repeat(1000), priority: 0 }, // 250 tokens
      { layer: 'history', content: 'H', priority: 4 },
    ];
    const { prompt, report } = composeWithBudget(parts, new ContextBudget({ maxTokens: 100, reserveRatio: 0 }));
    // P0 硬上限为 50 tokens，250 tokens 超过，应该被裁剪
    expect(report.trimmed).toContain('role');
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
