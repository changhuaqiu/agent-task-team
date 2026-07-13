import { describe, it, expect } from 'vitest';
import { keywordRelevance, recencyScore } from './relevance';

describe('keywordRelevance', () => {
  it('完全重叠返回 1', () => {
    expect(keywordRelevance('hello world', 'hello world')).toBe(1);
  });

  it('无重叠返回 0', () => {
    expect(keywordRelevance('foo', 'bar baz')).toBe(0);
  });

  it('部分重叠返回重叠词占 query 的比例', () => {
    // query {a,b,c}, content {a,b} → overlap 2 / query 3 = 0.667
    expect(keywordRelevance('a b c', 'a b')).toBeCloseTo(2 / 3, 5);
  });

  it('空 query 返回 0（避免除零）', () => {
    expect(keywordRelevance('', 'anything')).toBe(0);
  });

  it('大小写不敏感', () => {
    expect(keywordRelevance('Hello', 'hello world')).toBe(1);
  });
});

describe('recencyScore', () => {
  const NOW = Date.parse('2026-07-12T12:00:00Z');
  const TAU_SEC = 3600;

  it('当前时间返回 1', () => {
    expect(recencyScore(NOW, NOW, TAU_SEC)).toBeCloseTo(1, 5);
  });

  it('1 个 τ 之前返回 e^-1 ≈ 0.368', () => {
    expect(recencyScore(NOW - TAU_SEC * 1000, NOW, TAU_SEC)).toBeCloseTo(Math.exp(-1), 5);
  });

  it('100 个 τ 之前接近 0', () => {
    expect(recencyScore(NOW - TAU_SEC * 1000 * 100, NOW, TAU_SEC)).toBeLessThan(0.01);
  });

  it('未来时间钳为 0 差（返回 1，不超 1）', () => {
    expect(recencyScore(NOW + 1000, NOW, TAU_SEC)).toBeCloseTo(1, 5);
  });
});
