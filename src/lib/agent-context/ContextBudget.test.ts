import { describe, it, expect } from 'vitest';
import { ContextBudget } from './ContextBudget';

describe('ContextBudget', () => {
  it('availableTokens 扣除 reserve（8000 * 0.85 = 6800）', () => {
    const b = new ContextBudget({ maxTokens: 8000, reserveRatio: 0.15 });
    expect(b.availableTokens()).toBe(6800);
  });

  it('默认 maxTokens=8000, reserveRatio=0.15', () => {
    const b = new ContextBudget();
    expect(b.maxTokens).toBe(8000);
    expect(b.reserveRatio).toBe(0.15);
  });

  it('reserveRatio=0 时 availableTokens = maxTokens', () => {
    const b = new ContextBudget({ maxTokens: 10000, reserveRatio: 0 });
    expect(b.availableTokens()).toBe(10000);
  });
});
