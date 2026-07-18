import { describe, expect, it } from 'vitest';
import { providerCommentAppliesToHead } from '@/server/engineering-collaboration/github-cli-verifier';

describe('providerCommentAppliesToHead', () => {
  const headSha = 'b'.repeat(40);
  const commits = [{ oid: headSha, committedDate: '2026-07-18T08:40:00Z' }];

  it('accepts a provider comment created after the exact head commit', () => {
    expect(providerCommentAppliesToHead({
      commentCreatedAt: '2026-07-18T08:41:00Z', headSha, commits,
    })).toBe(true);
  });

  it('rejects an old comment after the PR head changes', () => {
    expect(providerCommentAppliesToHead({
      commentCreatedAt: '2026-07-18T08:39:00Z', headSha, commits,
    })).toBe(false);
  });

  it('fails closed when GitHub does not return the exact head commit timestamp', () => {
    expect(providerCommentAppliesToHead({
      commentCreatedAt: '2026-07-18T08:41:00Z', headSha, commits: [],
    })).toBe(false);
  });
});
