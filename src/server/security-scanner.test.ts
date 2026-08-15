import { describe, expect, it } from 'vitest';
import { scanRoleCardContent } from './security-scanner';

describe('scanRoleCardContent', () => {
  it('accepts ordinary role-card content', () => {
    expect(scanRoleCardContent('# Reviewer\n\nReview changes and report evidence.')).toEqual({
      passed: true,
      warnings: [],
      critical: [],
    });
  });

  it.each([
    ['API key', 'api_key = abcdefghijklmnopqrstuvwxyz123456'],
    ['JWT', `Bearer ${'a'.repeat(24)}.${'b'.repeat(24)}.${'c'.repeat(24)}`],
    ['SSH private key', '-----BEGIN PRIVATE KEY-----'],
    ['dangerous command', 'rm -rf /'],
  ])('blocks %s content', (_label, content) => {
    const result = scanRoleCardContent(content);
    expect(result.passed).toBe(false);
    expect(result.critical.length).toBeGreaterThan(0);
  });

  it.each([
    ['oversized content', 'a'.repeat(50_001)],
    ['repeated characters', 'z'.repeat(51)],
  ])('warns about %s', (_label, content) => {
    const result = scanRoleCardContent(content);
    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
