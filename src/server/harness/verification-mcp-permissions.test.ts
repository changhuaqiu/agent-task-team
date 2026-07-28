import { describe, expect, it } from 'vitest';
import { verificationAutoApprovedMcpToolNames } from './verification-mcp-permissions';

describe('verificationAutoApprovedMcpToolNames', () => {
  it('grants exact Playwright aliases only to the verification gate', () => {
    const granted = verificationAutoApprovedMcpToolNames('test_gate');

    expect(granted).toContain('mcp.playwright.browser_navigate');
    expect(granted).toContain('mcp__playwright__browser_navigate');
    expect(granted).toContain('mcp.playwright.browser_snapshot');
    expect(granted).toContain('mcp__playwright__browser_click');
    expect(granted).toContain('mcp__playwright__browser_take_screenshot');
    expect(granted).not.toContain('mcp__playwright__browser_install');
  });

  it.each([undefined, 'user', 'workflow', 'review_gate'] as const)(
    'does not grant Playwright tools to %s dispatches',
    (source) => {
      expect(verificationAutoApprovedMcpToolNames(source)).toEqual([]);
    },
  );
});
