// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineeringCollaborationCard } from '@/components/task-hub/EngineeringCollaborationCard';
import type { EngineeringCollaborationCard as Card } from '@/lib/engineering-collaboration/types';

afterEach(cleanup);

const prCard: Card = {
  version: 1, kind: 'pull_request', taskId: 'TASK-PR', actorAgentId: 'luigi', createdAt: '2026-07-18T00:00:00Z',
  receipt: {
    provider: 'github', repository: 'acme/widget', number: 42, title: 'Fix checkout',
    url: 'https://github.com/acme/widget/pull/42', state: 'open', draft: false, author: 'developer',
    baseRef: 'main', headRef: 'task/checkout', headSha: 'a'.repeat(40), checks: 'passing', verifiedAt: '2026-07-18T00:00:00Z',
  },
  evidence: { installResult: 'ok', buildResult: 'ok', testResult: '42 tests passed', impactEvidence: 'checkout inspected' },
};

describe('EngineeringCollaborationCard', () => {
  it('renders a PR delivery with exact commit, checks, evidence and navigation', () => {
    const onSelectTask = vi.fn();
    render(<EngineeringCollaborationCard card={prCard} onSelectTask={onSelectTask} />);

    expect(screen.getByTestId('pull-request-collaboration-card').textContent).toContain('acme/widget#42');
    expect(screen.getByText('aaaaaaaaaaaa')).toBeDefined();
    expect(screen.getByText('检查通过')).toBeDefined();
    expect(screen.getByRole('link', { name: /打开 PR/ }).getAttribute('href')).toBe(prCard.receipt.url);
    fireEvent.click(screen.getByRole('button', { name: '查看 TASK-PR' }));
    expect(onSelectTask).toHaveBeenCalledWith('TASK-PR');
  });

  it('renders a rejected review with its real provider comment', () => {
    const reviewCard: Card = {
      version: 1, kind: 'review', taskId: 'TASK-PR', actorAgentId: 'peach', createdAt: '2026-07-18T00:05:00Z',
      receipt: {
        provider: 'github', repository: 'acme/widget', pullRequestNumber: 42, pullRequestUrl: prCard.receipt.url,
        reviewId: 'review-1', reviewUrl: `${prCard.receipt.url}#pullrequestreview-1`, providerActor: 'shared-bot',
        decision: 'changes_requested', headSha: prCard.receipt.headSha, submittedAt: '2026-07-18T00:05:00Z', verifiedAt: '2026-07-18T00:05:01Z',
      },
      evidence: { testResult: 'Playwright failed', blockerCount: 1, summary: 'Address selection regressed.' },
    };

    render(<EngineeringCollaborationCard card={reviewCard} />);
    expect(screen.getByTestId('review-collaboration-card').textContent).toContain('需要修改');
    expect(screen.getByText('Blocker 1')).toBeDefined();
    expect(screen.getByRole('link', { name: /查看真实评论/ }).getAttribute('href')).toBe(reviewCard.receipt.reviewUrl);
  });
});
