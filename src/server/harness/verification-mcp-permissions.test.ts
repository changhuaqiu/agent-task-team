import { describe, expect, it } from 'vitest';
import { verificationAutoApprovedMcpToolNames } from './verification-mcp-permissions';

describe('verificationAutoApprovedMcpToolNames', () => {
  it.each(['test_gate', 'review_gate'] as const)(
    'grants exact Playwright aliases to the %s quality gate',
    (source) => {
      const granted = verificationAutoApprovedMcpToolNames(source);

      expect(granted).toContain('mcp.playwright.browser_navigate');
      expect(granted).toContain('mcp__playwright__browser_navigate');
      expect(granted).toContain('mcp.playwright.browser_snapshot');
      expect(granted).toContain('mcp__playwright__browser_click');
      expect(granted).toContain('mcp__playwright__browser_take_screenshot');
      expect(granted).not.toContain('mcp__playwright__browser_install');
    },
  );

  it.each([undefined, 'user', 'workflow'] as const)(
    'does not grant Playwright tools to %s dispatches',
    (source) => {
      expect(verificationAutoApprovedMcpToolNames(source)).toEqual([]);
    },
  );
});
