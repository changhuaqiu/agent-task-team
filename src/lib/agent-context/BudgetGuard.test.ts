import { describe, it, expect } from 'vitest';
import { composeWithBudget } from './BudgetGuard';
import { ContextBudget } from './ContextBudget';

describe('BudgetGuard — tier + importance 语义', () => {
  it('系统层（priority 0 → system）永不裁，即使自身超预算', () => {
    const parts = [
      { layer: 'role', content: 'R'.repeat(1000), priority: 0 }, // → system, 250 tokens
    ];
    const { prompt, report } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 100, reserveRatio: 0 }),
    );
    expect(prompt).toContain('R'.repeat(1000)); // 不裁
    expect(report.trimmed).not.toContain('role');
    expect(report.systemOverflow).toBe(true); // 但标记溢出
  });

  it('超预算时 project 层先于 system/tool 被裁', () => {
    const parts = [
      { layer: 'role', content: 'ROLE', priority: 0 },          // system
      { layer: 'tool', content: 'TOOL', priority: 2 },          // tool
      { layer: 'history', content: 'H'.repeat(500), priority: 4 }, // project
    ];
    const { prompt } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 20, reserveRatio: 0 }),
    );
    expect(prompt).toContain('ROLE');            // system 保留
    expect(prompt).toContain('TOOL');            // tool 保留（小）
    expect(prompt).not.toContain('H'.repeat(500)); // project 被裁
  });

  it('project 层内按 importance 升序裁剪（低 imp 先丢）', () => {
    const parts = [
      { layer: 'task', content: 'TASK', tier: 'project' as const, importance: 0.8 },
      { layer: 'history', content: 'H'.repeat(500), tier: 'project' as const, importance: 0.3 },
    ];
    const { prompt, report } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 40, reserveRatio: 0 }),
    );
    expect(prompt).toContain('TASK');             // 高 imp 保留
    expect(prompt).not.toContain('H'.repeat(500)); // 低 imp 先裁
    expect(report.trimmed).toContain('history');
    expect(report.trimmed).not.toContain('task');
  });

  it('tool 层在 system 之后、project 之前被裁', () => {
    const parts = [
      { layer: 'role', content: 'R', tier: 'system' as const, importance: 0.9 },
      { layer: 'tool', content: 'T'.repeat(200), tier: 'tool' as const, importance: 0.6 },
      { layer: 'task', content: 'TASK', tier: 'project' as const, importance: 0.8 },
    ];
    const { prompt, report } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 30, reserveRatio: 0 }),
    );
    expect(prompt).toContain('R');                  // system 保留（永不裁）
    expect(prompt).toContain('TASK');               // project 高 imp，1 token，预算够 → 保留
    // tool 200 字符=50 tokens > 剩余预算 → 裁
    expect(report.trimmed).toContain('tool');
  });

  it('未超预算时所有层保留（legacy priority 调用方）', () => {
    const parts = [
      { layer: 'role', content: 'ROLE', priority: 0 },
      { layer: 'history', content: 'HIST', priority: 4 },
    ];
    const { prompt } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 1000, reserveRatio: 0 }),
    );
    expect(prompt).toContain('ROLE');
    expect(prompt).toContain('HIST');
  });

  it('保持原始 parts 呈现顺序（不按 tier 重排输出）', () => {
    const parts = [
      { layer: 'history', content: 'H', tier: 'project' as const, importance: 0.3 },
      { layer: 'role', content: 'R', tier: 'system' as const, importance: 0.9 },
    ];
    const { prompt } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 1000, reserveRatio: 0 }),
    );
    expect(prompt.indexOf('H')).toBeLessThan(prompt.indexOf('R')); // 按 parts 原序
  });
});
